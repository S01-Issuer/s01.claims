// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import { decodeAbiParameters, encodeAbiParameters, keccak256, type AbiParameterToPrimitiveType, type Hex } from "viem";
import { orderV4Param } from "./abi.js";
import { ClaimsError } from "./errors.js";

/** A Raindex `OrderV4` as viem decodes it. */
export type OrderV4 = AbiParameterToPrimitiveType<typeof orderV4Param>;

/** `abi.encode(OrderV4)` (the `order` field the tSALT API serves) to a struct. Throws `INVALID_ORDER`. */
export function decodeOrder(orderBytes: Hex): OrderV4 {
  try {
    const [order] = decodeAbiParameters([orderV4Param], orderBytes);
    return order;
  } catch (e) {
    throw new ClaimsError("INVALID_ORDER", `cannot decode OrderV4: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`, { cause: e });
  }
}

export function encodeOrder(order: OrderV4): Hex {
  return encodeAbiParameters([orderV4Param], [order]);
}

/** `LibOrder.hash`: keccak256(abi.encode(order)). What `orderExists`, `order-hash()` and the events use. */
export function orderHash(order: OrderV4 | Hex): Hex {
  return keccak256(typeof order === "string" ? encodeOrder(decodeOrder(order)) : encodeOrder(order));
}

/** Accept either the encoded bytes or the struct. */
export const toOrder = (order: OrderV4 | Hex): OrderV4 => (typeof order === "string" ? decodeOrder(order) : order);
