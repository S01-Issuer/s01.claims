<script lang="ts">
  import { onMount } from "svelte";
  import { loadConfigFrom, loadConfigText, type Loaded } from "./lib/config";
  import { connect, session } from "./lib/state.svelte";

  const params = new URLSearchParams(location.search);
  let url = $state(params.get("config") ?? "/local.json");
  let pasted = $state("");
  let manual = $state({ rpcUrl: "http://127.0.0.1:8545", apiUrl: "", orderbook: "", proofs: "" });
  let mode = $state<"url" | "paste" | "manual">("url");
  let busy = $state(false);
  let error = $state("");
  let open = $state(true);

  async function run(load: () => Promise<Loaded>) {
    busy = true; error = "";
    try { await connect(await load()); open = false; }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { busy = false; }
  }

  const fromUrl = () => run(() => loadConfigFrom(url));
  const fromPaste = () => run(() => loadConfigText(pasted, "pasted JSON"));
  const fromManual = () => run(() => loadConfigText(JSON.stringify({
    rpcUrl: manual.rpcUrl, apiUrl: manual.apiUrl || null,
    ...(manual.proofs ? { proofs: manual.proofs } : {}),
    ...(manual.orderbook ? { contracts: { orderbook: manual.orderbook } } : {}),
  }), "manual"));

  async function upload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) { pasted = await file.text(); mode = "paste"; }
  }

  onMount(() => { void fromUrl(); });
</script>

<section class="card config">
  <button class="summary" onclick={() => (open = !open)} aria-expanded={open}>
    <span>Connection</span>
    {#if session()}
      {@const s = session()!}
      <span class="muted">{s.loaded.source} · {s.loaded.config.apiUrl ? "API" : s.loaded.proofs ? "proofs file" : "chain only"}</span>
    {:else}
      <span class="muted">not connected</span>
    {/if}
  </button>

  {#if open}
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={mode === "url"} onclick={() => (mode = "url")}>local.json URL</button>
      <button role="tab" aria-selected={mode === "paste"} onclick={() => (mode = "paste")}>Paste / upload</button>
      <button role="tab" aria-selected={mode === "manual"} onclick={() => (mode = "manual")}>Manual</button>
    </div>

    {#if mode === "url"}
      <form class="row" onsubmit={(e) => { e.preventDefault(); void fromUrl(); }}>
        <input bind:value={url} aria-label="local.json URL" />
        <button disabled={busy}>Load</button>
      </form>
      <p class="hint">/local.json is served by the dev server from <code>CLAIM_UI_LOCAL</code> (default: the e2e harness's). Also <code>?config=…</code>.</p>
    {:else if mode === "paste"}
      <textarea bind:value={pasted} rows="6" placeholder={'{ "rpcUrl": "http://127.0.0.1:8645", "apiUrl": "http://127.0.0.1:8000", … }'}></textarea>
      <div class="row">
        <input type="file" accept="application/json" onchange={upload} aria-label="upload local.json" />
        <button disabled={busy || !pasted} onclick={fromPaste}>Use</button>
      </div>
    {:else}
      <form class="grid" onsubmit={(e) => { e.preventDefault(); void fromManual(); }}>
        <label>RPC URL <input bind:value={manual.rpcUrl} /></label>
        <label>tsalt.api URL <input bind:value={manual.apiUrl} placeholder="none: use a proofs file" /></label>
        <label>Proofs file URL <input bind:value={manual.proofs} placeholder="optional" /></label>
        <label>Orderbook <input bind:value={manual.orderbook} placeholder="default: getDeployment(chainId).raindex" /></label>
        <button disabled={busy}>Connect</button>
      </form>
    {/if}
    {#if busy}<p class="muted">connecting…</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  {/if}
</section>

<style>
  .summary { all: unset; cursor: pointer; display: flex; justify-content: space-between; gap: 1rem; width: 100%; font-weight: 600; flex-wrap: wrap; }
  .summary .muted { font-weight: 400; overflow-wrap: anywhere; }
  .tabs { display: flex; gap: .25rem; margin: .75rem 0; flex-wrap: wrap; }
  .tabs button[aria-selected="true"] { background: var(--accent); color: var(--on-accent); }
  .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  .row input:not([type="file"]) { flex: 1 1 16rem; }
  .grid { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); align-items: end; }
  .grid label { display: grid; gap: .2rem; font-size: .85rem; }
  textarea { width: 100%; font-family: var(--mono); font-size: .8rem; }
  .hint { font-size: .8rem; color: var(--muted); margin: .4rem 0 0; }
</style>
