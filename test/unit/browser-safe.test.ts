import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import pkg from "../../package.json" with { type: "json" };

const dir = new URL("../../src/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

describe("browser-safe, viem-only", () => {
  it.each(files)("%s imports only viem and local modules, and no Node globals", (f) => {
    const src = readFileSync(new URL(f, dir), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const i of imports) expect(i === "viem" || i === "viem/accounts" || i.startsWith("./"), `${f} imports ${i}`).toBe(true);
    expect(src).not.toMatch(/\bprocess\.|\bBuffer\b|\brequire\(/);
  });
  it("viem is the only runtime dependency (a peer)", () => {
    expect(Object.keys((pkg as { dependencies?: object }).dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.peerDependencies)).toEqual(["viem"]);
  });
  it("the index exports the documented API", async () => {
    const m = await import("../../src/index.js");
    for (const name of ["buildLeaf", "verifyProof", "buildClaimContext", "signClaimContext", "buildTakeOrdersCalldata", "isClaimed", "simulateClaim", "prepareClaim", "getDeployment", "floatHex"])
      expect(typeof (m as Record<string, unknown>)[name], name).toBe("function");
  });
});
