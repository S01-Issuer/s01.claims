// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import { describe, it, expect } from "vitest";
import { concat, encodeAbiParameters, keccak256, recoverAddress, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildClaimContext, CLAIM_SIGNING_DOMAIN, claimAmountWord, claimAmountWordFromDecimal, floatHex, randomSigner, signClaimContext,
} from "../../src/index.js";

const proof = Array.from({ length: 8 }, (_, i) => toHex(i + 1, { size: 32 }));
const claim = { index: 17, amount: 587_460_000n, proof };

describe("buildClaimContext", () => {
  it("is [F(index,0), F(amount18,18), ...8 proof words]", () => {
    const ctx = buildClaimContext(claim, 6);
    expect(ctx).toHaveLength(10);
    expect(ctx[0]).toBe(floatHex(17n, 0));
    expect(ctx[1]).toBe("0xffffffee000000000000000000000000000000000000001fd8a52d80e6fa0000");
    expect(ctx.slice(2)).toEqual(proof);
  });
  it("uses the 18-dp amount word whatever the token's decimals", () =>
    expect(buildClaimContext({ ...claim, amount: 587_460_000_000_000_000_000n }, 18)[1]).toBe(buildClaimContext(claim, 6)[1]));
  it("claimAmountWord and claimAmountWordFromDecimal agree", () => {
    expect(claimAmountWord(587_460_000n, 6)).toBe(claimAmountWordFromDecimal("587.46"));
    expect(claimAmountWordFromDecimal("204.27")).toBe(floatHex(204_270_000_000_000_000_000n, 18));
  });
  it("rejects a proof that is not 8 words, a non-hex word or a bad index", () => {
    expect(() => buildClaimContext({ ...claim, proof: proof.slice(1) }, 6)).toThrow("[INVALID_PROOF] proof must have 8 words, got 7");
    expect(() => buildClaimContext({ ...claim, proof: [...proof.slice(1), "0x12"] }, 6)).toThrow(/INVALID_PROOF/);
    expect(() => buildClaimContext({ ...claim, index: -1 }, 6)).toThrow(/INVALID_PROOF/);
  });
});

describe("signClaimContext (EIP-712 SignedContextV2, as rainlang LibContext.buildV2 verifies it)", () => {
  const acct = privateKeyToAccount(`0x${"01".repeat(32)}`);
  it("signs toTypedDataHash(domainSeparator, hashStruct) and carries the domain separator", async () => {
    const ctx = buildClaimContext(claim, 6);
    const s = await signClaimContext(ctx, acct);
    expect(s.signer).toBe(acct.address);
    expect(s.context).toEqual(ctx);
    // Recompute the digest exactly as LibContext does: keccak(typeHash ‖ signer ‖ keccak(context words)).
    const typeHash = keccak256(toHex("SignedContextV2(address signer,bytes32[] context)"));
    const structHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }], [typeHash, acct.address, keccak256(concat(ctx))]));
    const domainTypeHash = keccak256(toHex("EIP712Domain(string name,string version)"));
    const domainSeparator = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [domainTypeHash, keccak256(toHex(CLAIM_SIGNING_DOMAIN.name)), keccak256(toHex(CLAIM_SIGNING_DOMAIN.version))]));
    expect(s.domainSeparator).toBe(domainSeparator);
    const digest = keccak256(concat(["0x1901", domainSeparator, structHash]));
    expect(await recoverAddress({ hash: digest, signature: s.signature })).toBe(acct.address);
  });
  it("is deterministic for a fixed key (pinned signature)", async () => {
    const s = await signClaimContext(buildClaimContext(claim, 6), acct);
    expect(s.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect((await signClaimContext(buildClaimContext(claim, 6), acct)).signature).toBe(s.signature);
  });
  it("honours a custom domain", async () => {
    const domain = { name: "x", version: "2", chainId: 1 } as const;
    const s = await signClaimContext(["0x" + "00".repeat(32) as Hex], acct, domain);
    expect(s.domainSeparator).not.toBe((await signClaimContext(["0x" + "00".repeat(32) as Hex], acct)).domainSeparator);
  });
  it("randomSigner gives a fresh key each time", () => expect(randomSigner().address).not.toBe(randomSigner().address));
});
