// Local FISCO BCOS v3 chain (Yagi replay, stretch): what differs from an EVM chain, in one place.
// Spec: docs/PLAN.md §5.6; commands: contracts/README.md ("Local FISCO BCOS").
//
// Measured on a local 4-node FISCO BCOS v3.16.3 Air chain, web3 RPC on 127.0.0.1:8545:
// - eth_chainId and the CHAINID opcode both return the web3 chain id (20200), not 0. SignalAttestor takes its EIP-712
//   chain id as a constructor parameter anyway; deployments/fisco.json records it as attestorChainId.
// - The EVM's block.timestamp is in milliseconds, so the contracts take timeUnit = 1000. The web3 RPC reports block
//   header timestamps in seconds. Attestations carry seconds (issuedAt); the attestor multiplies by timeUnit.
// - No empty blocks: an idle chain's latest block can be hours old, and eth_call runs at that block's time. Before an
//   attestation the relayer seals a fresh block (a 0-value transfer to itself) so its signing time is both fresh on
//   the real block and not in the future for the simulation.
// - eth_getLogs needs an address and a topics array, and silently scans at most 10 blocks from fromBlock (a longer
//   range returns only the first 10 blocks' logs, no error): read logs in FISCO_LOG_RANGE windows.
// - eth_call takes only "latest" (a block number fails with code 16), so reads are not pinned to blocks (rpc.ts).
// - Block headers carry "logsBloom": "0x", which Foundry rejects; forge goes through contracts/fisco/rpc-shim.mjs.
// - Gas price 0, legacy transactions. (v3.16.4's web3 RPC refuses senders with a zero balance, so we use v3.16.3.)

import { http, createPublicClient, type Transport } from "viem";
import type { Chainish, Wallet } from "./chain.ts";
import type { Config, Deployment } from "./config.ts";

/** Blocks per eth_getLogs call on FISCO v3.16.3, which answers only the first 10 blocks of a longer range. */
export const FISCO_LOG_RANGE = 10n;

/** Unix seconds stay below 1e11 until the year 5138; a timestamp at or above it is in milliseconds. */
export const MS_THRESHOLD = 100_000_000_000n;

/** A block header timestamp in unix seconds, whether the RPC reports seconds (EVM, FISCO web3) or milliseconds. */
export function headerSeconds(ts: bigint): bigint {
  return ts >= MS_THRESHOLD ? ts / 1000n : ts;
}

/** A contract-level time (block.timestamp, queuedAt, an eta) in unix seconds, given the deployment's timeUnit. */
export function evmSeconds(t: bigint, timeUnit = 1): bigint {
  return t / BigInt(timeUnit);
}

/** Unix seconds as the contracts measure time on this deployment (× timeUnit: milliseconds on FISCO). */
export function toEvmTime(seconds: bigint, timeUnit = 1): bigint {
  return seconds * BigInt(timeUnit);
}

/** How far the latest block may lag the wall clock before the relayer refreshes it (evm_mine, or a FISCO seal tx). */
export const MAX_BLOCK_LAG_S = 60n;

/**
 * The signing time for an attestation, in seconds: the wall clock (already 5 s back), but never ahead of the latest
 * block, because eth_call (the simulation) runs at the latest block's time and the attestor rejects issuedAt in the
 * future. `stale` says the latest block lags by more than MAX_BLOCK_LAG_S: refresh the chain first, or an idle chain
 * would make the attestation stale (over an hour old) by the time it is mined.
 */
export function pickIssuedAt(wallSeconds: bigint, latestHeader: bigint): { issuedAt: bigint; stale: boolean } {
  const latest = headerSeconds(latestHeader);
  return { issuedAt: latest < wallSeconds ? latest : wallSeconds, stale: latest < wallSeconds - MAX_BLOCK_LAG_S };
}

/** FISCO seals no empty blocks: a 0-value transfer to itself makes one, so "latest" is now. Returns the tx hash. */
export async function sealFreshBlock(c: Chainish, wallet: Wallet): Promise<`0x${string}`> {
  const tx = await wallet.sendTransaction({ to: wallet.account.address, value: 0n });
  const receipt = await c.pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`block refresh ${tx} failed`);
  return tx;
}

export interface FiscoNode {
  chainId: number;
  blockNumber: bigint;
  client: string;
}

/**
 * Checks the node behind cfg.rpcUrl before a run: its eth_chainId must equal the deployment's chainId and FISCO_CHAIN_ID
 * (when set), and the deployment must use timeUnit 1000. Returns what the node reported.
 */
export async function checkFiscoNode(cfg: Config, dep: Deployment, transport: Transport = http(cfg.rpcUrl)): Promise<FiscoNode> {
  const pub = createPublicClient({ transport });
  const [chainId, blockNumber, client] = await Promise.all([
    pub.getChainId(),
    pub.getBlockNumber(),
    pub.request({ method: "web3_clientVersion" } as never).catch(() => "unknown") as Promise<string>,
  ]);
  const problems = fiscoProblems({ nodeChainId: chainId, cfgChainId: cfg.chainId, dep });
  if (problems.length) throw new Error(`FISCO node at ${cfg.rpcUrl}: ${problems.join("; ")}`);
  return { chainId, blockNumber, client };
}

/** Pure part of checkFiscoNode, so it is testable without a chain. */
export function fiscoProblems(x: { nodeChainId: number; cfgChainId: number; dep: Pick<Deployment, "chainId" | "timeUnit" | "attestorChainId"> }): string[] {
  const out: string[] = [];
  if (x.nodeChainId !== x.dep.chainId) out.push(`eth_chainId is ${x.nodeChainId} but deployments/fisco.json says ${x.dep.chainId} (redeploy, or point FISCO_RPC at the right chain)`);
  if (x.nodeChainId !== x.cfgChainId) out.push(`eth_chainId is ${x.nodeChainId} but FISCO_CHAIN_ID is ${x.cfgChainId}`);
  if (x.dep.timeUnit !== 1000) out.push(`the deployment's timeUnit is ${x.dep.timeUnit ?? 1}; FISCO's block.timestamp is in milliseconds, so it must be 1000`);
  return out;
}

/** The chain id relayers sign with: the attestor's constructor parameter, recorded at deploy time. */
export function attestorChainId(dep: Pick<Deployment, "chainId" | "attestorChainId">): number {
  return dep.attestorChainId ?? dep.chainId;
}
