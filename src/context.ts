import { domainSeparator, type Address, type Hex, type TypedDataDomain } from "viem";
import { generatePrivateKey, privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { parseAmount, toLeafAmount18 } from "./amounts.js";
import { ClaimsError } from "./errors.js";
import { floatHex } from "./float.js";
import { isWord, TREE_DEPTH } from "./leaf.js";

/** What a claimant holds for one leaf: the tSALT API `claim` object without `order`. */
export interface ClaimProof { index: number; amount: bigint; proof: readonly Hex[] }

/** RaindexV7 `SignedContextV2`. */
export interface SignedContext { signer: Address; domainSeparator: Hex; context: Hex[]; signature: Hex }

/** Anything that can produce an EIP-712 signature: a viem `LocalAccount` (throwaway key) or a wallet-backed account. */
export type ContextSigner = Pick<LocalAccount, "address" | "signTypedData">;

/** The amount word `claims.rain` reads as `signed-context<0 1>`: F(amount·10^(18−decimals), 18), the leaf's own encoding. */
export function claimAmountWord(amount: bigint, decimals: number): Hex {
  return floatHex(toLeafAmount18(amount, decimals), 18);
}

/** The same word from the API's decimal string ("587.46"): at 18 dp it does not depend on the token's decimals. */
export function claimAmountWordFromDecimal(amount: string): Hex {
  return floatHex(parseAmount(amount, 18), 18);
}

/**
 * Signed-context words for `claims.rain`: [F(index,0), F(amount·10^(18−d),18), proof[0..7]]. The amount word is the
 * 18-decimal Float the leaf hashes, never the token's native-decimals amount (that gives another leaf, and "Proof").
 */
export function buildClaimContext(claim: ClaimProof, decimals: number): Hex[] {
  if (claim.proof.length !== TREE_DEPTH)
    throw new ClaimsError("INVALID_PROOF", `proof must have ${TREE_DEPTH} words, got ${claim.proof.length}`);
  if (!claim.proof.every(isWord)) throw new ClaimsError("INVALID_PROOF", "every proof word must be 32-byte hex");
  if (!Number.isSafeInteger(claim.index) || claim.index < 0) throw new ClaimsError("INVALID_PROOF", `invalid leaf index ${claim.index}`);
  return [floatHex(BigInt(claim.index), 0), claimAmountWord(claim.amount, decimals), ...claim.proof];
}

/** The EIP-712 domain claim contexts are signed under. `claims.rain` checks neither signer nor domain. */
export const CLAIM_SIGNING_DOMAIN = { name: "s01.claims", version: "1" } as const satisfies TypedDataDomain;

/** EIP-712 types of `SignedContextV2` (rainlang `SIGNED_CONTEXT_V2_TYPE`). */
export const SIGNED_CONTEXT_V2_TYPES = {
  SignedContextV2: [
    { name: "signer", type: "address" },
    { name: "context", type: "bytes32[]" },
  ],
} as const;

/**
 * Sign `context` as RaindexV7 verifies it (rainlang `LibContext.buildV2`): EIP-712 typed data
 * `SignedContextV2(address signer,bytes32[] context)` under `domain`, whose separator travels in the struct.
 * The order never checks who signed, so a throwaway key is fine (see `randomSigner`).
 */
export async function signClaimContext(context: readonly Hex[], signer: ContextSigner, domain: TypedDataDomain = CLAIM_SIGNING_DOMAIN): Promise<SignedContext> {
  const signature = await signer.signTypedData({
    domain, types: SIGNED_CONTEXT_V2_TYPES, primaryType: "SignedContextV2",
    message: { signer: signer.address, context: [...context] },
  });
  return { signer: signer.address, domainSeparator: domainSeparator({ domain }), context: [...context], signature };
}

/** A fresh random key that exists only to sign one claim context. */
export const randomSigner = (): LocalAccount => privateKeyToAccount(generatePrivateKey());
