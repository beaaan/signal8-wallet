// EIP-712 signing of SignalAttestation, one key and one nonce counter per relayer.
// Spec: docs/specs/contracts.md#eip-712 and docs/specs/agent.md#signing-relayerssignts

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { keccak256, toBytes, type LocalAccount } from "viem";

export type Hex = `0x${string}`;

export const SOURCE = {
  HKO: keccak256(toBytes("HKO")),
  GDACS: keccak256(toBytes("GDACS")),
  NCHMF: keccak256(toBytes("NCHMF")),
} as const;

export const ZERO32: Hex = `0x${"00".repeat(32)}`;

export interface SignalAttestation {
  source: Hex;
  region: Hex;
  level: number;
  eventId: Hex;
  sourceTime: bigint;
  issuedAt: bigint;
  nonce: bigint;
}

export const ATTESTATION_TYPES = {
  SignalAttestation: [
    { name: "source", type: "bytes32" },
    { name: "region", type: "bytes32" },
    { name: "level", type: "uint8" },
    { name: "eventId", type: "bytes32" },
    { name: "sourceTime", type: "uint64" },
    { name: "issuedAt", type: "uint64" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export function attestorDomain(chainId: number, attestor: Hex) {
  return { name: "Signal8Attestor", version: "1", chainId, verifyingContract: attestor } as const;
}

/**
 * Signing time. Five seconds in the past, so a block mined right after never sees a future attestation
 * (the attestor requires issuedAt <= block.timestamp and at most one hour old).
 */
export function issuedAtNow(nowMs: number = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / 1000) - 5);
}

export async function signAttestation(account: LocalAccount, chainId: number, attestor: Hex, a: SignalAttestation): Promise<Hex> {
  return account.signTypedData({
    domain: attestorDomain(chainId, attestor),
    types: ATTESTATION_TYPES,
    primaryType: "SignalAttestation",
    message: a,
  });
}

/**
 * Per-relayer nonces, persisted to agent/state/nonces.json and keyed by chain, attestor and relayer.
 * next() = max(on-chain lastNonce, last local nonce) + 1, so a lost state file or a redeploy only skips numbers.
 */
export class NonceStore {
  constructor(private readonly path: string) {}

  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  static key(chainId: number, attestor: Hex, relayer: Hex): string {
    return `${chainId}:${attestor.toLowerCase()}:${relayer.toLowerCase()}`;
  }

  /** Reserves and persists the next nonce. */
  next(key: string, onchain: bigint): bigint {
    const all = this.read();
    const local = all[key] ? BigInt(all[key]) : 0n;
    const nonce = (onchain > local ? onchain : local) + 1n;
    all[key] = nonce.toString();
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2));
    renameSync(tmp, this.path);
    return nonce;
  }
}
