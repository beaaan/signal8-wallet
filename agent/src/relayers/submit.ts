// Signs an attestation with the relayer's own key and sends SignalAttestor.attest() from that same key.
import { resolve } from "node:path";
import { decodeEventLog } from "viem";
import { signalAttestorAbi } from "../abis.ts";
import { revertReason, walletFor, type Chainish } from "../chain.ts";
import { issuedAtNow, NonceStore, signAttestation, type Hex, type SignalAttestation } from "./sign.ts";

export type RelayerRole = "hkoRelayer" | "gdacsRelayer";

export interface AttestResult {
  tx: Hex;
  attestation: SignalAttestation;
  stormStarted: boolean;
  stormEnded: boolean;
}

/**
 * Signing time: wall clock minus 5 s, but never ahead of the chain (a local anvil can run behind wall time,
 * and the attestor rejects issuedAt > block.timestamp). On anvil a stale latest block is refreshed with evm_mine
 * first, so an idle local chain does not make the attestation look an hour old.
 */
export async function chainIssuedAt(c: Chainish): Promise<bigint> {
  const wall = issuedAtNow();
  let latest = (await c.pub.getBlock({ blockTag: "latest" })).timestamp;
  if (c.cfg.network === "anvil" && latest < wall - 60n) {
    await c.pub.request({ method: "evm_mine", params: [] } as never);
    latest = (await c.pub.getBlock({ blockTag: "latest" })).timestamp;
  }
  return latest < wall ? latest : wall;
}

/**
 * build() receives the nonce and signing time and returns the attestation to sign.
 * The nonce is max(on-chain lastNonce, agent/state/nonces.json) + 1.
 */
export async function attest(
  c: Chainish,
  role: RelayerRole,
  build: (n: { nonce: bigint; issuedAt: bigint }) => SignalAttestation,
): Promise<AttestResult> {
  const wallet = walletFor(c, role);
  const attestor = c.dep.contracts.SignalAttestor;
  const onchain = await c.pub.readContract({ address: attestor, abi: signalAttestorAbi, functionName: "lastNonce", args: [wallet.account.address] });
  const store = new NonceStore(resolve(c.cfg.stateDir, "nonces.json"));
  const nonce = store.next(NonceStore.key(c.dep.chainId, attestor, wallet.account.address), onchain);
  const a = build({ nonce, issuedAt: await chainIssuedAt(c) });
  if (!wallet.account.signTypedData) throw new Error("relayer account cannot sign typed data");
  const signature = await signAttestation(wallet.account as Parameters<typeof signAttestation>[0], c.dep.chainId, attestor, a);
  try {
    const { request } = await c.pub.simulateContract({
      address: attestor,
      abi: signalAttestorAbi,
      functionName: "attest",
      args: [a, signature],
      account: wallet.account,
    });
    const tx = await wallet.writeContract(request);
    const receipt = await c.pub.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error(`attest reverted (${tx})`);
    let stormStarted = false;
    let stormEnded = false;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: signalAttestorAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "StormStarted") stormStarted = true;
        if (ev.eventName === "StormEnded") stormEnded = true;
      } catch {
        // not an attestor event
      }
    }
    return { tx, attestation: a, stormStarted, stormEnded };
  } catch (err) {
    throw new Error(`attest by ${role} failed: ${revertReason(err)}`);
  }
}
