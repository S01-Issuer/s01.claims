// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
/**
 * Standalone practice chain for the claim UI, no tsalt.api needed:
 *
 *   1. start Anvil on a mainnet fork (RaindexV7 and MerkleWords only exist on mainnet),
 *   2. deploy two small USDC `claims.rain` orders with s01.distributions' RaindexV7 order builder (the operator side),
 *      owned by a stand-in owner that is impersonated and dealt the USDC,
 *   3. write `.demo/local.json` (the e2e harness's shape, with `apiUrl: null`) and `.demo/proofs.json` (every leaf and
 *      its proof: what the API would serve),
 *   4. keep Anvil running until Ctrl-C.
 *
 *   npm run demo                         # then, in another shell: npm run dev:demo
 *   FORK_URL=https://... PORT=8646 npm run demo
 *
 * Operator code comes from ../../../s01.distributions (its `raindex-v7` branch must be checked out and `npm ci`'d);
 * the claimant side, the UI, only ever uses @s01/claims.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEventLog, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeOrder, formatAmount, getDeployment, raindexV7ClaimAbi } from "@s01/claims";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_REPO = join(HERE, "../../../../s01.distributions");
// Operator-side code, by path (it is not a published package). Same approach as the e2e harness.
const dist = await import(join(DIST_REPO, "src/index.ts")) as typeof import("../../../../s01.distributions/src/index.ts");

const FORK_URL = process.env.FORK_URL ?? "https://ethereum-rpc.publicnode.com";
const PORT = Number(process.env.PORT ?? 8646);
const OUT = join(HERE, "..", process.env.OUT ?? ".demo");
const OWNER: Address = "0x000000000000000000000000000000000000dEaD"; // stands in for the operator Safe

// Deterministic, local-only test keys. Never use them anywhere else.
const investors = [1, 2, 3, 4].map((n) => {
  const privateKey = keccak256(toHex(`s01-claim-ui-demo-wallet-${n}`));
  return { name: `D${n}`, address: privateKeyToAccount(privateKey).address, privateKey };
});
const [d1, d2, d3] = investors as [typeof investors[0], typeof investors[0], typeof investors[0]];
// Two weekly USDC distributions (redemption payouts). D4 has nothing to claim.
const distributions = [
  { flush: "2026-11-02", rows: [{ wallet: d1.address, amount: 587_460_000n }, { wallet: d2.address, amount: 204_270_000n }, { wallet: d3.address, amount: 1_000_000n }] },
  { flush: "2026-11-09", rows: [{ wallet: d1.address, amount: 12_345_678n }, { wallet: d2.address, amount: 99_000_000n }] },
];

const base = dist.loadConfig(join(DIST_REPO, "config/tsalt.ethereum.json"), {}, { requireRpc: false });
const usdc = base.tokens["USDC"]!;
const dotrain = readFileSync(join(DIST_REPO, "test/fixtures/strategy/claims.rain"), "utf8"); // == the pinned claims.rain (sha256 checked by s01.distributions' tests)
const deployment = getDeployment(1);

console.log(`starting Anvil on 127.0.0.1:${PORT}, forking ${new URL(FORK_URL).host} …`);
const anvil = await dist.startAnvil({ forkUrl: FORK_URL, chainId: 1, port: PORT, startupTimeoutMs: 120_000 });
const c = dist.testClients(anvil.rpcUrl, { id: 1 });
const config = { ...base, rpcUrl: anvil.rpcUrl, safe: { ...base.safe, address: OWNER } };
const forkBlock = Number(await c.public.getBlockNumber()); // the UI scans Raindex logs from here, not from genesis

await c.test.impersonateAccount({ address: OWNER });
await c.test.setBalance({ address: OWNER, value: parseEther("10") });
for (const i of investors) await c.test.setBalance({ address: i.address, value: parseEther("1") }); // gas only: a claim costs nothing else

const proofs: unknown[] = [];
const local: Record<string, unknown>[] = [];
for (const d of distributions) {
  const tree = dist.buildTree(d.rows, usdc.decimals, deployment.merkleLeafHashing);
  const total = d.rows.reduce((s, r) => s + r.amount, 0n);
  const calls = await dist.buildClaimOrderCalls({ config, token: usdc, root: tree.root, total, rpcUrl: anvil.rpcUrl, dotrain, key: `${d.flush}-USDC` });
  await dist.dealErc20(c, usdc.address as Address, OWNER, total);
  let orderBytes: Hex | undefined, orderHash: Hex | undefined, txHash: Hex | undefined;
  for (const call of [calls.approve, calls.addOrder, calls.deposit]) {
    const hash = await c.wallet.sendTransaction({ account: OWNER, to: call.to, data: call.data, chain: c.chain });
    const rc = await c.public.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${call.description} reverted`);
    for (const log of rc.logs) {
      try {
        const ev = decodeEventLog({ abi: raindexV7ClaimAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "AddOrderV3") { orderBytes = encodeOrder(ev.args.order); orderHash = ev.args.orderHash; txHash = hash; }
      } catch { /* not a Raindex event */ }
    }
  }
  if (!orderBytes || !orderHash || !txHash) throw new Error("no AddOrderV3 in the addOrder5 receipt");
  console.log(`deployed ${d.flush} USDC order ${orderHash}: ${tree.leaves.length} leaves, ${formatAmount(total, usdc.decimals)} USDC, root ${tree.root}`);
  local.push({ flush: d.flush, token: "USDC", txHash, orderHash, root: tree.root });
  proofs.push({
    flush: d.flush, token: "USDC", decimals: usdc.decimals, orderHash, root: tree.root, hashing: deployment.merkleLeafHashing, order: orderBytes,
    // The same fields as the API's `claim` object (order, index, amount, proof), plus the wallet.
    leaves: tree.leaves.map((l) => ({ wallet: l.wallet, index: l.index, amount: formatAmount(l.amount, usdc.decimals), proof: l.proof })),
  });
}
await c.test.stopImpersonatingAccount({ address: OWNER });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "proofs.json"), JSON.stringify({ orders: proofs }, null, 2) + "\n");
writeFileSync(join(OUT, "local.json"), JSON.stringify({
  state: "claim-ui local demo: two USDC claim orders deployed, nothing claimed",
  writtenAt: new Date().toISOString(),
  rpcUrl: anvil.rpcUrl, chainId: 1, apiUrl: null, proofs: "proofs.json",
  forkBlock,
  contracts: { tSALT: base.tokens["tSALT"]!.address, usdc: usdc.address, orderbook: deployment.raindex },
  distributions: local,
  investors: investors.map((i) => ({ ...i, claimable: proofs.flatMap((o: any) => o.leaves.filter((l: any) => l.wallet === i.address.toLowerCase()).map((l: any) => ({ flush: o.flush, amount: l.amount, token: "USDC" }))) })),
  note: "Local Anvil fork only. Keys are deterministic test keys (keccak256('s01-claim-ui-demo-wallet-<n>')); never use them anywhere else.",
}, null, 2) + "\n");
console.log(`wrote ${join(OUT, "local.json")} and proofs.json`);
console.log(`READY: Anvil ${anvil.rpcUrl} (chain id 1). Now run \`npm run dev:demo\`. Ctrl-C stops Anvil.`);

const stop = async () => { await anvil.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
