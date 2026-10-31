// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import { describe, it, expect } from "vitest";
import { BaseError, CallExecutionError, HttpRequestError, concat, encodeAbiParameters, encodeErrorResult, encodeFunctionResult, keccak256, pad, RawContractError, type Hex } from "viem";
import {
  CLAIMED_KEY_WORD, ZERO_FLOAT, claimedStoreKey, floatHex, floatLessThan, isClaimed, packFloat, orderHash, orderNamespace, raindexV7ClaimAbi, revertReason, simulateClaim, type ReadClient,
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
  const twoWords = `0x${"00".repeat(64)}` as Hex;
  it("ok when the take does not revert", async () => expect(await simulateClaim(stub(() => twoWords, () => "0x"), args)).toEqual({ ok: true }));
  it("is not ok when nothing answers at raindex", async () => {
    const empty: ReadClient = { readContract: (async () => { throw new Error("unused"); }) as never, call: (async () => ({ data: undefined })) as never };
    expect(await simulateClaim(empty, args)).toMatchObject({ ok: false, claimed: false, orderMissing: false });
  });
  it("lets an RPC failure propagate, from the take and from the quote", async () => {
    const down = () => { throw new HttpRequestError({ url: "http://node", status: 503, details: "unavailable" }); };
    await expect(simulateClaim(stub(down, () => "0x"), args)).rejects.toBeInstanceOf(HttpRequestError);
    await expect(simulateClaim(stub(() => { throw revert(minIO); }, down), args)).rejects.toBeInstanceOf(HttpRequestError);
  });
  describe("a take that reverts MinimumIO while the quote answers", () => {
    const quoted = (outputMax: Hex, ioRatio: Hex) => encodeFunctionResult({ abi: raindexV7ClaimAbi, functionName: "quote3", result: [true, outputMax, ioRatio] });
    const run = (outputMax: Hex, ioRatio: Hex = ZERO_FLOAT) =>
      simulateClaim(stub(() => { throw revert(minIO); }, () => quoted(outputMax, ioRatio)), { ...args, amount: floatHex(5n * 10n ** 18n, 18) });
    it("names a vault short of the claim, whatever the encoding", async () => {
      const r = await run(floatHex(4n, 0));
      expect(r).toMatchObject({ ok: false, claimed: false, orderMissing: false });
      expect(r.ok === false && r.reason.endsWith(": order vault holds less than this claim")).toBe(true);
    });
    it("does not blame a vault that covers the claim", async () => {
      const r = await run(floatHex(5n, 0));
      expect(r.ok === false && !r.reason.includes("vault") && /^MinimumIO\(.*\)$/.test(r.reason)).toBe(true);
    });
    it.each([["no data", undefined], ["empty data", "0x"], ["two words", `0x${"00".repeat(64)}`]])("reports the take alone for a quote with %s", async (_, data) => {
      const r = await simulateClaim(stub(() => { throw revert(minIO); }, () => data as Hex), args);
      expect(r).toMatchObject({ ok: false, claimed: false, orderMissing: false });
      expect(r.ok === false && /^MinimumIO\(0x[^:]*\)$/.test(r.reason)).toBe(true);
    });
    it("names a ratio above the take's 0", async () => {
      const r = await run(floatHex(5n, 0), floatHex(1n, 0));
      expect(r.ok === false && r.reason.endsWith(": order's IO ratio is above 0")).toBe(true);
    });
  });
  it("floatLessThan compares values, not encodings, and survives far-apart exponents", () => {
    expect(floatLessThan(floatHex(4n, 0), floatHex(5n * 10n ** 18n, 18))).toBe(true);
    expect(floatLessThan(floatHex(5n, 0), floatHex(5n * 10n ** 18n, 18))).toBe(false);
    expect(floatLessThan(ZERO_FLOAT, floatHex(1n, 0))).toBe(true);
    expect(floatLessThan(packFloat(1n, 2_000_000_000), floatHex(1n, 0))).toBe(false);
    expect(floatLessThan(floatHex(1n, 0), packFloat(1n, 2_000_000_000))).toBe(true);
    expect(floatLessThan(packFloat(0n, 2_000_000_000), floatHex(1n, 0))).toBe(true);
    expect(floatLessThan(floatHex(1n, 0), packFloat(0n, 2_000_000_000))).toBe(false);
  });
  it("floatLessThan refuses a negative Float", () => {
    expect(() => floatLessThan(packFloat(-1n, 100), floatHex(1n, 0))).toThrow(/negative Float/);
    expect(() => floatLessThan(floatHex(1n, 0), packFloat(-1n, 0))).toThrow(/negative Float/);
  });
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
  // Regression (e2e run on Anvil): simulateClaim said claimed:false for a claimed leaf. These are the error chains a node
  // gives when the revert data is not on the error, only in its text.
  const textOnly = (details: string) => new CallExecutionError(new BaseError(`Execution reverted with reason: ${details.replace(/^execution reverted: /, "")}.`, { details }), { account: undefined as never });
  const minIOText = `execution reverted: custom error 0x573b6f41: ${minIO.slice(10)}`;
  it("revertReason reads Error(string) from the node's text when there is no revert data", () => {
    expect(revertReason(textOnly("execution reverted: Claimed"))).toBe("Claimed");
    expect(revertReason(new Error("Execution reverted with reason: Proof."))).toBe("Proof");
  });
  it("revertReason decodes a custom error from the node's text when there is no revert data", () => {
    expect(revertReason(textOnly(minIOText))).toBe(revertReason(revert(minIO)));
    expect(revertReason(textOnly(minIOText))).toMatch(/^MinimumIO\(0x/);
  });
  it("simulateClaim flags claimed when both reverts carry text only", async () => {
    const r = await simulateClaim(stub(() => { throw textOnly(minIOText); }, () => { throw textOnly("execution reverted: Claimed"); }), args);
    expect(r).toMatchObject({ ok: false, claimed: true, orderMissing: false });
    expect(r.ok === false && /^MinimumIO\(0x.*\): Claimed$/.test(r.reason)).toBe(true);
  });
  it("revertReason reads errors thrown by another copy of viem (no instanceof)", () => {
    // What a duplicated viem throws: same shape (walk, shortMessage, cause chain), different classes.
    class ForeignError extends Error {
      constructor(public shortMessage: string, public override cause?: unknown, public data?: Hex) { super(`${shortMessage}\n\nRaw Call Arguments: …`); }
      walk(fn: (e: unknown) => boolean): unknown { let e: unknown = this; while (e) { if (fn(e)) return e; e = (e as { cause?: unknown }).cause; } return null; }
    }
    const withData = new ForeignError("Execution reverted", new ForeignError("raw", undefined, errorString("Claimed")));
    expect(revertReason(withData)).toBe("Claimed");
    const decoded = Object.assign(new ForeignError("reverted"), { name: "ContractFunctionRevertedError", reason: "Proof" });
    expect(revertReason(new ForeignError("Execution reverted", decoded))).toBe("Proof");
  });
});
