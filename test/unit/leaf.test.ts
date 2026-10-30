// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SimpleMerkleTree, StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { keccak256, pad, zeroAddress, type Address, type Hex } from "viem";
import { buildLeaf, buildLeafRaw, ethereum, floatHex, hashPair, processProof, treeLeaf, verifyProof, MAX_LEAVES, TREE_DEPTH } from "../../src/index.js";

const W1 = "0x1111111111111111111111111111111111111111";

describe("buildLeafRaw (albion.rewards src/lib/__tests__/leaf.test.ts vector)", () => {
  it("matches Albion's v6 leaf", () =>
    expect(buildLeafRaw(5n, "0x8f6bF4A948Af2Fc74eE34982C4435a7C013D1A52", 4924897972993079296n))
      .toBe("0x2b76fb4e1b93ccba9dd70c9f0127a4ddd2576e89b709759b653f19ee592236e7"));
  it("is case-insensitive in the address", () =>
    expect(buildLeafRaw(5n, "0x8f6bf4a948af2fc74ee34982c4435a7c013d1a52", 4924897972993079296n))
      .toBe("0x2b76fb4e1b93ccba9dd70c9f0127a4ddd2576e89b709759b653f19ee592236e7"));
  it("refuses a malformed wallet", () => expect(() => buildLeafRaw(0n, "0x1234" as Address, 1n)).toThrow(/INVALID_ADDRESS/));
});

describe("buildLeaf (canonical 18dp amount word, README §3 vector)", () => {
  const expected = "0x75192eff675f73d3d738d8bf8c6813b57223be2f7bff2fbbda4b026fcf963ecf";
  it("USDC 587.46", () => expect(buildLeaf({ index: 0, wallet: W1, amount: 587_460_000n }, 6)).toBe(expected));
  it("tSALT 587.46 gives the SAME leaf (decimal-invariant)", () =>
    expect(buildLeaf({ index: 0, wallet: W1, amount: 587_460_000_000_000_000_000n }, 18)).toBe(expected));
  it("changes with index", () => expect(buildLeaf({ index: 1, wallet: W1, amount: 587_460_000n }, 6)).not.toBe(expected));
  it("refuses a lossy amount with PRECISION", () =>
    expect(() => buildLeaf({ index: 0, wallet: W1, amount: 1n << 223n }, 18)).toThrow(`[PRECISION] Float encoding of ${1n << 223n}e-18 is lossy`));
});

const albion = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8").trim().split("\n").slice(1)
  .map((l) => l.split(",").map((s) => s.trim()) as [string, Address, string]);

describe("verifyProof (single) against Albion's deployed roots (trees built by OpenZeppelin, dev dependency only)", () => {
  it.each([
    ["2026-08-r1.csv", "0x13595e07b47595143f3c8574b2a03918d8faac9de11cc20a4eb15187673efb4e"],
    ["2026-08-r2.csv", "0x05c01946e995e57d20ea0da400ca15e1f276d8abc3a1015c215d334fe285e7d6"],
  ])("%s: root %s, every proof verifies", (file, root) => {
    const leaves = albion(file).map(([i, a, m]) => buildLeafRaw(BigInt(i), a, BigInt(m)));
    expect(leaves).toHaveLength(MAX_LEAVES);
    const tree = SimpleMerkleTree.of(leaves);
    expect(tree.root).toBe(root);
    leaves.forEach((leaf, i) => {
      const proof = tree.getProof(i) as Hex[];
      expect(proof).toHaveLength(TREE_DEPTH);
      expect(verifyProof(root as Hex, leaf, proof, "single")).toBe(true);
      expect(verifyProof(root as Hex, leaf, proof, "double")).toBe(false);
    });
  });
});

describe("verifyProof (single, the s01.distributions design vector)", () => {
  const rows = [
    { index: 0, wallet: W1 as Address, amount: 587_460_000n },
    { index: 1, wallet: "0x2222222222222222222222222222222222222222" as Address, amount: 204_270_000n },
    { index: 2, wallet: "0x3333333333333333333333333333333333333333" as Address, amount: 1_000_000n },
  ];
  const leaves = [...rows.map((r) => buildLeaf(r, 6)), ...Array.from({ length: MAX_LEAVES - 3 }, (_, i) => buildLeafRaw(BigInt(i + 3), zeroAddress, 0n))];
  const tree = SimpleMerkleTree.of(leaves);
  const root = tree.root as Hex;
  it("matches the s01.distributions design vector root", () => expect(root).toBe("0x15d6d7635573eab26451143d8d66fd5cce1d7aa5969c9353897943fa69368cca"));
  const proof0 = tree.getProof(0) as Hex[];
  it("pins the first proof word", () => expect(proof0[0]).toBe("0x74836172fb4212ca04892687152cb8805e213f552be6f09df8924c90d45757ad"));
  it("accepts the real leaf", () => expect(verifyProof(root, leaves[0]!, proof0, "single")).toBe(true));
  it("rejects another amount, another wallet, another index", () => {
    expect(verifyProof(root, buildLeaf({ ...rows[0]!, amount: rows[0]!.amount + 1n }, 6), proof0, "single")).toBe(false);
    expect(verifyProof(root, buildLeaf({ ...rows[0]!, wallet: rows[1]!.wallet }, 6), proof0, "single")).toBe(false);
    expect(verifyProof(root, buildLeaf({ ...rows[0]!, index: 1 }, 6), proof0, "single")).toBe(false);
  });
  it("rejects proofs that are not 8 words or not hex words", () => {
    expect(verifyProof(root, leaves[0]!, proof0.slice(0, 7), "single")).toBe(false);
    expect(verifyProof(root, leaves[0]!, [...proof0, proof0[0]!], "single")).toBe(false);
    expect(verifyProof(root, leaves[0]!, [...proof0.slice(0, 7), "0x1234"], "single")).toBe(false);
  });
  it("hashPair is commutative and processProof folds it", () => {
    expect(hashPair(leaves[0]!, leaves[1]!)).toBe(hashPair(leaves[1]!, leaves[0]!));
    expect(processProof(leaves[0]!, proof0)).toBe(root);
  });
});

describe("double leaf hashing (rain.merkle 0.1.1 on Ethereum)", () => {
  const rows = [
    { index: 0, wallet: W1 as Address, amount: 587_460_000n },
    { index: 1, wallet: "0x2222222222222222222222222222222222222222" as Address, amount: 204_270_000n },
    { index: 2, wallet: "0x3333333333333333333333333333333333333333" as Address, amount: 1_000_000n },
  ];
  const all = [...rows, ...Array.from({ length: MAX_LEAVES - 3 }, (_, i) => ({ index: i + 3, wallet: zeroAddress as Address, amount: 0n }))];
  const leaves = all.map((r) => buildLeaf(r, 6));
  const tree = SimpleMerkleTree.of(leaves.map((l) => treeLeaf(l, "double")));
  const root = tree.root as Hex;
  it("Ethereum's MerkleWords is double", () => expect(ethereum.merkleLeafHashing).toBe("double"));
  it("treeLeaf double is keccak256(leaf); single is the leaf", () => {
    expect(treeLeaf(leaves[0]!, "double")).toBe(keccak256(leaves[0]!));
    expect(treeLeaf(leaves[0]!, "single")).toBe(leaves[0]);
  });
  it("is exactly an OpenZeppelin StandardMerkleTree over (F(index,0), wallet, F(amount18,18)) as bytes32", () => {
    const values = all.map((r) => [floatHex(BigInt(r.index), 0), pad(r.wallet.toLowerCase() as Hex, { size: 32 }), floatHex(r.amount * 10n ** 12n, 18)]);
    const std = StandardMerkleTree.of(values, ["bytes32", "bytes32", "bytes32"]);
    expect(std.root).toBe(root);
    expect(verifyProof(root, leaves[1]!, std.getProof(1) as Hex[], "double")).toBe(true);
  });
  it("verifies every real leaf only under double hashing", () => {
    for (let i = 0; i < 3; i++) {
      const proof = tree.getProof(i) as Hex[];
      expect(verifyProof(root, leaves[i]!, proof, "double")).toBe(true);
      expect(verifyProof(root, leaves[i]!, proof, "single")).toBe(false);
    }
  });
  it("rejects an unknown hashing", () => expect(verifyProof(root, leaves[0]!, tree.getProof(0) as Hex[], "triple" as never)).toBe(false));
});
