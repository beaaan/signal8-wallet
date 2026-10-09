// Checks that web/lib/plan.ts hashes a plan book exactly like the agent does.
//   npm run check:plan-hash [-- <plan-book.json>]
// Runs `npx tsx src/plan.ts <file>` in ../agent (needs `npm install` there) and compares planHash.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkPlanBook, planHash } from "../lib/plan";

const repo = path.resolve(process.cwd(), "..");
const file = path.resolve(process.argv[2] ?? path.join(repo, "data", "fixtures", "plans", "plan-book.example.json"));

const ours = planHash(checkPlanBook(JSON.parse(readFileSync(file, "utf8"))));
console.log(`web   ${ours}`);

let theirs: string;
try {
  const out = execFileSync("npx", ["tsx", "src/plan.ts", file], {
    cwd: path.join(repo, "agent"),
    encoding: "utf8",
    shell: process.platform === "win32", // npx is npx.cmd on Windows
  });
  theirs = JSON.parse(out).planHash;
} catch (e) {
  console.error(`could not run the agent's plan:hash (did you run npm install in agent/?): ${(e as Error).message}`);
  process.exit(2);
}
console.log(`agent ${theirs}`);

if (ours.toLowerCase() !== theirs.toLowerCase()) {
  console.error("MISMATCH: web/lib/plan.ts and agent/src/plan.ts disagree");
  process.exit(1);
}
console.log("OK: same plan hash");
