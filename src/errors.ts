// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
export type ClaimsErrorCode =
  | "INVALID_AMOUNT" | "PRECISION" | "UNSUPPORTED_DECIMALS" | "INVALID_ADDRESS" | "INVALID_PROOF"
  | "INVALID_ORDER" | "UNSUPPORTED_CHAIN" | "API";

/** Every error this library throws. `message` starts with `[code]`. */
export class ClaimsError extends Error {
  constructor(public readonly code: ClaimsErrorCode, message: string, options?: { cause?: unknown }) {
    super(`[${code}] ${message}`, options);
    this.name = "ClaimsError";
  }
}
