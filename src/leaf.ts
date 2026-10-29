import { concat, isAddress, keccak256, pad, type Address, type Hex } from "viem";
import { toLeafAmount18 } from "./amounts.js";
import { ClaimsError } from "./errors.js";
import { floatHex } from "./float.js";

/** `claims.rain` reads exactly `signed-context<0 2..9>`: every proof has 8 words and every tree 256 leaves. */
export const TREE_DEPTH = 8;
export const MAX_LEAVES = 2 ** TREE_DEPTH;

/** One wallet's entitlement in one claim order. `amount` is in the token's base units. */
export interface LeafInput { index: number; wallet: Address; amount: bigint }

/**
 * THE FROZEN LEAF ENCODING. Changing any byte breaks every deployed claim order.
 *
 *   leaf = keccak256( F(index, 0) ‖ bytes32(uint160(wallet)) ‖ F(amount18, 18) )
 *
 * `amount18` is the amount at 18 decimals whatever the token (Albion's convention), so USDC 587.46 and tSALT 587.46
 * give the same leaf. This mirrors `claims.rain`'s `hash(signed-context<0 0>() order-counterparty() signed-context<0 1>())`.
 */
export function buildLeafRaw(index: bigint, wallet: Address, amount18: bigint): Hex {
  if (!isAddress(wallet, { strict: false })) throw new ClaimsError("INVALID_ADDRESS", `invalid wallet ${wallet}`);
  return keccak256(concat([floatHex(index, 0), pad(wallet.toLowerCase() as Hex, { size: 32 }), floatHex(amount18, 18)]));
}

/** The leaf for `row`, whose amount is in base units of a token with `decimals` decimals. */
export function buildLeaf(row: LeafInput, decimals: number): Hex {
  return buildLeafRaw(BigInt(row.index), row.wallet, toLeafAmount18(row.amount, decimals));
}

/**
 * How the Merkle sub-parser turns the leaf (`buildLeaf`, the frozen encoding) into a tree leaf. It is a property of the
 * deployed `MerkleWords`, not of the leaf encoding, and decides the root and every proof:
 *
 * - `"single"`: the tree leaf is the leaf itself (rain.merkle 0.1.0, e.g. Albion's Base orders; OpenZeppelin
 *   `SimpleMerkleTree`).
 * - `"double"`: the tree leaf is keccak256(leaf) (rain.merkle 0.1.1, deployed on Ethereum: `merkle-proof-verify`
 *   applies the outer hash itself). Since the leaf is keccak256(abi.encode(F(index,0), wallet, F(amount18,18))), this is
 *   exactly an OpenZeppelin `StandardMerkleTree` over `["bytes32", "bytes32", "bytes32"]`.
 */
export type LeafHashing = "single" | "double";

/** The tree leaf for `leaf` under `hashing`. */
export function treeLeaf(leaf: Hex, hashing: LeafHashing): Hex {
  if (hashing === "single") return leaf;
  if (hashing === "double") return keccak256(leaf);
  throw new ClaimsError("INVALID_PROOF", `unknown leaf hashing ${String(hashing)}`);
}

/** keccak256 of the sorted pair: OpenZeppelin `MerkleProof` / `SimpleMerkleTree` node hashing, as `merkle-proof-verify` uses. */
export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** Fold `proof` over `leaf` (OpenZeppelin `processProof`). */
export function processProof(leaf: Hex, proof: readonly Hex[]): Hex {
  return proof.reduce<Hex>((node, sibling) => hashPair(node, sibling), leaf);
}

/**
 * True when `proof` has exactly `TREE_DEPTH` words and proves `leaf` (the `buildLeaf` hash, what the order computes)
 * under `root` for a tree built with `hashing`. Never throws for a bad proof.
 */
export function verifyProof(root: Hex, leaf: Hex, proof: readonly Hex[], hashing: LeafHashing): boolean {
  if (proof.length !== TREE_DEPTH || !proof.every(isWord) || !isWord(root) || !isWord(leaf)) return false;
  if (hashing !== "single" && hashing !== "double") return false;
  return processProof(treeLeaf(leaf, hashing), proof).toLowerCase() === root.toLowerCase();
}

export const isWord = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
