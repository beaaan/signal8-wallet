import { describe, expect, it } from "vitest";
import { withEvidence } from "../src/evidence.ts";

describe("evidence --write", () => {
  const doc = "# Evidence\n\n## Latest run\n\n<!-- evidence:start -->\nold rows\n<!-- evidence:end -->\n\n## Yagi\n";

  it("replaces only the text between the markers", () => {
    const out = withEvidence(doc, "| 1 | new |");
    expect(out).toBe("# Evidence\n\n## Latest run\n\n<!-- evidence:start -->\n| 1 | new |\n<!-- evidence:end -->\n\n## Yagi\n");
    expect(withEvidence(out, "| 2 |")).toContain("<!-- evidence:start -->\n| 2 |\n<!-- evidence:end -->");
  });

  it("refuses a document without the markers", () => {
    expect(() => withEvidence("# Evidence\n", "x")).toThrow(/no <!-- evidence:start -->/);
  });
});
