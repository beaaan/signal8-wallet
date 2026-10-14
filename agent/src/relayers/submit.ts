// Signs an attestation with the relayer's own key and sends SignalAttestor.attest() from that same key.
import { resolve } from "node:path";
import { decodeEventLog } from "viem";
import { signalAttestorAbi } from "../abis.ts";
import { revertReason, walletFor, type Chainish } from "../chain.ts";
import { attestorChainId, pickIssuedAt, sealFreshBlock } from "../fisco.ts";
import { issuedAtNow, NonceStore, signAttestation, type Hex, type SignalAttestation } from "./sign.ts";

export type RelayerRole = "hkoRelayer" | "gdacsRelayer" | "nchmfRelayer";

/**
 * The key that signs the local official source for a region, as SignalAttestor._localSource decides: HKO for Hong
 * Kong, NCHMF everywhere else. "hkoRelayer" asked for a Vietnamese region therefore signs with the NCHMF relayer key.
 */
export function relayerKeyRole(role: RelayerRole, region: string): RelayerRole {
  return role === "hkoRelayer" && region !== "HK" ? "nchmfRelayer" : role;
}

export interface AttestResult {
  tx: Hex;
  attestation: SignalAttestation;
  stormStarted: boolean;
  stormEnded: boolean;
}

/**
 * Signing time (unix seconds): wall clock minus 5 s, but never ahead of the chain (a local anvil can run behind wall
 * time, and the attestor rejects issuedAt > block.timestamp). A stale latest block is refreshed first, so an idle
 * local chain does not make the attestation look an hour old: evm_mine on anvil; on FISCO, which seals no empty
 * blocks, `refresh` (a 0-value transfer, see fisco.ts). Header times are read as seconds even where an RPC reports
 * milliseconds; the attestor scales issuedAt by its timeUnit (1000 on FISCO).
 */
export async function chainIssuedAt(c: Chainish, refresh?: () => Promise<unknown>): Promise<bigint> {
  const wall = issuedAtNow();
  const latest = async () => (await c.pub.getBlock({ blockTag: "latest" })).timestamp;
  let pick = pickIssuedAt(wall, await latest());
  if (pick.stale && (c.cfg.local || (c.cfg.fisco && refresh))) {
    if (c.cfg.local) await c.pub.request({ method: "evm_mine", params: [] } as never);
    else await refresh!();
    pick = pickIssuedAt(wall, await latest());
  }
  return pick.issuedAt;
}

/**
 * build() receives the nonce and signing time and returns the attestation to sign.
 * The nonce is max(on-chain lastNonce, agent/state/nonces.json) + 1. The EIP-712 domain uses the attestor's own
 * chain id (deployments/<network>.json attestorChainId, else chainId).
 */
export async function attest(
  c: Chainish,
  role: RelayerRole,
  build: (n: { nonce: bigint; issuedAt: bigint }) => SignalAttestation,
): Promise<AttestResult> {
  role = relayerKeyRole(role, c.dep.region);
  const wallet = walletFor(c, role);
  const attestor = c.dep.contracts.SignalAttestor;
  const issuedAt = await chainIssuedAt(c, () => sealFreshBlock(c, wallet));
  const onchain = await c.pub.readContract({ address: attestor, abi: signalAttestorAbi, functionName: "lastNonce", args: [wallet.account.address] });
  const store = new NonceStore(resolve(c.cfg.stateDir, "nonces.json"));
  const nonce = store.next(NonceStore.key(c.dep.chainId, attestor, wallet.account.address), onchain);
  const a = build({ nonce, issuedAt });
  if (!wallet.account.signTypedData) throw new Error("relayer account cannot sign typed data");
  const signature = await signAttestation(wallet.account as Parameters<typeof signAttestation>[0], attestorChainId(c.dep), attestor, a);
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
