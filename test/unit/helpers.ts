// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import type { OrderV4 } from "../../src/index.js";

/** A synthetic order (not on chain) for encoding tests. */
export const ORDER: OrderV4 = {
  owner: "0x4444444444444444444444444444444444444444",
  evaluable: { interpreter: "0x5555555555555555555555555555555555555555", store: "0x6666666666666666666666666666666666666666", bytecode: "0x01" },
  validInputs: [{ token: "0x7777777777777777777777777777777777777777", vaultId: `0x${"01".repeat(32)}` }],
  validOutputs: [{ token: "0x8888888888888888888888888888888888888888", vaultId: `0x${"01".repeat(32)}` }],
  nonce: `0x${"02".repeat(32)}`,
};
