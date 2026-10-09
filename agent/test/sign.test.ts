import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTypedData, keccak256, recoverTypedDataAddress, toBytes, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { buildHkoAttestation } from "../src/relayers/hko.ts";
import { ATTESTATION_TYPES, NonceStore, SOURCE, ZERO32, attestorDomain, issuedAtNow, signAttestation } from "../src/relayers/sign.ts";

// anvil account 6 (HKO relayer), a public dev key
const relayer = privateKeyToAccount("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e");
const attestor = "0x2e234DAe75C793f67A35089C9d99245E1C58470b";
const HK = keccak256(toBytes("HK"));

const vector = {
  source: keccak256(toBytes("HKO")),
  region: HK,
  level: 8,
  eventId: ZERO32,
  sourceTime: 1758608400n,
  issuedAt: 1760000000n,
  nonce: 1n,
};

describe("EIP-712 SignalAttestation", () => {
  it("matches the Solidity digest (contracts/test/SignalAttestor.t.sol test_DigestVector)", () => {
    const digest = hashTypedData({
      domain: attestorDomain(31337, attestor),
      types: ATTESTATION_TYPES,
      primaryType: "SignalAttestation",
      message: vector,
    });
    expect(digest).toBe("0x947ea19da298b0479c6a22d5d27e216502066314aa46fee85575004a92f540e0");
  });

  it("produces a signature that recovers to the relayer", async () => {
    const sig = await signAttestation(relayer, 31337, attestor, vector);
    const domain = attestorDomain(31337, attestor);
    const args = { domain, types: ATTESTATION_TYPES, primaryType: "SignalAttestation" as const, message: vector, signature: sig };
    expect(await verifyTypedData({ address: relayer.address, ...args })).toBe(true);
    expect(await recoverTypedDataAddress(args)).toBe(relayer.address);
  });

  it("does not verify for another chain id or a changed level", async () => {
    const sig = await signAttestation(relayer, 31337, attestor, vector);
    const base = { address: relayer.address, types: ATTESTATION_TYPES, primaryType: "SignalAttestation" as const, signature: sig };
    expect(await verifyTypedData({ ...base, domain: attestorDomain(84532, attestor), message: vector })).toBe(false);
    expect(await verifyTypedData({ ...base, domain: attestorDomain(31337, attestor), message: { ...vector, level: 10 } })).toBe(false);
  });

  it("signs 5 s in the past so the next block never sees a future attestation", () => {
    expect(issuedAtNow(1_760_000_000_000)).toBe(1_759_999_995n);
  });
});

describe("buildHkoAttestation", () => {
  it("keeps HKO's time as sourceTime and never carries an event id", () => {
    const a = buildHkoAttestation({ level: 8, issueTime: "2025-09-23T14:20:00+08:00" }, { region: HK, nonce: 3n, issuedAt: 1760000000n });
    expect(a).toEqual({ source: SOURCE.HKO, region: HK, level: 8, eventId: ZERO32, sourceTime: 1758608400n, issuedAt: 1760000000n, nonce: 3n });
  });

  it("rejects a level the attestor would reject", () => {
    expect(() => buildHkoAttestation({ level: 5 }, { region: HK, nonce: 1n, issuedAt: 1n })).toThrow();
  });
});

describe("NonceStore", () => {
  it("is strictly increasing and follows the chain when the chain is ahead", () => {
    const path = join(mkdtempSync(join(tmpdir(), "s8-nonce-")), "nonces.json");
    const store = new NonceStore(path);
    const key = NonceStore.key(31337, attestor, relayer.address);
    expect(store.next(key, 0n)).toBe(1n);
    expect(store.next(key, 0n)).toBe(2n);
    expect(store.next(key, 10n)).toBe(11n);
    expect(new NonceStore(path).next(key, 5n)).toBe(12n);
    expect(JSON.parse(readFileSync(path, "utf8"))[key]).toBe("12");
  });
});
