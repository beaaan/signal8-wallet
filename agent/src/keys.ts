// npm run keys:new
// Generates fresh testnet keys for the agent backend's roles and writes them into ../.env, but only for
// variables that are missing or empty there (never overwrites). Prints the addresses to fund, never a key.
// The guardian, deployer and Safe owner keys are not the backend's and are not generated here.

import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { KEY_ENV, PATHS, type KeyRole } from "./config.ts";
import { isMain } from "./isMain.ts";

const ROLE_LABEL: Record<KeyRole, string> = {
  agent: "agent (PlanModule.agent; Safe delegate, not an owner)",
  hkoRelayer: "HKO relayer",
  gdacsRelayer: "GDACS relayer",
  nchmfRelayer: "NCHMF relayer (Vietnam, local FISCO chain only)",
  demoClient: "demo client (pays invoices into PaymentRouter)",
};

/** The Base Sepolia backend's roles. The NCHMF relayer exists only for the local FISCO (Yagi) chain. */
const GENERATED: KeyRole[] = ["agent", "hkoRelayer", "gdacsRelayer", "demoClient"];

/**
 * Fills empty `KEY=` lines in place and appends missing keys. Returns the new file text and the roles filled.
 * Pure, so it is testable without touching the real .env.
 */
export function fillEnv(text: string, gen: () => `0x${string}` = generatePrivateKey): { text: string; filled: Partial<Record<KeyRole, `0x${string}`>> } {
  const filled: Partial<Record<KeyRole, `0x${string}`>> = {};
  let out = text;
  for (const role of GENERATED) {
    const name = KEY_ENV[role];
    const line = new RegExp(`^${name}=(.*)$`, "m").exec(out);
    const current = line?.[1]?.replace(/#.*$/, "").trim();
    if (current) continue;
    const key = gen();
    filled[role] = privateKeyToAccount(key).address;
    if (line) out = out.replace(line[0], `${name}=${key}`);
    else out = `${out.replace(/\n?$/, "\n")}${name}=${key}\n`;
  }
  return { text: out, filled };
}

if (isMain(import.meta.url)) {
  if (!existsSync(PATHS.env)) {
    copyFileSync(PATHS.envExample, PATHS.env);
    console.log(`created ${PATHS.env} from .env.example`);
  }
  const { text, filled } = fillEnv(readFileSync(PATHS.env, "utf8"));
  const roles = Object.keys(filled) as KeyRole[];
  if (roles.length === 0) {
    console.log("All agent backend keys are already set in .env; nothing changed.");
  } else {
    writeFileSync(PATHS.env, text, { mode: 0o600 });
    chmodSync(PATHS.env, 0o600); // writeFileSync's mode only applies when it creates the file (it may be a copy of .env.example)
    console.log(`Wrote ${roles.length} new key(s) to .env (testnet only; never commit .env). Fund these addresses with Base Sepolia ETH:`);
    for (const r of roles) console.log(`  ${filled[r]}  ${ROLE_LABEL[r]}`);
  }
}
