import { describe, it, expect } from "vitest";
import { parseAmount, formatAmount, toLeafAmount18, ClaimsError } from "../../src/index.js";

const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as ClaimsError).code; } return "NO_THROW"; };

describe("parseAmount", () => {
  it.each([
    ["587.46", 6, 587_460_000n], ["587.46", 18, 587_460_000_000_000_000_000n], ["1", 6, 1_000_000n],
    ["0.000001", 6, 1n], ["1.50", 6, 1_500_000n], ["0", 6, 0n], ["123456789012345678.123456789012345678", 18, 123456789012345678123456789012345678n],
  ])("%s @%i -> %s", (t, d, v) => expect(parseAmount(t, d)).toBe(v));
  it.each(["", " 1", "1.", ".5", "01", "-1", "+1", "1e6", "1,000", "0x10", "1.2.3"])("rejects %j", (t) =>
    expect(code(() => parseAmount(t, 6))).toBe("INVALID_AMOUNT"));
  it("rejects precision beyond decimals", () => expect(code(() => parseAmount("0.0000001", 6))).toBe("PRECISION"));
  it("rejects trailing zeros beyond decimals by design", () => expect(code(() => parseAmount("1.0000000", 6))).toBe("PRECISION"));
  it("rejects bad decimals", () => expect(code(() => parseAmount("1", 19))).toBe("UNSUPPORTED_DECIMALS"));
  it("errors are ClaimsError with a [CODE] prefix", () => {
    try { parseAmount("x", 6); } catch (e) { expect(e).toBeInstanceOf(ClaimsError); expect((e as Error).message).toBe('[INVALID_AMOUNT] invalid decimal amount "x"'); }
  });
});
describe("formatAmount", () => {
  it.each([[587_460_000n, 6, "587.46"], [1n, 6, "0.000001"], [1_000_000n, 6, "1"], [0n, 6, "0"], [5n, 0, "5"],
    [587_460_000_000_000_000_000n, 18, "587.46"]])("%s @%i -> %s", (v, d, t) => expect(formatAmount(v, d)).toBe(t));
  it("round-trips", () => { for (const t of ["587.46", "0.000001", "1", "999999.999999"]) expect(formatAmount(parseAmount(t, 6), 6)).toBe(t); });
  it("rejects negative", () => expect(code(() => formatAmount(-1n, 6))).toBe("INVALID_AMOUNT"));
});
describe("toLeafAmount18", () => {
  it("scales 6dp to 18dp", () => expect(toLeafAmount18(587_460_000n, 6)).toBe(587_460_000_000_000_000_000n));
  it("is identity at 18", () => expect(toLeafAmount18(7n, 18)).toBe(7n));
  it("rejects decimals > 18", () => expect(code(() => toLeafAmount18(1n, 19))).toBe("UNSUPPORTED_DECIMALS"));
});
