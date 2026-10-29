// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
/**
 * Optional typed client for the tSALT API's claim fields (`GET /v1/wallets/{address}/purchases` and `/redemptions`,
 * tsalt.api SPEC §5.4–5.5). Separate entry point (`@s01/claims/api`): the core never depends on it.
 */
import { isAddress, type Address, type Hex } from "viem";
import { parseAmount } from "./amounts.js";
import type { ClaimProof } from "./context.js";
import { ClaimsError } from "./errors.js";
import { isWord, TREE_DEPTH } from "./leaf.js";

export type FillStatus = "PROCESSING" | "CLAIMABLE" | "CLAIMED";

/** The API's `claim` object, validated. `amount` stays the decimal string the API sent. */
export interface ApiClaim { order: Hex; index: number; amount: string; proof: Hex[] }

export interface ApiFill { flush: string; status: FillStatus; claim: ApiClaim | null }

/** A fill the wallet can claim, with the token it pays out. */
export interface ClaimableFill {
  kind: "purchase" | "redemption";
  /** The token the claim pays: tSALT for purchases, USDC for redemptions. */
  token: "tSALT" | "USDC";
  flush: string;
  status: FillStatus;
  claim: ApiClaim;
  /** The source entry (deposit or redemption transfer). */
  txHash: Hex;
}

export interface ClaimsApiOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

const STATUSES: readonly FillStatus[] = ["PROCESSING", "CLAIMABLE", "CLAIMED"];

/** Validate one API `claim` object (or `null`). Throws `API` naming the path of the bad field. */
export function parseApiClaim(raw: unknown, path = "claim"): ApiClaim | null {
  if (raw === null) return null;
  const o = obj(raw, path);
  const order = o["order"], index = o["index"], amount = o["amount"], proof = o["proof"];
  if (typeof order !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(order)) bad(`${path}.order`, "must be hex bytes");
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= 2 ** TREE_DEPTH) bad(`${path}.index`, `must be an integer 0..${2 ** TREE_DEPTH - 1}`);
  if (typeof amount !== "string") bad(`${path}.amount`, "must be a decimal string");
  try { parseAmount(amount, 18); } catch { bad(`${path}.amount`, `invalid decimal ${JSON.stringify(amount)}`); }
  if (!Array.isArray(proof) || proof.length !== TREE_DEPTH || !proof.every(isWord)) bad(`${path}.proof`, `must be ${TREE_DEPTH} bytes32 words`);
  return { order: order.toLowerCase() as Hex, index, amount, proof: proof.map((p) => p.toLowerCase() as Hex) };
}

/** The `ClaimProof` for an API claim, in base units of a token with `decimals` decimals. */
export function toClaimProof(claim: ApiClaim, decimals: number): ClaimProof {
  return { index: claim.index, amount: parseAmount(claim.amount, decimals), proof: claim.proof };
}

/** Every fill with a claim (CLAIMABLE or CLAIMED) across the wallet's purchases and redemptions. */
export async function fetchWalletClaims(wallet: Address, opts: ClaimsApiOptions): Promise<ClaimableFill[]> {
  if (!isAddress(wallet, { strict: false })) throw new ClaimsError("INVALID_ADDRESS", `invalid wallet ${wallet}`);
  const [purchases, redemptions] = await Promise.all([
    getJson(`${trim(opts.baseUrl)}/v1/wallets/${wallet}/purchases`, opts),
    getJson(`${trim(opts.baseUrl)}/v1/wallets/${wallet}/redemptions`, opts),
  ]);
  return [
    ...entries(purchases, "purchases", "purchase", "tSALT"),
    ...entries(redemptions, "redemptions", "redemption", "USDC"),
  ];
}

function entries(raw: unknown, path: string, kind: ClaimableFill["kind"], token: ClaimableFill["token"]): ClaimableFill[] {
  if (!Array.isArray(raw)) bad(path, "must be an array");
  const out: ClaimableFill[] = [];
  raw.forEach((e, i) => {
    const entry = obj(e, `${path}[${i}]`);
    const txHash = entry["txHash"];
    if (typeof txHash !== "string" || !isWord(txHash)) bad(`${path}[${i}].txHash`, "must be a 32-byte hash");
    const fills = entry["fills"];
    if (!Array.isArray(fills)) bad(`${path}[${i}].fills`, "must be an array");
    fills.forEach((f, j) => {
      const p = `${path}[${i}].fills[${j}]`;
      const fill = obj(f, p);
      const status = fill["status"], flush = fill["flush"];
      if (typeof status !== "string" || !STATUSES.includes(status as FillStatus)) bad(`${p}.status`, `must be one of ${STATUSES.join(", ")}`);
      if (typeof flush !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(flush)) bad(`${p}.flush`, "must be YYYY-MM-DD");
      const claim = parseApiClaim(fill["claim"] ?? null, `${p}.claim`);
      if (claim) out.push({ kind, token, flush, status: status as FillStatus, claim, txHash: txHash.toLowerCase() as Hex });
    });
  });
  return out;
}

async function getJson(url: string, opts: ClaimsApiOptions): Promise<unknown> {
  const f = opts.fetch ?? globalThis.fetch;
  let res: Response;
  try { res = await f(url, { headers: { accept: "application/json" }, ...(opts.signal ? { signal: opts.signal } : {}) }); }
  catch (e) { throw new ClaimsError("API", `GET ${url} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e }); }
  if (!res.ok) throw new ClaimsError("API", `GET ${url}: HTTP ${res.status}`);
  try { return await res.json(); }
  catch (e) { throw new ClaimsError("API", `GET ${url}: invalid JSON`, { cause: e }); }
}

const trim = (u: string) => u.replace(/\/+$/, "");
function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) bad(path, "must be an object");
  return v as Record<string, unknown>;
}
function bad(path: string, msg: string): never {
  throw new ClaimsError("API", `${path} ${msg}`);
}
