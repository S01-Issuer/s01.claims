// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
/**
 * Drive the UI's claim path (src/lib/claims.ts: loadWalletClaims → checkClaim → sendClaim) from Node, against a
 * local.json: claims every claimable leaf of one investor, then tries once more and expects the "Claimed" reason.
 *
 *   npm run verify -- .demo/local.json D2          # claims (changes chain state)
 *   npm run verify -- path/to/local.json W1 --preflight-only
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Address } from "viem";
import { checkClaim, loadWalletClaims, sendClaim } from "../src/lib/claims.ts";
import { keyWallet, localChain, publicClientFor } from "../src/lib/chain.ts";
import { leafHashingOf, orderbookOf, type Loaded, type LocalConfig, type ProofsFile } from "../src/lib/config.ts";
import { formatAmount } from "@s01/claims";

const [file = ".demo/local.json", name = "D1", flag] = process.argv.slice(2);
const preflightOnly = flag === "--preflight-only";
const config = JSON.parse(readFileSync(file, "utf8")) as LocalConfig;
const proofs = config.proofs ? JSON.parse(readFileSync(resolve(dirname(file), config.proofs), "utf8")) as ProofsFile : null;
const loaded: Loaded = { config, proofs, source: file };

const chain = localChain(config.rpcUrl, config.chainId ?? 1);
const client = publicClientFor(chain);
const raindex = orderbookOf(config), hashing = leafHashingOf(config);
const inv = config.investors?.find((i) => i.name === name);
if (!inv?.privateKey) throw new Error(`no investor ${name} with a key in ${file}`);
const wallet = keyWallet(chain, inv.privateKey);
const who = wallet.account!.address as Address;

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failures++; };

const claims = await loadWalletClaims(who, loaded);
console.log(`${name} ${who}: ${claims.length} claim(s) via ${config.apiUrl ? "API" : "proofs file"}`);
for (const wc of claims) {
  const s = await checkClaim(client, { raindex, hashing, wallet: who, wc });
  const amt = `${formatAmount(s.amount, s.token.decimals)} ${s.token.symbol}`;
  console.log(`- ${wc.flush} leaf #${wc.claim.index} ${amt}: proof ${s.proof.ok}, isClaimed ${s.claimed}, preflight ${s.preflight.ok ? "ok" : s.preflight.reason}`);
  check(s.proof.ok !== false, `${wc.flush}: proof folds to the known root (or root unknown)`);
  if (preflightOnly || s.claimed) continue;
  check(s.preflight.ok, `${wc.flush}: preflight ok before the claim`);
  const r = await sendClaim(client, wallet, s, raindex);
  if (!r.sent) { check(false, `${wc.flush}: claim sent (${r.reason})`); continue; }
  console.log(`  tx ${r.hash} ${r.receipt.status} block ${r.receipt.blockNumber} gas ${r.receipt.gasUsed}, +${formatAmount(r.delta, s.token.decimals)} ${s.token.symbol}`);
  check(r.receipt.status === "success" && r.delta === s.amount, `${wc.flush}: balance up by exactly the leaf amount`);
  const after = await checkClaim(client, { raindex, hashing, wallet: who, wc });
  check(after.claimed, `${wc.flush}: isClaimed true after`);
  const again = await sendClaim(client, wallet, after, raindex);
  check(!again.sent && again.claimed && /Claimed/.test(again.reason), `${wc.flush}: second attempt refused with "${again.sent ? "SENT" : again.reason}"`);
}
console.log(failures === 0 ? "verify: OK" : `verify: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
