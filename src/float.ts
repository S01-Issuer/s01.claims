// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import { type Hex } from "viem";
import { ClaimsError } from "./errors.js";

/**
 * Rain `Float` (rain.math.float): one bytes32 word, the int32 exponent in the top 32 bits and the int224
 * coefficient in the low 224 bits. Floats are NOT normalized: the same value has many encodings, and the leaf
 * hashes the bytes, so the encoding below is part of the frozen leaf contract.
 */
export type Float = Hex;

const INT224_MAX = (1n << 223n) - 1n;
const INT224_MIN = -(1n << 223n);
const MASK224 = (1n << 224n) - 1n;

/**
 * F(value, decimals): `Float.fromFixedDecimalLossy(value, decimals).float.asHex()` of `@rainlanguage/float`
 * 0.0.0-alpha.40, which built every tree so far, and which must be lossless: coefficient = value and
 * exponent = -decimals; zero is the zero word. A value above int224 max is refused (`PRECISION`): the reference
 * library reports any rescaling as lossy, even when only zero digits are shed, so no frozen leaf can contain one.
 */
export function floatHex(value: bigint, decimals: number): Float {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw new ClaimsError("UNSUPPORTED_DECIMALS", `Float decimals must be an integer 0..255, got ${decimals}`);
  if (value < 0n) throw new ClaimsError("INVALID_AMOUNT", `negative value ${value}`);
  if (value === 0n) return ZERO_FLOAT;
  if (value > INT224_MAX) throw new ClaimsError("PRECISION", `Float encoding of ${value}e-${decimals} is lossy`);
  return packFloat(value, -decimals);
}

/** Pack a coefficient and exponent without any rescaling. */
export function packFloat(coefficient: bigint, exponent: number): Float {
  if (coefficient > INT224_MAX || coefficient < INT224_MIN) throw new ClaimsError("PRECISION", `coefficient ${coefficient} does not fit int224`);
  if (!Number.isInteger(exponent) || exponent < -(2 ** 31) || exponent >= 2 ** 31) throw new ClaimsError("PRECISION", `exponent ${exponent} does not fit int32`);
  const word = (BigInt.asUintN(32, BigInt(exponent)) << 224n) | (coefficient & MASK224);
  return `0x${word.toString(16).padStart(64, "0")}`;
}

/** Split a Float word into its signed coefficient and exponent. */
export function unpackFloat(float: Hex): { coefficient: bigint; exponent: number } {
  if (!/^0x[0-9a-fA-F]{64}$/.test(float)) throw new ClaimsError("INVALID_AMOUNT", `not a bytes32 Float: ${float}`);
  const w = BigInt(float);
  return { coefficient: BigInt.asIntN(224, w & MASK224), exponent: Number(BigInt.asIntN(32, w >> 224n)) };
}

/**
 * A Float as exact base units at `decimals` (e.g. a vault balance). Throws `PRECISION` when the value is negative or
 * not an exact multiple of 10^-decimals.
 */
export function floatToFixed(float: Hex, decimals: number): bigint {
  const { coefficient, exponent } = unpackFloat(float);
  if (coefficient < 0n) throw new ClaimsError("PRECISION", `negative Float ${float}`);
  const shift = exponent + decimals;
  if (shift >= 0) return coefficient * 10n ** BigInt(shift);
  const div = 10n ** BigInt(-shift);
  if (coefficient % div !== 0n) throw new ClaimsError("PRECISION", `Float ${float} is not an exact multiple of 10^-${decimals}`);
  return coefficient / div;
}

/** The zero Float (also F(0, d) for every d). */
export const ZERO_FLOAT: Float = `0x${"0".repeat(64)}`;

/** a < b for non-negative Floats, by value: the same value has many encodings, so the words cannot be compared. */
export function floatLessThan(a: Hex, b: Hex): boolean {
  const x = unpackFloat(a), y = unpackFloat(b);
  if (x.coefficient === 0n || y.coefficient === 0n) return x.coefficient < y.coefficient;
  const gap = x.exponent - y.exponent;
  // A coefficient is under 10^68, so past this gap the exponents decide, and the power of ten need not be built.
  if (Math.abs(gap) > 68) return gap < 0;
  return gap >= 0 ? x.coefficient * 10n ** BigInt(gap) < y.coefficient : x.coefficient < y.coefficient * 10n ** BigInt(-gap);
}
