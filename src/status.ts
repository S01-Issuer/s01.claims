import {
  BaseError, ContractFunctionRevertedError, concat, decodeErrorResult, encodeAbiParameters, keccak256, pad, toHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { interpreterStoreV3Abi, raindexV7ClaimAbi } from "./abi.js";
import { orderHash, toOrder, type OrderV4 } from "./order.js";
import type { SignedContext } from "./context.js";
import { buildQuoteCalldata, buildTakeOrdersCalldata } from "./take.js";

/** A viem client that can `call` and `readContract` (a `PublicClient`, or a wallet client extended with public actions). */
export type ReadClient = Pick<PublicClient, "call" | "readContract">;

/**
 * `claims.rain`'s `#claimed-key "claimed"` as the parser stores a string literal (rain.intorastring `fromStringV3`):
 * the bytes right-aligned ending at byte 30, and the last byte `0xe0 | length`.
 */
export const CLAIMED_KEY_WORD: Hex = (() => {
  const s = new TextEncoder().encode("claimed");
  const b = new Uint8Array(32);
  b.set(s, 31 - s.length);
  b[31] = 0xe0 | s.length;
  return toHex(b);
})();

/** The store key `claims.rain` sets to 1 in handle-io: hash(order-hash() leaf "claimed"). */
export function claimedStoreKey(orderHashValue: Hex, leaf: Hex): Hex {
  return keccak256(concat([orderHashValue, leaf, CLAIMED_KEY_WORD]));
}

/**
 * The fully qualified store namespace of `owner`'s orders on `raindex`: RaindexV7 evaluates under
 * `StateNamespace(uint160(owner))`, qualified with the orderbook as the store's caller (`LibNamespace.qualifyNamespace`).
 */
export function orderNamespace(owner: Address, raindex: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [pad(owner, { size: 32 }), raindex]));
}

/**
 * Whether `leaf` of `order` has been claimed on `raindex`: reads the order's own interpreter store. Exact and cheap,
 * and independent of how the claim was run (`takeOrders5` or `clear4`).
 */
export async function isClaimed(client: ReadClient, a: { raindex: Address; order: OrderV4 | Hex; leaf: Hex }): Promise<boolean> {
  const order = toOrder(a.order);
  const value = await client.readContract({
    address: order.evaluable.store, abi: interpreterStoreV3Abi, functionName: "get",
    args: [BigInt(orderNamespace(order.owner, a.raindex)), claimedStoreKey(orderHash(order), a.leaf)],
  });
  return BigInt(value) !== 0n;
}

export type ClaimSimulation =
  | { ok: true }
  | { ok: false; reason: string; claimed: boolean; orderMissing: boolean };

/**
 * Preflight a claim with `eth_call`, from the wallet that will send it. On a revert, RaindexV7's `takeOrders5` only says
 * `MinimumIO` (it skips an order whose calculate-io reverts), so the same order and context are also quoted with
 * `quote3`, which bubbles the strategy's own reason ("Claimed", "Proof"). Never throws for a revert; RPC errors propagate.
 */
export async function simulateClaim(client: ReadClient, a: {
  raindex: Address; wallet: Address; order: OrderV4 | Hex; signedContext: readonly SignedContext[]; amount: Hex;
}): Promise<ClaimSimulation> {
  const order = toOrder(a.order);
  try {
    await client.call({ account: a.wallet, to: a.raindex, data: buildTakeOrdersCalldata(order, a.signedContext, a.amount) });
    return { ok: true };
  } catch (e) {
    const take = revertReason(e);
    let quote: string | undefined;
    let orderMissing = false;
    try {
      const r = await client.call({ account: a.wallet, to: a.raindex, data: buildQuoteCalldata(order, a.signedContext) });
      // quote3 answers (false, 0, 0) for an order that is not live.
      if (r.data !== undefined && BigInt(r.data.slice(0, 66)) === 0n) { orderMissing = true; quote = "order is not live (removed or never added)"; }
    } catch (q) { quote = revertReason(q); }
    const reason = quote !== undefined ? `${take}: ${quote}` : take;
    return { ok: false, reason, claimed: quote === "Claimed", orderMissing };
  }
}

/** A readable revert reason: `Error(string)` text, or `Name(args)` for a RaindexV7 custom error. */
export function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.reason) return reverted.reason;
    const data = findRevertData(e);
    if (data !== undefined) {
      try {
        const d = decodeErrorResult({ abi: raindexV7ClaimAbi, data });
        const args = (d.args ?? []) as readonly unknown[];
        if ((d.errorName as string) === "Error") return String(args[0]);
        return `${d.errorName}(${args.map(String).join(", ")})`;
      } catch { return `revert ${data}`; }
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

function findRevertData(e: BaseError): Hex | undefined {
  let found: Hex | undefined;
  e.walk((x) => {
    const d = (x as { data?: unknown }).data;
    if (typeof d === "string" && /^0x[0-9a-fA-F]{8,}$/.test(d)) { found = d as Hex; return true; }
    if (d && typeof d === "object" && typeof (d as { data?: unknown }).data === "string") { found = (d as { data: Hex }).data; return true; }
    return false;
  });
  return found;
}
