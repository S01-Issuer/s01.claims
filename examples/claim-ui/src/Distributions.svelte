<script lang="ts">
  import { orderHash } from "@s01/claims";
  import { loadWalletClaims } from "./lib/claims";
  import { scanDistributions, type DistributionRow, type KnownLeaf, type KnownOrder } from "./lib/distributions";
  import { amount, short } from "./lib/format";
  import { app, session, type Session } from "./lib/state.svelte";

  let rows = $state<DistributionRow[]>([]);
  let error = $state("");
  let leafSource = $state("");
  let scannedAt = $state(0n);

  // Leaves we can check: the proofs file has all of them; with an API, those of the local.json investors.
  let leafCache: { session: Session; at: number; known: Map<string, KnownOrder>; leaves: Map<string, KnownLeaf[]> } | null = null;
  async function known(s: Session) {
    if (leafCache?.session === s && Date.now() - leafCache.at < 15_000) return leafCache;
    const k = new Map<string, KnownOrder>();
    const leaves = new Map<string, KnownLeaf[]>();
    const addLeaf = (wallet: KnownLeaf["wallet"], claim: KnownLeaf["claim"]) => {
      const h = orderHash(claim.order).toLowerCase();
      k.set(h, { ...k.get(h), order: claim.order });
      const list = leaves.get(h) ?? [];
      if (!list.some((l) => l.claim.index === claim.index)) list.push({ wallet, claim });
      leaves.set(h, list);
    };
    for (const d of s.loaded.config.distributions ?? []) k.set(d.orderHash.toLowerCase(), { flush: d.flush, root: d.root });
    if (s.loaded.proofs) {
      for (const o of s.loaded.proofs.orders) {
        k.set(o.orderHash.toLowerCase(), { flush: o.flush, root: o.root, order: o.order });
        for (const l of o.leaves) addLeaf(l.wallet, { order: o.order, index: l.index, amount: l.amount, proof: l.proof });
      }
      leafSource = "every leaf (proofs file)";
    } else if (s.loaded.config.apiUrl) {
      const investors = s.loaded.config.investors ?? [];
      for (const i of investors) for (const c of await loadWalletClaims(i.address, s.loaded)) addLeaf(i.address, c.claim);
      leafSource = `leaves of the ${investors.length} local.json investors (API)`;
    } else leafSource = "none (no API, no proofs file)";
    for (const [h, v] of k) { const d = (s.loaded.config.distributions ?? []).find((x) => x.orderHash.toLowerCase() === h); if (d) k.set(h, { ...v, flush: d.flush, root: d.root }); }
    leafCache = { session: s, at: Date.now(), known: k, leaves };
    return leafCache;
  }

  let busy = false, again = false;
  async function refresh(s: Session) {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const block = app.block;
      const kn = await known(s);
      rows = await scanDistributions(s.client, { raindex: s.raindex, fromBlock: s.fromBlock, known: kn.known, leaves: kn.leaves });
      scannedAt = block; error = "";
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { busy = false; if (again) { again = false; void refresh(s); } }
  }

  $effect(() => {
    const s = session();
    void app.block; // re-scan on every new block
    if (s) void refresh(s);
  });
</script>

<section class="card">
  <header class="head">
    <h2>Distributions</h2>
    <span class="muted">scanned at block {scannedAt.toString()} · leaves checked: {leafSource}</span>
  </header>
  {#if error}<p class="error">{error}</p>{/if}
  {#if rows.length === 0 && !error}<p class="muted">No claim orders found since block {session()?.fromBlock.toString()}.</p>{/if}

  <div class="table" role="table">
    <div class="tr th" role="row">
      <span role="columnheader">Flush · order</span><span role="columnheader">Token</span><span role="columnheader">Deposited</span>
      <span role="columnheader">Claimed</span><span role="columnheader">Vault</span><span role="columnheader">Leaves</span>
    </div>
    {#each rows as r (r.orderHash)}
      {@const d = r.token.decimals}
      <div class="tr" role="row">
        <span role="cell" data-label="Order">
          <strong>{r.flush ?? "unknown flush"}</strong> {#if !r.live}<em class="tag bad">removed</em>{/if}<br />
          <code title={r.orderHash}>{short(r.orderHash)}</code><br />
          <small class="muted" title={r.root}>root {r.root ? short(r.root) : "unknown"}</small>
        </span>
        <span role="cell" data-label="Token">{r.token.symbol}</span>
        <span role="cell" data-label="Deposited" class="num">{r.deposited === null ? "—" : amount(r.deposited, d)}</span>
        <span role="cell" data-label="Claimed" class="num">{amount(r.claimed, d)}<br /><small class="muted">{r.takes} take{r.takes === 1 ? "" : "s"}</small></span>
        <span role="cell" data-label="Vault" class="num">{amount(r.vault, d)}</span>
        <span role="cell" data-label="Leaves" class="num">
          {#if r.leaves.known > 0}
            <span class="ok">{r.leaves.claimed} claimed</span> / {r.leaves.known - r.leaves.claimed} unclaimed
          {:else}<span class="muted">{r.takes} claimed, rest unknown</span>{/if}
        </span>
      </div>
    {/each}
  </div>
</section>

<style>
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
  .head h2 { margin: 0; }
  .head .muted { font-size: .8rem; }
  .table { display: grid; margin-top: .75rem; }
  .tr { display: grid; grid-template-columns: 2.2fr .8fr 1.2fr 1.2fr 1.2fr 1.3fr; gap: .75rem; padding: .6rem 0; border-top: 1px solid var(--line); align-items: start; }
  .th { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-top: 0; }
  .num { font-variant-numeric: tabular-nums; }
  @media (max-width: 720px) {
    .th { display: none; }
    .tr { grid-template-columns: 1fr 1fr; }
    .tr > span:first-child { grid-column: 1 / -1; }
    .tr > span:not(:first-child)::before { content: attr(data-label); display: block; font-size: .7rem; text-transform: uppercase; color: var(--muted); }
  }
</style>
