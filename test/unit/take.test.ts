import { describe, it, expect } from "vitest";
import { decodeFunctionData, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildClaimContext, buildQuoteCalldata, buildTakeOrdersCalldata, decodeOrder, encodeOrder, orderHash, prepareClaim,
  raindexV7ClaimAbi, signClaimContext, ZERO_FLOAT, buildLeaf,
} from "../../src/index.js";
import { ORDER } from "./helpers.js";

const proof = Array.from({ length: 8 }, (_, i) => toHex(i + 1, { size: 32 }));
const claim = { index: 0, amount: 587_460_000n, proof };

describe("order encoding", () => {
  it("round-trips abi.encode(OrderV4) and hashes it like LibOrder.hash", () => {
    const bytes = encodeOrder(ORDER);
    expect(decodeOrder(bytes)).toEqual(ORDER);
    expect(orderHash(bytes)).toBe(orderHash(ORDER));
    expect(orderHash(ORDER)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("refuses garbage with INVALID_ORDER", () => expect(() => decodeOrder("0x1234")).toThrow(/INVALID_ORDER/));
});

describe("buildTakeOrdersCalldata (RaindexV7 takeOrders5)", () => {
  it("encodes IOIsInput=true, min=max=amount, maximumIORatio=0, one order at IO 0/0", async () => {
    const ctx = buildClaimContext(claim, 6);
    const signed = await signClaimContext(ctx, privateKeyToAccount(`0x${"01".repeat(32)}`));
    const data = buildTakeOrdersCalldata(ORDER, [signed], ctx[1]!);
    expect(data.slice(0, 10)).toBe("0xb0460f07");
    const dec = decodeFunctionData({ abi: raindexV7ClaimAbi, data });
    if (dec.functionName !== "takeOrders5") throw new Error(`decoded ${dec.functionName}`);
    const cfg = dec.args[0];
    expect(cfg.IOIsInput).toBe(true);
    expect(cfg.minimumIO).toBe(ctx[1]); expect(cfg.maximumIO).toBe(ctx[1]);
    expect(cfg.maximumIORatio).toBe(ZERO_FLOAT);
    expect(cfg.data).toBe("0x");
    expect(cfg.orders).toHaveLength(1);
    expect(cfg.orders[0]!.order).toEqual(ORDER);
    expect([cfg.orders[0]!.inputIOIndex, cfg.orders[0]!.outputIOIndex]).toEqual([0n, 0n]);
    expect(cfg.orders[0]!.signedContext[0]).toEqual(signed);
  });
  it("buildQuoteCalldata is quote3 over the same order and context", async () => {
    const signed = await signClaimContext(buildClaimContext(claim, 6), privateKeyToAccount(`0x${"01".repeat(32)}`));
    const data = buildQuoteCalldata(ORDER, [signed]);
    expect(data.slice(0, 10)).toBe("0xddebc96f");
    const dec = decodeFunctionData({ abi: raindexV7ClaimAbi, data });
    if (dec.functionName !== "quote3") throw new Error(`decoded ${dec.functionName}`);
    expect(dec.args[0].signedContext[0]).toEqual(signed);
  });
});

describe("prepareClaim", () => {
  const wallet = "0x1111111111111111111111111111111111111111" as const;
  it("returns to/data for the wallet, with the leaf and order hash", async () => {
    const p = await prepareClaim({ raindex: "0x91b95120D085Aa99C05167f3767eB63460c1dCaC", order: encodeOrder(ORDER), wallet, claim, decimals: 6 });
    expect(p.to).toBe("0x91b95120D085Aa99C05167f3767eB63460c1dCaC");
    expect(p.data.slice(0, 10)).toBe("0xb0460f07");
    expect(p.leaf).toBe(buildLeaf({ index: 0, wallet, amount: claim.amount }, 6));
    expect(p.orderHash).toBe(orderHash(ORDER));
    expect(p.amount).toBe(buildClaimContext(claim, 6)[1]);
  });
  it("checks the proof locally when given a root", async () =>
    expect(prepareClaim({ raindex: "0x91b95120D085Aa99C05167f3767eB63460c1dCaC", order: ORDER, wallet, claim, decimals: 6, verify: { root: `0x${"ab".repeat(32)}`, hashing: "double" } }))
      .rejects.toThrow(/INVALID_PROOF/));
});
