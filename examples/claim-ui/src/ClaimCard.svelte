<script lang="ts">
  import type { WalletClient } from "viem";
  import { checkClaim, sendClaim, type ClaimState, type SendResult, type WalletClaim } from "./lib/claims";
  import { amount, short } from "./lib/format";
  import { app, session } from "./lib/state.svelte";

  let { wc, wallet }: { wc: WalletClaim; wallet: WalletClient | null } = $props();
  let cs = $state.raw<ClaimState | null>(null);
  let error = $state("");
  let sending = $state(false);
  let result = $state.raw<SendResult | null>(null);

  // Re-check on every block: proof (local), isClaimed and the preflight (both eth_call). A run may not overwrite a newer one's answer.
  let run = 0, applied = 0;
  $effect(() => {
    const s = session();
    const who = wallet?.account?.address;
    void app.block;
    if (!s || !who) return;
    const mine = ++run;
    checkClaim(s.client, { raindex: s.raindex, hashing: s.hashing, wallet: who, wc })
      .then((x) => { if (mine > applied) { applied = mine; cs = x; error = ""; } })
      .catch((e) => { if (mine > applied) { applied = mine; error = e instanceof Error ? e.message : String(e); } });
  });

  /** simulateClaim's reason is "<takeOrders5 revert>: <quote3 reason>"; the last part is the strategy's own word. */
  const why = (reason: string) => reason.split(": ").at(-1) ?? reason;

  async function claim() {
    const s = session();
    if (!s || !wallet || !cs) return;
    sending = true; error = ""; result = null;
    try { result = await sendClaim(s.client, wallet, cs, s.raindex); }
    catch (e) { error = e instanceof Error ? e.message.split("\n")[0]! : String(e); }
    finally { sending = false; }
  }
</script>

<article class="claim">
  <header>
    <strong>{wc.flush}</strong> <span class="muted">{wc.label}</span>
    {#if cs}
      <span class="tag {cs.claimed ? 'done' : 'open'}">{cs.claimed ? "claimed" : "claimable"}</span>
    {/if}
  </header>
  {#if cs}
    <p class="big">{amount(cs.amount, cs.token.decimals)} <span class="muted">{cs.token.symbol}</span></p>
  {:else}
    <p class="big">{wc.claim.amount}</p>
  {/if}
  <dl>
    <dt>Leaf</dt><dd>#{wc.claim.index} {#if cs}<code title={cs.prepared.leaf}>{short(cs.prepared.leaf)}</code>{/if}</dd>
    <dt>Order</dt><dd>{#if cs}<code title={cs.prepared.orderHash}>{short(cs.prepared.orderHash)}</code>{/if}</dd>
    {#if wc.apiStatus}<dt>API</dt><dd>{wc.apiStatus}</dd>{/if}
    <dt>Proof</dt>
    <dd>
      {#if !cs}…{:else if cs.proof.ok === true}<span class="ok">✓ proves the leaf under root {short(wc.root ?? "")}</span>
      {:else if cs.proof.ok === false}<span class="bad">✗ folds to {short(cs.proof.computedRoot)}, root is {short(wc.root ?? "")}</span>
      {:else}<span class="muted">root unknown; folds to {short(cs.proof.computedRoot)}</span>{/if}
    </dd>
    <dt>isClaimed</dt><dd>{cs ? String(cs.claimed) : "…"}</dd>
    <dt>Preflight</dt>
    <dd>
      {#if !cs}…{:else if cs.preflight.ok}<span class="ok">ok: would pay {amount(cs.amount, cs.token.decimals)} {cs.token.symbol}</span>
      {:else}<span class="bad"><strong>{why(cs.preflight.reason)}</strong></span>
        <details><summary class="muted">full revert</summary><code>{cs.preflight.reason}</code></details>{/if}
    </dd>
  </dl>

  <button class="primary" disabled={!cs || !wallet || sending} onclick={claim}>{sending ? "Claiming…" : cs?.claimed ? "Claim again" : "Claim"}</button>

  {#if result?.sent}
    <div class="result ok-box" role="status">
      <div>Sent <code title={result.hash}>{short(result.hash, 8)}</code></div>
      <div>Receipt: <strong>{result.receipt.status}</strong> in block {result.receipt.blockNumber.toString()}, gas {result.receipt.gasUsed.toString()}</div>
      {#if cs}<div>Balance change: <strong>+{amount(result.delta, cs.token.decimals)} {cs.token.symbol}</strong></div>{/if}
    </div>
  {:else if result}
    <div class="result bad-box" role="alert">Not sent: the preflight reverts with <strong>{why(result.reason)}</strong>{result.claimed ? " (this leaf is already claimed)" : ""}</div>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</article>

<style>
  .claim { border: 1px solid var(--line); border-radius: 10px; padding: .9rem; display: grid; gap: .5rem; background: var(--bg); min-width: 0; }
  header { display: flex; gap: .5rem; align-items: baseline; flex-wrap: wrap; }
  header .tag { margin-left: auto; }
  .big { font-size: 1.4rem; font-weight: 650; margin: 0; font-variant-numeric: tabular-nums; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem .75rem; margin: 0; font-size: .85rem; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }
  details { font-size: .75rem; }
  details code { overflow-wrap: anywhere; }
  .result { padding: .6rem .7rem; border-radius: 8px; font-size: .85rem; display: grid; gap: .2rem; overflow-wrap: anywhere; }
</style>
