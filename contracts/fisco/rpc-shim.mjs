// JSON-RPC shim between Foundry and a local FISCO BCOS v3.16.3 web3 RPC (Yagi replay, stretch).
//
// FISCO v3.16.3 returns block headers with "logsBloom": "0x" (empty) where Ethereum clients send 256 bytes, and
// Foundry's alloy refuses to deserialize such a block ("invalid string length"), so `forge script` cannot even fork
// the chain. This shim forwards every request unchanged and, in block results only, replaces an empty or short
// logsBloom with 256 zero bytes and adds a zero mixHash if missing. Transactions still go to FISCO as signed; nothing
// else is touched. The agent (viem) talks to FISCO directly and does not need it.
//
//   node contracts/fisco/rpc-shim.mjs [listenPort=8547] [upstream=http://127.0.0.1:8545]
//   forge script ... --rpc-url http://127.0.0.1:8547
//
// No dependencies (Node >= 22). Loopback only.

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8547);
const upstream = process.argv[3] ?? "http://127.0.0.1:8545";
const BLOOM = `0x${"00".repeat(256)}`;
const ZERO32 = `0x${"00".repeat(32)}`;
const BLOCK_METHODS = new Set(["eth_getBlockByNumber", "eth_getBlockByHash"]);

export function fixBlock(block) {
  if (!block || typeof block !== "object") return block;
  if (typeof block.logsBloom !== "string" || block.logsBloom.length !== BLOOM.length) block.logsBloom = BLOOM;
  if (block.mixHash === undefined) block.mixHash = ZERO32;
  return block;
}

/** Fix one JSON-RPC response for the request it answers. */
export function fixResponse(req, res) {
  if (res && req && BLOCK_METHODS.has(req.method) && res.result) res.result = fixBlock(res.result);
  return res;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  createServer(async (inReq, out) => {
    try {
      const chunks = [];
      for await (const c of inReq) chunks.push(c);
      const body = Buffer.concat(chunks).toString("utf8");
      const up = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body });
      const text = await up.text();
      let reply = text;
      try {
        const req = JSON.parse(body);
        const res = JSON.parse(text);
        reply = JSON.stringify(Array.isArray(req) && Array.isArray(res) ? res.map((r) => fixResponse(req.find((q) => q.id === r.id), r)) : fixResponse(req, res));
      } catch {
        // not JSON: pass through as is
      }
      out.writeHead(up.status, { "content-type": "application/json" });
      out.end(reply);
    } catch (err) {
      out.writeHead(502, { "content-type": "application/json" });
      out.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `shim: ${err instanceof Error ? err.message : err}` } }));
    }
  }).listen(port, "127.0.0.1", () => console.log(`FISCO RPC shim on http://127.0.0.1:${port} → ${upstream}`));
}
