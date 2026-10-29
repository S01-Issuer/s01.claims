// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import { ClaimsError } from "./errors.js";

const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

export function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new ClaimsError("UNSUPPORTED_DECIMALS", `decimals must be an integer 0..18, got ${decimals}`);
}

/**
 * A plain decimal string ("587.46") as base units. Strict by design: more fractional digits than `decimals`
 * ("1.0000000" at 6 dp) is `PRECISION`, never silently trimmed; signs, exponents and leading zeros are refused.
 */
export function parseAmount(text: string, decimals: number): bigint {
  assertDecimals(decimals);
  const m = DECIMAL.exec(text);
  if (!m) throw new ClaimsError("INVALID_AMOUNT", `invalid decimal amount ${JSON.stringify(text)}`);
  const int = m[1]!, frac = m[2] ?? "";
  if (frac.length > decimals)
    throw new ClaimsError("PRECISION", `${text} has ${frac.length} decimal places; token allows ${decimals}`);
  return BigInt(int) * 10n ** BigInt(decimals) + (decimals === 0 ? 0n : BigInt(frac.padEnd(decimals, "0")));
}

/** Base units as the shortest decimal string (no trailing zeros, no exponent). */
export function formatAmount(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (value < 0n) throw new ClaimsError("INVALID_AMOUNT", `negative amount ${value}`);
  if (decimals === 0) return value.toString();
  const s = value.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals), frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Base units at `decimals` rescaled to 18 decimals: the amount the leaf and the signed context carry. */
export function toLeafAmount18(value: bigint, decimals: number): bigint {
  assertDecimals(decimals);
  return value * 10n ** BigInt(18 - decimals);
}
