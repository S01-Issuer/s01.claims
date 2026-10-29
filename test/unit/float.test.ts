import { describe, it, expect } from "vitest";
import { Float as RainFloat } from "@rainlanguage/float";
import { floatHex, floatToFixed, packFloat, unpackFloat, ZERO_FLOAT } from "../../src/index.js";

/** The reference: @rainlanguage/float (dev dependency only), which built every deployed tree so far. */
function reference(value: bigint, decimals: number): { hex: string; lossless: boolean } {
  const r = RainFloat.fromFixedDecimalLossy(value, decimals);
  try { const f = r.float; try { return { hex: f.asHex(), lossless: r.lossless }; } finally { f.free(); } } finally { r.free(); }
}

describe("floatHex (the frozen F(v, d))", () => {
  it("encodes index 5 at 0dp as a plain word", () =>
    expect(floatHex(5n, 0)).toBe("0x0000000000000000000000000000000000000000000000000000000000000005"));
  it("is NOT normalized: 6dp and 18dp encodings of 587.46 differ", () => {
    expect(floatHex(587_460_000n, 6)).toBe("0xfffffffa0000000000000000000000000000000000000000000000002303eda0");
    expect(floatHex(587_460_000_000_000_000_000n, 18)).toBe("0xffffffee000000000000000000000000000000000000001fd8a52d80e6fa0000");
  });
  it("encodes zero as the zero word at any decimals", () => { expect(floatHex(0n, 18)).toBe(ZERO_FLOAT); expect(floatHex(0n, 0)).toBe(ZERO_FLOAT); });
  const LOSSY = 1n << 223n;
  it("encodes the largest int224 coefficient exactly", () =>
    expect(floatHex(LOSSY - 1n, 18)).toBe("0xffffffee7fffffffffffffffffffffffffffffffffffffffffffffffffffffff"));
  it("refuses the first lossy value with PRECISION naming it", () =>
    expect(() => floatHex(LOSSY, 18)).toThrow(`[PRECISION] Float encoding of ${LOSSY}e-18 is lossy`));
  it("refuses any value above int224 max, even with only zero digits to shed (as the reference does)", () =>
    expect(() => floatHex(10n ** 70n, 18)).toThrow(/PRECISION/));
  it("refuses negatives and bad decimals", () => {
    expect(() => floatHex(-1n, 0)).toThrow(/INVALID_AMOUNT/);
    expect(() => floatHex(1n, 256)).toThrow(/UNSUPPORTED_DECIMALS/);
  });

  it("is byte-identical to @rainlanguage/float for a spread of values", () => {
    const values = [1n, 9n, 10n, 999_999n, 587_460_000n, 10n ** 18n, 123_456_789_012_345_678_901_234_567_890n, (1n << 200n) + 7n, LOSSY - 1n, 10n ** 70n];
    let seed = 0x5eedn;
    for (let i = 0; i < 200; i++) { seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n); values.push(seed * BigInt(i + 1) ** 7n); }
    for (const d of [0, 6, 18]) for (const v of values) {
      const ref = reference(v, d);
      if (ref.lossless) expect(floatHex(v, d), `${v}e-${d}`).toBe(ref.hex);
      else expect(() => floatHex(v, d), `${v}e-${d} ref ${ref.hex}`).toThrow(/PRECISION/);
    }
  });
});

describe("unpackFloat / floatToFixed", () => {
  it("round-trips coefficient and exponent", () =>
    expect(unpackFloat(floatHex(587_460_000n, 6))).toEqual({ coefficient: 587_460_000n, exponent: -6 }));
  it("reads a negative coefficient", () => expect(unpackFloat(packFloat(-5n, 3))).toEqual({ coefficient: -5n, exponent: 3 }));
  it("converts to base units at other decimals exactly", () => {
    expect(floatToFixed(floatHex(587_460_000n, 6), 18)).toBe(587_460_000_000_000_000_000n);
    expect(floatToFixed(floatHex(587_460_000_000_000_000_000n, 18), 6)).toBe(587_460_000n);
    expect(floatToFixed(packFloat(3n, 2), 0)).toBe(300n);
  });
  it("refuses inexact and negative values", () => {
    expect(() => floatToFixed(floatHex(1n, 18), 6)).toThrow(/PRECISION/);
    expect(() => floatToFixed(packFloat(-1n, 0), 6)).toThrow(/PRECISION/);
  });
});
