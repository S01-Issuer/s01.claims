import { encodeFunctionData, type Hex } from "viem";
import { raindexV7ClaimAbi } from "./abi.js";
import type { SignedContext } from "./context.js";
import { ZERO_FLOAT } from "./float.js";
import type { OrderV4 } from "./order.js";

/**
 * RaindexV7 `takeOrders5` calldata for one claim. The transaction MUST be sent by the leaf's wallet: the order
 * hashes `order-counterparty()` (msg.sender) into the leaf. `amount` is the Float word `context[1]`.
 *
 * - minimumIO = maximumIO = amount: a skipped order (already claimed, bad proof) reverts `MinimumIO` instead of
 *   succeeding as a no-op. RaindexV7 skips an order whose calculate-io reverts (`OrderCalculateReverted`) rather
 *   than bubbling "Claimed"/"Proof"; `simulateClaim` recovers that reason through `quote3`.
 * - maximumIORatio = 0: the claim order's ratio is 0, so the claimant can never be charged any input token.
 * - IOIsInput = true: the taker's input is the order's output.
 */
export function buildTakeOrdersCalldata(order: OrderV4, signedContext: readonly SignedContext[], amount: Hex): Hex {
  return encodeFunctionData({
    abi: raindexV7ClaimAbi,
    functionName: "takeOrders5",
    args: [{
      minimumIO: amount,
      maximumIO: amount,
      maximumIORatio: ZERO_FLOAT,
      IOIsInput: true,
      orders: [{ order, inputIOIndex: 0n, outputIOIndex: 0n, signedContext: [...signedContext] }],
      data: "0x",
    }],
  });
}

/** RaindexV7 `quote3` calldata for the same order and context: a view call that bubbles calculate-io reverts. */
export function buildQuoteCalldata(order: OrderV4, signedContext: readonly SignedContext[]): Hex {
  return encodeFunctionData({
    abi: raindexV7ClaimAbi,
    functionName: "quote3",
    args: [{ order, inputIOIndex: 0n, outputIOIndex: 0n, signedContext: [...signedContext] }],
  });
}
