// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
/**
 * THE CLAIM PATH: everything this UI does with @s01/claims for one investor, top to bottom. A production UI needs the
 * same four steps: get the claim (API), check it (proof, status, preflight), send it, re-check.
 */
import type { Address, Hex, PublicClient, TransactionReceipt, WalletClient } from "viem";
import {
  decodeOrder, isClaimed, orderHash, prepareClaim, processProof, simulateClaim, treeLeaf, verifyProof,
  type ClaimSimulation, type LeafHashing, type PreparedClaim,
} from "@s01/claims";
import { fetchWalletClaims, parseApiClaim, toClaimProof, type ApiClaim, type FillStatus } from "@s01/claims/api";
import { balanceOf, tokenInfo, type TokenInfo } from "./chain";
import type { Loaded } from "./config";

/** One claim the wallet holds: the API's `claim` object, plus what we know about its order. */
export interface WalletClaim {
  flush: string;
  /** e.g. "redemption → USDC". */
  label: string;
  claim: ApiClaim;
  /** The order's Merkle root, when local.json or the proofs file names it (the API's claim does not carry it). */
  root?: Hex;
  /** The API's own view (PROCESSING | CLAIMABLE | CLAIMED); lags the chain by its confirmation depth. */
  apiStatus?: FillStatus;
}

/** In `vite dev`, API calls go through the dev server (the e2e API only allows CORS from its configured origin). */
const apiFetch: typeof fetch = import.meta.env?.DEV
  ? (input, init) => fetch(`/__api?url=${encodeURIComponent(String(input))}`, init)
  : fetch.bind(globalThis);

/** Step 1: every claim of `wallet`, from tsalt.api when there is one, else from the operator's proofs file. */
export async function loadWalletClaims(wallet: Address, loaded: Loaded): Promise<WalletClaim[]> {
  const roots = new Map<string, Hex>();
  for (const d of loaded.config.distributions ?? []) roots.set(d.orderHash.toLowerCase(), d.root);
  for (const o of loaded.proofs?.orders ?? []) roots.set(o.orderHash.toLowerCase(), o.root);

  if (loaded.config.apiUrl) {
    // GET /v1/wallets/{wallet}/purchases and /redemptions, validated; only fills that have a claim.
    const fills = await fetchWalletClaims(wallet, { baseUrl: loaded.config.apiUrl, fetch: apiFetch });
    return fills.map((f) => {
      const root = roots.get(orderHash(f.claim.order).toLowerCase());
      return { flush: f.flush, label: `${f.kind} → ${f.token}`, claim: f.claim, apiStatus: f.status, ...(root ? { root } : {}) };
    });
  }
  return (loaded.proofs?.orders ?? []).flatMap((o) => o.leaves
    .filter((l) => l.wallet.toLowerCase() === wallet.toLowerCase())
    // The proofs file carries the API's claim fields, so the same validator applies.
    .map((l) => ({ flush: o.flush, label: o.token, root: o.root, claim: parseApiClaim({ order: o.order, index: l.index, amount: l.amount, proof: l.proof })! })));
}

export interface ClaimState {
  token: TokenInfo;
  /** Leaf amount in the token's base units. */
  amount: bigint;
  prepared: PreparedClaim;
  /** Local check, no RPC: does the proof fold to the order's root? `ok` is null when the root is unknown. */
  proof: { ok: boolean | null; computedRoot: Hex };
  /** Read from the order's interpreter store: exact, whoever claimed and however. */
  claimed: boolean;
  /** eth_call of the very transaction we would send, from the wallet; on a revert, the strategy's reason via quote3. */
  preflight: ClaimSimulation;
}

/** Step 2: build the transaction and check it, without sending anything. */
export async function checkClaim(client: PublicClient, a: { raindex: Address; hashing: LeafHashing; wallet: Address; wc: WalletClaim }): Promise<ClaimState> {
  const order = decodeOrder(a.wc.claim.order);
  // The token is the order's output; its decimals turn the API's decimal string into base units.
  const token = await tokenInfo(client, order.validOutputs[0]!.token);
  const claim = toClaimProof(a.wc.claim, token.decimals);

  // Signed context (any throwaway key signs it) + takeOrders5 calldata. Only `wallet` can send it: the order hashes
  // msg.sender into the leaf. Pass `verify: { root, hashing }` to make a bad proof throw here instead.
  const prepared = await prepareClaim({ raindex: a.raindex, order, wallet: a.wallet, decimals: token.decimals, claim });

  const computedRoot = processProof(treeLeaf(prepared.leaf, a.hashing), claim.proof);
  const ok = a.wc.root ? verifyProof(a.wc.root, prepared.leaf, claim.proof, a.hashing) : null;

  const [claimed, preflight] = await Promise.all([
    isClaimed(client, { raindex: a.raindex, order, leaf: prepared.leaf }),
    simulateClaim(client, { raindex: a.raindex, wallet: a.wallet, order, signedContext: prepared.signedContext, amount: prepared.amount }),
  ]);
  return { token, amount: claim.amount, prepared, proof: { ok, computedRoot }, claimed, preflight };
}

export type SendResult =
  | { sent: true; hash: Hex; receipt: TransactionReceipt; delta: bigint }
  | { sent: false; reason: string; claimed: boolean };

/**
 * Step 3: preflight on the latest state, then send exactly `{ to, data }` from the wallet (value 0, no approval: the
 * claimant pays nothing). A claim that would revert is not sent: the reason ("…: Claimed", "…: Proof") is returned.
 */
export async function sendClaim(client: PublicClient, wallet: WalletClient, s: ClaimState, raindex: Address): Promise<SendResult> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const p = s.prepared;
  const pre = await simulateClaim(client, { raindex, wallet: account.address, order: p.order, signedContext: p.signedContext, amount: p.amount });
  if (!pre.ok) return { sent: false, reason: pre.reason, claimed: pre.claimed };

  const before = await balanceOf(client, s.token.address, account.address);
  const hash = await wallet.sendTransaction({ account, chain: wallet.chain, to: p.to, data: p.data });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const delta = (await balanceOf(client, s.token.address, account.address)) - before;
  return { sent: true, hash, receipt, delta };
}
