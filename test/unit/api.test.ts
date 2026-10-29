import { describe, it, expect } from "vitest";
import { toHex } from "viem";
import { fetchWalletClaims, parseApiClaim, toClaimProof } from "../../src/api.js";

const proof = Array.from({ length: 8 }, (_, i) => toHex(i + 1, { size: 32 }));
const claim = { order: "0xABCD", index: 17, amount: "587.46", proof };
const WALLET = "0x1111111111111111111111111111111111111111";
const tx = `0x${"9c".repeat(32)}`;

function fakeFetch(routes: Record<string, unknown>, status = 200): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    const key = Object.keys(routes).find((k) => u.endsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("parseApiClaim", () => {
  it("accepts the SPEC §5.4 shape and lowercases hex", () =>
    expect(parseApiClaim(claim)).toEqual({ order: "0xabcd", index: 17, amount: "587.46", proof }));
  it("passes null through (not yet distributed)", () => expect(parseApiClaim(null)).toBeNull());
  it.each([
    [{ ...claim, order: "abcd" }, "claim.order"], [{ ...claim, index: 256 }, "claim.index"], [{ ...claim, index: "1" }, "claim.index"],
    [{ ...claim, amount: 587.46 }, "claim.amount"], [{ ...claim, amount: "1e3" }, "claim.amount"],
    [{ ...claim, proof: proof.slice(1) }, "claim.proof"], [{ ...claim, proof: [...proof.slice(1), "0x12"] }, "claim.proof"],
  ])("rejects %j naming %s", (raw, path) => expect(() => parseApiClaim(raw)).toThrow(`[API] ${path}`));
  it("toClaimProof converts the amount at the token's decimals", () =>
    expect(toClaimProof(parseApiClaim(claim)!, 6)).toEqual({ index: 17, amount: 587_460_000n, proof }));
});

describe("fetchWalletClaims", () => {
  const purchases = [{ txHash: tx, fills: [
    { flush: "2026-11-23", status: "CLAIMABLE", claim },
    { flush: "2026-11-30", status: "PROCESSING", claim: null },
  ] }];
  const redemptions = [{ txHash: tx, fills: [{ flush: "2026-11-23", status: "CLAIMED", claim: { ...claim, index: 9, amount: "204.27" } }] }];
  it("collects claims from purchases (tSALT) and redemptions (USDC), skipping unclaimed fills", async () => {
    const r = await fetchWalletClaims(WALLET, { baseUrl: "https://api.example/", fetch: fakeFetch({ [`/v1/wallets/${WALLET}/purchases`]: purchases, [`/v1/wallets/${WALLET}/redemptions`]: redemptions }) });
    expect(r.map((c) => [c.kind, c.token, c.flush, c.status, c.claim.index])).toEqual([
      ["purchase", "tSALT", "2026-11-23", "CLAIMABLE", 17], ["redemption", "USDC", "2026-11-23", "CLAIMED", 9]]);
  });
  it("maps HTTP errors and bad bodies to API errors", async () => {
    await expect(fetchWalletClaims(WALLET, { baseUrl: "https://api.example", fetch: fakeFetch({}) })).rejects.toThrow(/\[API\] GET .* HTTP 404/);
    await expect(fetchWalletClaims(WALLET, { baseUrl: "https://api.example", fetch: fakeFetch({ purchases: { nope: 1 }, redemptions: [] }) })).rejects.toThrow("[API] purchases must be an array");
  });
  it("refuses a bad wallet before any request", async () =>
    expect(fetchWalletClaims("0x12" as never, { baseUrl: "x", fetch: (() => { throw new Error("no"); }) as never })).rejects.toThrow(/INVALID_ADDRESS/));
});
