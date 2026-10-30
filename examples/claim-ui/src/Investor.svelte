<script lang="ts">
  import type { Address, WalletClient } from "viem";
  import { balanceOf, injectedWallet, keyWallet, tokenInfo } from "./lib/chain";
  import { loadWalletClaims, type WalletClaim } from "./lib/claims";
  import { amount, short } from "./lib/format";
  import { app, session, type Session } from "./lib/state.svelte";
  import ClaimCard from "./ClaimCard.svelte";

  const wanted = new URLSearchParams(location.search).get("investor");
  let choice = $state("");
  let wallet = $state.raw<WalletClient | null>(null);
  let error = $state("");
  let claims = $state<WalletClaim[]>([]);
  let balances = $state<{ label: string; value: string }[]>([]);
  const address = $derived<Address | undefined>(wallet?.account?.address);

  // Pick the investor named by ?investor= once a config with that name is loaded.
  $effect(() => {
    const s = session();
    if (s && wanted && !choice && s.loaded.config.investors?.some((i) => i.name === wanted)) void pick(wanted);
  });

  // A wallet is bound to the session's chain: a new connection drops it.
  let pickedOn: Session | null = null;
  $effect(() => {
    const s = session();
    if (pickedOn && s !== pickedOn) { pickedOn = null; picking++; wallet = null; choice = ""; claims = []; balances = []; }
  });

  let picking = 0;
  async function pick(name: string) {
    const mine = ++picking;
    choice = name; error = ""; claims = []; balances = [];
    const s = session();
    if (!s || !name) { wallet = null; return; }
    pickedOn = s;
    try {
      let w: WalletClient;
      if (name === "injected") w = await injectedWallet(s.chain, s.client);
      else {
        const inv = s.loaded.config.investors?.find((i) => i.name === name);
        if (!inv?.privateKey) throw new Error(`${name} has no private key in the config`);
        w = keyWallet(s.chain, inv.privateKey);
      }
      const found = await loadWalletClaims(w.account!.address, s.loaded);
      if (mine !== picking) return;
      wallet = w; claims = found;
      claimsAt = Date.now();
    } catch (e) { if (mine === picking) { wallet = null; error = e instanceof Error ? e.message : String(e); } }
  }

  async function readBalances(s: Session, who: Address) {
    const c = s.loaded.config.contracts ?? {};
    const out = [{ label: "ETH", value: amount(await s.client.getBalance({ address: who }), 18) }];
    for (const t of [c.tSALT, c.usdc]) {
      if (!t) continue;
      try { const i = await tokenInfo(s.client, t); out.push({ label: i.symbol, value: amount(await balanceOf(s.client, t, who), i.decimals) }); }
      catch { /* token not on this chain */ }
    }
    balances = out;
  }

  // The API's status lags the chain (confirmations + indexer): re-read the wallet's claims at most every 10 s.
  let claimsAt = 0;
  async function reloadClaims(s: Session, who: Address) {
    if (!s.loaded.config.apiUrl || Date.now() - claimsAt < 10_000) return;
    claimsAt = Date.now();
    const fresh = await loadWalletClaims(who, s.loaded);
    if (address === who) claims = fresh;
  }

  $effect(() => {
    const s = session();
    void app.block;
    if (s && address) {
      void readBalances(s, address).catch(() => {});
      void reloadClaims(s, address).catch(() => {});
    }
  });
</script>

<section class="card">
  <header class="head">
    <h2>Investor</h2>
    <select value={choice} onchange={(e) => pick(e.currentTarget.value)} aria-label="investor">
      <option value="">choose…</option>
      {#each session()?.loaded.config.investors ?? [] as i (i.address)}
        <option value={i.name}>{i.name} {short(i.address, 4)}{i.privateKey ? "" : " (no key)"}</option>
      {/each}
      <option value="injected">Injected wallet (MetaMask…)</option>
    </select>
  </header>
  {#if error}<p class="error">{error}</p>{/if}

  {#if address}
    <p class="addr"><code>{address}</code></p>
    <dl class="balances">
      {#each balances as b (b.label)}<div><dt>{b.label}</dt><dd>{b.value}</dd></div>{/each}
    </dl>
    {#if claims.length === 0}<p class="muted">No claims for this wallet.</p>{/if}
    <div class="claims">
      {#each claims as wc (wc.claim.order + wc.claim.index)}
        <ClaimCard {wc} {wallet} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .head h2 { margin: 0; }
  .addr code { overflow-wrap: anywhere; }
  .balances { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: .5rem 0 1rem; }
  .balances div { display: grid; }
  .balances dt { font-size: .75rem; color: var(--muted); }
  .balances dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
  .claims { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); }
</style>
