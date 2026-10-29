// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import { formatAmount } from "@s01/claims";

export const short = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

/** Base units as a decimal string with thousands separators (via the library's exact formatter, not floats). */
export function amount(v: bigint, decimals: number): string {
  const s = formatAmount(v < 0n ? -v : v, decimals);
  const [i, f] = s.split(".");
  return `${v < 0n ? "-" : ""}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f ? `.${f}` : ""}`;
}
