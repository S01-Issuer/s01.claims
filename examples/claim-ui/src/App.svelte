<script lang="ts">
  import ConfigPanel from "./ConfigPanel.svelte";
  import Distributions from "./Distributions.svelte";
  import Investor from "./Investor.svelte";
  import { app, session } from "./lib/state.svelte";
  import { short } from "./lib/format";
</script>

<main>
  <header class="top">
    <h1>tSALT claims <span class="muted">practice</span></h1>
    {#if session()}
      {@const s = session()!}
      <p class="muted chain">
        chain {s.chain.id} · block <strong>{app.block.toString()}</strong> · RaindexV7 <code title={s.raindex}>{short(s.raindex, 4)}</code>
        {#if s.loaded.config.state}<br /><small>{s.loaded.config.state}</small>{/if}
      </p>
    {/if}
  </header>
  <ConfigPanel />
  {#if session()}
    <Investor />
    <Distributions />
  {/if}
  <footer class="muted">Local Anvil only. Uses <code>@s01/claims</code>; see <code>src/lib/claims.ts</code> for the claim path.</footer>
</main>

<style>
  main { max-width: 72rem; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem; }
  .top { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 1.4rem; }
  .chain { margin: 0; font-size: .85rem; text-align: right; }
  footer { font-size: .8rem; text-align: center; }
  @media (max-width: 600px) { .chain { text-align: left; } }
</style>
