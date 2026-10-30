// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
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

/** "0x" + two 32-byte words. */
const TAKE_RETURN_HEX_LENGTH = 2 + 2 * 64;
const NO_RAINDEX_REASON = "no contract answered at raindex (wrong address or chain)";

export type ClaimSimulation =
  | { ok: true }
  | { ok: false; reason: string; claimed: boolean; orderMissing: boolean };

/**
 * Preflight a claim with `eth_call`, from the wallet that will send it. On a revert, RaindexV7's `takeOrders5` only says
 * `MinimumIO` (it skips an order whose calculate-io reverts), so the same order and context are also quoted with
 * `quote3`, which bubbles the strategy's own reason ("Claimed", "Proof"). A quote that succeeds after that `MinimumIO`
 * means the order is fine but its vault holds less than the claim. Never throws for a revert; RPC errors propagate.
 */
export async function simulateClaim(client: ReadClient, a: {
  raindex: Address; wallet: Address; order: OrderV4 | Hex; signedContext: readonly SignedContext[]; amount: Hex;
}): Promise<ClaimSimulation> {
  const order = toOrder(a.order);
  try {
    const r = await client.call({ account: a.wallet, to: a.raindex, data: buildTakeOrdersCalldata(order, a.signedContext, a.amount) });
    // takeOrders5 returns two Float words. An address with no code also "succeeds", with no data.
    if ((r.data?.length ?? 0) < TAKE_RETURN_HEX_LENGTH) return { ok: false, reason: NO_RAINDEX_REASON, claimed: false, orderMissing: false };
    return { ok: true };
  } catch (e) {
    if (!isRevert(e)) throw e;
    const take = revertReason(e);
    let quote: string | undefined;
    let orderMissing = false;
    try {
      const r = await client.call({ account: a.wallet, to: a.raindex, data: buildQuoteCalldata(order, a.signedContext) });
      // quote3 answers (false, 0, 0) for an order that is not live.
      if (r.data !== undefined && BigInt(r.data.slice(0, 66)) === 0n) { orderMissing = true; quote = "order is not live (removed or never added)"; }
      else if (take.startsWith("MinimumIO(")) quote = "order vault holds less than this claim";
    } catch (q) {
      if (!isRevert(q)) throw q;
      quote = revertReason(q);
    }
    const reason = quote !== undefined ? `${take}: ${quote}` : take;
    return { ok: false, reason, claimed: quote === "Claimed", orderMissing };
  }
}

/** True for a revert from the node; false for a transport failure, which `simulateClaim` lets propagate. */
function isRevert(e: unknown): boolean {
  if (isViemError(e)) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError || (x as Error | undefined)?.name === "ContractFunctionRevertedError");
    return reverted !== null || findRevertData(e) !== undefined || REVERT_TEXT.test(errorText(e));
  }
  return e instanceof Error && REVERT_TEXT.test(e.message);
}
const REVERT_TEXT = /reverted|custom error 0x/i;

/**
 * A readable revert reason: `Error(string)` text, or `Name(args)` for a RaindexV7 custom error.
 *
 * Errors are recognised by shape, not `instanceof`: the client that threw may come from another copy of viem than
 * this library's (a linked or duplicated dependency), and an `instanceof` check would then miss every reason.
 */
export function revertReason(e: unknown): string {
  if (isViemError(e)) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError || (x as Error | undefined)?.name === "ContractFunctionRevertedError");
    const reason = (reverted as { reason?: unknown } | null)?.reason;
    if (typeof reason === "string" && reason) return reason;
    const data = findRevertData(e) ?? revertDataFromText(errorText(e));
    if (data !== undefined) return decodeRevertData(data);
    // No data anywhere (some nodes and proxies only send text): the node's own words, e.g. "execution reverted: Claimed".
    return reasonFromText(errorText(e)) ?? e.shortMessage;
  }
  if (e instanceof Error) return reasonFromText(e.message) ?? e.message;
  return String(e);
}

/** `Error(string)` text, `Name(args)` for a RaindexV7 custom error, else `revert 0x…`. */
function decodeRevertData(data: Hex): string {
  try {
    const d = decodeErrorResult({ abi: raindexV7ClaimAbi, data });
    const args = (d.args ?? []) as readonly unknown[];
    if ((d.errorName as string) === "Error") return String(args[0]);
    return `${d.errorName}(${args.map(String).join(", ")})`;
  } catch { return `revert ${data}`; }
}

/** Every message and details string along the cause chain. */
function errorText(e: BaseError): string {
  const parts: string[] = [];
  e.walk((x) => {
    const o = x as { shortMessage?: unknown; details?: unknown; message?: unknown } | undefined;
    for (const v of [o?.shortMessage, o?.details, o?.message]) if (typeof v === "string") parts.push(v);
    return false;
  });
  return parts.join("\n");
}

/** Anvil/geth text for a custom error: "custom error 0x573b6f41: ffffffee…" (args hex, no 0x) or "custom error 0x573b6f41". */
function revertDataFromText(text: string): Hex | undefined {
  const m = /custom error (0x[0-9a-fA-F]{8})(?::\s*(?:0x)?([0-9a-fA-F]*))?/.exec(text);
  return m ? (`${m[1]}${m[2] ?? ""}` as Hex) : undefined;
}

/** "execution reverted: Claimed" / "reverted with reason: Claimed." → "Claimed". */
function reasonFromText(text: string): string | undefined {
  const m = /(?:execution reverted|reverted with reason):\s*([^\n]+?)\.?\s*$/m.exec(text);
  return m?.[1] && !/^custom error/.test(m[1]) ? m[1] : undefined;
}

function isViemError(e: unknown): e is BaseError {
  return e instanceof BaseError || (e instanceof Error && typeof (e as { walk?: unknown }).walk === "function" && typeof (e as { shortMessage?: unknown }).shortMessage === "string");
}

function findRevertData(e: BaseError): Hex | undefined {
  let found: Hex | undefined;
  e.walk((x) => {
    const d = (x as { data?: unknown } | undefined)?.data;
    if (typeof d === "string" && /^0x[0-9a-fA-F]{8,}$/.test(d)) { found = d as Hex; return true; }
    if (d && typeof d === "object" && typeof (d as { data?: unknown }).data === "string") { found = (d as { data: Hex }).data; return true; }
    return false;
  });
  return found;
}
