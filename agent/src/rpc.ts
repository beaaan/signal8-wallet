// Read-your-writes over load-balanced public RPCs (sepolia.base.org, publicnode). A read sent right after a receipt can
// land on a node a few blocks behind: the first Base Sepolia replay saw a stale allowance, then an end-of-day ledger
// mismatch whose five reads came from different blocks. This transport remembers the newest block seen in a receipt
// and the next nonce of each sender it has sent for, pins "latest" reads to one fresh block at least that new, and
// retries while a lagging node does not have that block yet (also for reads that name their block, as the
// reconciliation snapshot does: it reads every field at one block). Local anvil chains use plain http.

import { custom, hexToBigInt, http, parseTransaction, recoverTransactionAddress, toHex, type Hex, type Transport } from "viem";

type Request = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** Methods whose block parameter is pinned, and its position in params. */
const PINNED: Record<string, number> = { eth_call: 1, eth_estimateGas: 1, eth_getBalance: 1, eth_getCode: 1, eth_getStorageAt: 2 };
/** What a node that has not reached the pinned block answers. */
const LAGGING = /header not found|unknown block|block not found|missing trie node|block .*not (found|available)|beyond current head/i;

export interface ConsistentOpts {
  /** Tries while a node lags (default 20). */
  tries?: number;
  /** Wait between tries in ms (default 500). */
  waitMs?: number;
  /** The underlying JSON-RPC request; tests pass a fake. */
  base?: Request;
}

export function consistentTransport(url: string, opts: ConsistentOpts = {}): Transport {
  const tries = opts.tries ?? 20;
  const waitMs = opts.waitMs ?? 500;
  const base: Request = opts.base ?? (http(url)({ retryCount: 3 }).request as Request);
  const sleep = () => new Promise((done) => setTimeout(done, waitMs));
  let high = 0n;
  const nextNonce = new Map<string, bigint>();

  /** A block number from the node that answers, at least the newest receipt's. */
  async function fresh(): Promise<bigint> {
    for (let i = 0; ; i++) {
      const n = hexToBigInt((await base({ method: "eth_blockNumber" })) as Hex);
      if (n >= high || i >= tries) return n > high ? n : high;
      await sleep();
    }
  }

  async function retrying(method: string, params: unknown[]): Promise<unknown> {
    for (let i = 0; ; i++) {
      try {
        return await base({ method, params });
      } catch (err) {
        if (i >= tries || !LAGGING.test(err instanceof Error ? err.message : String(err))) throw err;
        await sleep();
      }
    }
  }

  async function pinned(method: string, params: unknown[]): Promise<unknown> {
    const at = PINNED[method]!;
    const tag = params[at];
    // an explicit block (e.g. a reconciliation snapshot pinned to one block) is kept, but a lagging node is asked again
    if (typeof tag === "string" && tag.startsWith("0x")) return retrying(method, params);
    if (high === 0n || (tag !== undefined && tag !== "latest" && tag !== "pending")) return base({ method, params });
    const p = [...params];
    p[at] = toHex(await fresh());
    return retrying(method, p);
  }

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const list = Array.isArray(params) ? params : [];
    if (method in PINNED) return pinned(method, list);
    // a log range up to the newest receipt's block: a node that has not reached it refuses, so ask again
    if (method === "eth_getLogs") return retrying(method, list);
    const result = await base({ method, params });
    if (method === "eth_blockNumber") {
      // a lagging node's head would end a log range before this process's own last transaction
      return hexToBigInt(result as Hex) < high ? toHex(high) : result;
    } else if (method === "eth_getTransactionReceipt") {
      const block = (result as { blockNumber?: Hex } | null)?.blockNumber;
      if (block && hexToBigInt(block) > high) high = hexToBigInt(block);
    } else if (method === "eth_getTransactionCount") {
      const known = nextNonce.get(String(list[0]).toLowerCase());
      if (known !== undefined && known > hexToBigInt(result as Hex)) return toHex(known);
    } else if (method === "eth_sendRawTransaction") {
      const raw = list[0] as Hex;
      const nonce = BigInt(parseTransaction(raw).nonce ?? 0);
      const from = (await recoverTransactionAddress({ serializedTransaction: raw as never })).toLowerCase();
      if ((nextNonce.get(from) ?? 0n) < nonce + 1n) nextNonce.set(from, nonce + 1n);
    }
    return result;
  }

  return custom({ request }, { retryCount: 0 });
}
