import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/** Where `/local.json` comes from: CLAIM_UI_LOCAL, else the e2e harness's (E2E_STOP_AT=dist1 writes it). */
const LOCAL_JSON = resolve(process.env.CLAIM_UI_LOCAL ?? "../../../e2e/2026-10-29-mainnet-fork/local.json");

/**
 * Dev-server only helpers, so the page never needs anything but localhost:
 * - `GET /local.json` and `GET /local/<file>` (e.g. proofs.json) serve that file and its siblings.
 * - `GET /__api?url=http://127.0.0.1:8000/v1/...` forwards a GET to a loopback tsalt.api, which only allows CORS from
 *   its configured origins (the e2e harness allows https://app.salt.example only).
 */
function localFiles(): Plugin {
  return {
    name: "claim-ui-local",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        const send = (code: number, body: string, type = "application/json") => { res.statusCode = code; res.setHeader("content-type", type); res.setHeader("cache-control", "no-store"); res.end(body); };
        if (url.pathname === "/local.json" || url.pathname.startsWith("/local/")) {
          const file = url.pathname === "/local.json" ? LOCAL_JSON : resolve(dirname(LOCAL_JSON), basename(url.pathname));
          if (!existsSync(file)) return send(404, JSON.stringify({ error: `${file} does not exist (start the e2e harness with E2E_STOP_AT=dist1, or run npm run demo)` }));
          return send(200, readFileSync(file, "utf8"));
        }
        if (url.pathname === "/__api") {
          const target = new URL(url.searchParams.get("url") ?? "");
          if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname) || req.method !== "GET")
            return send(400, JSON.stringify({ error: "only GET to a loopback http API is proxied" }));
          try {
            const r = await fetch(target, { headers: { accept: "application/json" } });
            return send(r.status, await r.text(), r.headers.get("content-type") ?? "application/json");
          } catch (e) { return send(502, JSON.stringify({ error: String(e) })); }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), localFiles()],
  // The example links @s01/claims from the parent folder, which has its own viem: use one copy, the app's.
  resolve: { dedupe: ["viem"] },
  server: { host: "127.0.0.1", port: 5173 },
});
