import type { Address, Hex, TypedDataDomain } from "viem";
import { buildClaimContext, randomSigner, signClaimContext, type ClaimProof, type ContextSigner, type SignedContext } from "./context.js";
import { ClaimsError } from "./errors.js";
import { buildLeaf, verifyProof, type LeafHashing } from "./leaf.js";
import { orderHash, toOrder, type OrderV4 } from "./order.js";
import { buildTakeOrdersCalldata } from "./take.js";

export interface PrepareClaimArgs {
  /** The RaindexV7 orderbook (e.g. `getDeployment(chainId).raindex`). */
  raindex: Address;
  /** The claim order, as `abi.encode(OrderV4)` bytes (what the API serves) or decoded. */
  order: OrderV4 | Hex;
  /** The wallet that will send the transaction; it must be the leaf's wallet. */
  wallet: Address;
  claim: ClaimProof;
  /** Decimals of the order's output token (18 for tSALT, 6 for USDC). */
  decimals: number;
  /**
   * When given, the proof is checked locally first and a mismatch throws `INVALID_PROOF`. `hashing` is the order's
   * MerkleWords leaf hashing (e.g. `getDeployment(1).merkleLeafHashing`).
   */
  verify?: { root: Hex; hashing: LeafHashing };
  /** Signs the context. Default: a fresh random key (the order does not check the signer). */
  signer?: ContextSigner;
  domain?: TypedDataDomain;
}

export interface PreparedClaim {
  /** Send exactly this from `wallet`: `{ to, data }`, value 0. */
  to: Address;
  data: Hex;
  leaf: Hex;
  orderHash: Hex;
  order: OrderV4;
  /** The amount Float word (= minimumIO = maximumIO). */
  amount: Hex;
  signedContext: SignedContext[];
}

/** Everything in one call: context, signature and `takeOrders5` calldata for one leaf. */
export async function prepareClaim(a: PrepareClaimArgs): Promise<PreparedClaim> {
  const order = toOrder(a.order);
  const leaf = buildLeaf({ index: a.claim.index, wallet: a.wallet, amount: a.claim.amount }, a.decimals);
  if (a.verify !== undefined && !verifyProof(a.verify.root, leaf, a.claim.proof, a.verify.hashing))
    throw new ClaimsError("INVALID_PROOF", `proof does not prove leaf ${leaf} (index ${a.claim.index}, wallet ${a.wallet}) under root ${a.verify.root} (${a.verify.hashing} leaf hashing)`);
  const context = buildClaimContext(a.claim, a.decimals);
  const signed = await signClaimContext(context, a.signer ?? randomSigner(), a.domain);
  const amount = context[1]!;
  return {
    to: a.raindex, data: buildTakeOrdersCalldata(order, [signed], amount),
    leaf, orderHash: orderHash(order), order, amount, signedContext: [signed],
  };
}
