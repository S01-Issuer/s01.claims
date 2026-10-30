# @s01/claims

Claim a pull-based ERC-20 distribution from a Rain `claims.rain` Merkle order on RaindexV7. Everything a claimant UI
needs and nothing operator-side: the frozen leaf encoding, local proof checks, the signed context and its signature,
`takeOrders5` calldata, claim status and a preflight. Browser-safe (no Node built-ins), and [viem](https://viem.sh) is
the only dependency (a peer).

Operators build and deploy the orders with `s01.distributions`, which imports the leaf encoding from here, so tree
builder and claimants share one implementation.

## Install

Not on npm yet. Install from GitHub:

```bash
npm install github:S01-Issuer/s01.claims viem
```

## Claim one leaf

```ts
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { mainnet } from "viem/chains";
import { ethereum, isClaimed, prepareClaim, simulateClaim } from "@s01/claims";
import { fetchWalletClaims, toClaimProof } from "@s01/claims/api";

const publicClient = createPublicClient({ chain: mainnet, transport: http() });
const [fill] = await fetchWalletClaims(wallet, { baseUrl: "https://tsalt-api.s01issuer.com" });   // optional helper
const decimals = fill.token === "USDC" ? 6 : 18;

const claim = await prepareClaim({
  raindex: ethereum.raindex, order: fill.claim.order, wallet, decimals, claim: toClaimProof(fill.claim, decimals),
});
if (await isClaimed(publicClient, { raindex: ethereum.raindex, order: claim.order, leaf: claim.leaf })) throw new Error("already claimed");
const pre = await simulateClaim(publicClient, { raindex: ethereum.raindex, wallet, order: claim.order, signedContext: claim.signedContext, amount: claim.amount });
if (!pre.ok) throw new Error(pre.reason);   // e.g. "MinimumIO(…): Proof"

const walletClient = createWalletClient({ chain: mainnet, transport: custom(window.ethereum) });
await walletClient.sendTransaction({ account: wallet, to: claim.to, data: claim.data });
```

Rules a UI must keep:

- **The leaf's wallet sends the transaction.** The order hashes `order-counterparty()` (`msg.sender`) into the leaf.
- **The amount word is 18-decimal** whatever the token: `F(amount·10^(18−d), 18)`. `buildClaimContext` does this.
- **Any key can sign the context.** The order checks neither signer nor EIP-712 domain; `prepareClaim` uses a fresh
  random key unless you pass `signer`.
- **`simulateClaim` is the proof check.** It runs the proof against the order's on-chain root, so a wrong proof comes
  back as `pre.ok === false` with a reason ending in `: Proof` (`MinimumIO(…): Proof`), and the example stops there. The tSALT API does not serve the root, so
  use `prepareClaim`'s `verify` option only if you hold the root from another source.
- **The claimant pays nothing.** The order's IO ratio is 0 and the take sets `maximumIORatio` to 0, so no approval is
  needed.

## Example: local claim UI

[`examples/claim-ui`](examples/claim-ui) is a Vite + Svelte page for practising claims on a local Anvil (the e2e
harness, or its own `npm run demo` fork), and the reference integration for a claimant UI: the claim path is
[`examples/claim-ui/src/lib/claims.ts`](examples/claim-ui/src/lib/claims.ts). `cd examples/claim-ui && npm install && npm run dev`.

## The leaf encoding (frozen)

```
leaf      = keccak256( F(index, 0) ‖ bytes32(uint160(wallet)) ‖ F(amount × 10^(18 − decimals), 18) )
F(v, d)   = Rain Float (int32 exponent ‖ int224 coefficient) with coefficient v and exponent −d; 0 is the zero word
tree leaf = leaf               ("single": rain.merkle 0.1.0, e.g. Albion on Base)
          = keccak256(leaf)    ("double": rain.merkle 0.1.1, Ethereum; an OpenZeppelin StandardMerkleTree)
```

Floats are not normalized, so the bytes matter. `floatHex` is byte-identical to `@rainlanguage/float`
`fromFixedDecimalLossy` (tested against it) and refuses lossy values. Trees are complete, depth 8 (256 leaves), with
OpenZeppelin sorted-pair hashing; every proof has exactly 8 words.

Vector: wallet `0x1111…1111`, index 0, 587.46 of any token → amount word
`0xffffffee000000000000000000000000000000000000001fd8a52d80e6fa0000`, leaf
`0x75192eff675f73d3d738d8bf8c6813b57223be2f7bff2fbbda4b026fcf963ecf`.

## API

| Area | Exports |
| --- | --- |
| Amounts | `parseAmount`, `formatAmount`, `toLeafAmount18`, `assertDecimals` |
| Float | `floatHex`, `packFloat`, `unpackFloat`, `floatToFixed`, `ZERO_FLOAT` |
| Leaf and proof | `buildLeaf`, `buildLeafRaw`, `treeLeaf`, `verifyProof(root, leaf, proof, hashing)`, `processProof`, `hashPair`, `TREE_DEPTH`, `MAX_LEAVES`, type `LeafHashing` |
| Order | `decodeOrder`, `encodeOrder`, `orderHash`, type `OrderV4` |
| Signed context | `buildClaimContext`, `claimAmountWord`, `claimAmountWordFromDecimal`, `signClaimContext`, `randomSigner`, `CLAIM_SIGNING_DOMAIN`, `SIGNED_CONTEXT_V2_TYPES` |
| Calldata | `buildTakeOrdersCalldata` (`takeOrders5`), `buildQuoteCalldata` (`quote3`), `prepareClaim` |
| Status | `isClaimed`, `simulateClaim`, `claimedStoreKey`, `orderNamespace`, `CLAIMED_KEY_WORD`, `revertReason` |
| Chains (data) | `ethereum`, `deployments`, `getDeployment` |
| ABIs | `raindexV7ClaimAbi`, `raindexV7ErrorsAbi`, `interpreterStoreV3Abi`, `orderV4Param`, `signedContextV2sParam`, `tasksV3Param`, … |
| `@s01/claims/api` | `fetchWalletClaims`, `parseApiClaim`, `toClaimProof` (tSALT API claim fields, validated without zod) |

Errors are `ClaimsError` with a `code` and a `[CODE] message`.

### How claim status works

`claims.rain` stores `1` at `hash(order-hash, leaf, "claimed")` in the order's interpreter store, under the order
owner's namespace qualified by the orderbook. `isClaimed` reads exactly that slot, so it sees claims made through
`takeOrders5` or `clear4` alike. On RaindexV7 a take of an already-claimed leaf (or a bad proof) is skipped
(`OrderCalculateReverted`) and the transaction reverts `MinimumIO`; `simulateClaim` calls `quote3` to recover
`Claimed` or `Proof`.

## Ethereum deployment

RaindexV7 `0x91b95120D085Aa99C05167f3767eB63460c1dCaC` (raindex sol-v0.1.17), MerkleWords
`0xc65Bc255AAbC51b7371296Ab52C1e3c25b79d2C3` (rain.merkle 0.1.1, `"double"`), Rainlang 0.1.10. Addresses and
codehashes are in `src/chains.ts`; every selector used is checked against the deployed bytecode in the tests.

## Develop

```bash
npm ci
npm run typecheck
npm test          # unit tests, no network
npm run build     # dist/ ESM + .d.ts
```

The end-to-end check against a mainnet fork (deploy an order, claim, replay refused, `isClaimed`) runs in
`s01.distributions`: `verify-claim --fork`.

## Licence

[DecentraLicense 1.0](LICENSE) (`LicenseRef-DCL-1.0`), the licence Rain uses for Raindex and its tooling.
