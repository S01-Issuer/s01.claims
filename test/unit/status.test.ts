import { describe, it, expect } from "vitest";
import { BaseError, CallExecutionError, concat, encodeAbiParameters, encodeErrorResult, encodeFunctionResult, keccak256, pad, RawContractError, type Hex } from "viem";
import {
  CLAIMED_KEY_WORD, claimedStoreKey, isClaimed, orderHash, orderNamespace, raindexV7ClaimAbi, revertReason, simulateClaim, type ReadClient,
} from "../../src/index.js";
import { ORDER } from "./helpers.js";

const RAINDEX = "0x91b95120D085Aa99C05167f3767eB63460c1dCaC" as const;
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const LEAF = `0x${"cd".repeat(32)}` as Hex;

describe("claim status keys", () => {
  it('"claimed" is the IntOrAString word: bytes right-aligned at byte 30, last byte 0xe0|7', () =>
    expect(CLAIMED_KEY_WORD).toBe(`0x${"00".repeat(24)}636c61696d6564e7`));
  it("store key is keccak(orderHash ‖ leaf ‖ claimed)", () =>
    expect(claimedStoreKey(orderHash(ORDER), LEAF)).toBe(keccak256(concat([orderHash(ORDER), LEAF, CLAIMED_KEY_WORD]))));
  it("namespace is keccak(abi.encode(uint160(owner), raindex))", () =>
    expect(orderNamespace(ORDER.owner, RAINDEX)).toBe(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [BigInt(ORDER.owner), RAINDEX]))));
});

describe("isClaimed", () => {
  const client = (value: Hex, seen: unknown[] = []): ReadClient => ({
    readContract: (async (a: unknown) => { seen.push(a); return value; }) as never,
    call: (async () => { throw new Error("unused"); }) as never,
  });
  it("reads the order's own store at (namespace, key)", async () => {
    const seen: { address: string; functionName: string; args: unknown[] }[] = [];
    expect(await isClaimed(client(pad("0x01"), seen), { raindex: RAINDEX, order: ORDER, leaf: LEAF })).toBe(true);
    expect(seen[0]!.address).toBe(ORDER.evaluable.store);
    expect(seen[0]!.functionName).toBe("get");
    expect(seen[0]!.args).toEqual([BigInt(orderNamespace(ORDER.owner, RAINDEX)), claimedStoreKey(orderHash(ORDER), LEAF)]);
  });
  it("is false for the zero word", async () => expect(await isClaimed(client(pad("0x00")), { raindex: RAINDEX, order: ORDER, leaf: LEAF })).toBe(false));
});

describe("simulateClaim", () => {
  const revert = (data: Hex) => new CallExecutionError(new RawContractError({ data }), { account: undefined as never });
  const errorString = (s: string) => concat(["0x08c379a0", encodeAbiParameters([{ type: "string" }], [s])]);
  const minIO = encodeErrorResult({ abi: raindexV7ClaimAbi, errorName: "MinimumIO", args: [`0x${"11".repeat(32)}`, `0x${"00".repeat(32)}`] });
  const stub = (take: () => Hex, quote: () => Hex): ReadClient => ({
    readContract: (async () => { throw new Error("unused"); }) as never,
    call: (async (a: { data: Hex; account: unknown }) => {
      expect(a.account).toBe(WALLET);
      return { data: a.data.startsWith("0xb0460f07") ? take() : quote() };
    }) as never,
  });
  const args = { raindex: RAINDEX, wallet: WALLET, order: ORDER, signedContext: [], amount: `0x${"00".repeat(32)}` as Hex };
  it("ok when the take does not revert", async () => expect(await simulateClaim(stub(() => "0x", () => "0x"), args)).toEqual({ ok: true }));
  it("explains a MinimumIO with quote3's Claimed", async () => {
    const r = await simulateClaim(stub(() => { throw revert(minIO); }, () => { throw revert(errorString("Claimed")); }), args);
    expect(r).toEqual({ ok: false, claimed: true, orderMissing: false, reason: `MinimumIO(0x${"11".repeat(32)}, 0x${"00".repeat(32)}): Claimed` });
  });
  it("explains a bad proof", async () => {
    const r = await simulateClaim(stub(() => { throw revert(minIO); }, () => { throw revert(errorString("Proof")); }), args);
    expect(r.ok === false && r.reason.endsWith(": Proof") && !r.claimed).toBe(true);
  });
  it("flags an order that is not live", async () => {
    const notLive = encodeFunctionResult({ abi: raindexV7ClaimAbi, functionName: "quote3", result: [false, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`] });
    const r = await simulateClaim(stub(() => { throw revert(minIO); }, () => notLive), args);
    expect(r).toMatchObject({ ok: false, orderMissing: true, claimed: false });
  });
  it("revertReason falls back to the short message", () => expect(revertReason(new BaseError("boom"))).toBe("boom"));
  it("revertReason decodes Error(string)", () => expect(revertReason(revert(errorString("Proof")))).toBe("Proof"));
});
