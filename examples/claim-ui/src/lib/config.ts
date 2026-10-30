// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import type { Address, Hex } from "viem";
import { getDeployment, type LeafHashing } from "@s01/claims";

/** What the UI needs to know. `local.json` (e2e harness or `npm run demo`) has this shape; every field but rpcUrl is optional. */
export interface LocalConfig {
  rpcUrl: string;
  chainId?: number;
  /** tsalt.api base URL; null/absent: claims come from `proofs` instead. */
  apiUrl?: string | null;
  /** Proofs file (relative to local.json, or a URL): `ProofsFile`. Used when there is no API. */
  proofs?: string;
  /** First block to scan for Raindex logs (a fork's fork block). Default: anvil_nodeInfo's fork block. */
  forkBlock?: number;
  contracts?: { tSALT?: Address; usdc?: Address; orderbook?: Address };
  distributions?: { flush: string; token: string; txHash?: Hex; orderHash: Hex; root: Hex }[];
  investors?: { name: string; address: Address; privateKey?: Hex }[];
  state?: string;
}

/** The demo's proofs file: every leaf of every order, as the API's `claim` fields plus the wallet. */
export interface ProofsFile {
  orders: {
    flush: string; token: string; orderHash: Hex; root: Hex; order: Hex; hashing?: LeafHashing;
    leaves: { wallet: Address; index: number; amount: string; proof: Hex[] }[];
  }[];
}

export interface Loaded { config: LocalConfig; proofs: ProofsFile | null; source: string }

export async function loadConfigFrom(url: string): Promise<Loaded> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error ?? `GET ${url}: HTTP ${res.status}`);
  return withProofs(validate(body), new URL(url, location.href).href);
}

export async function loadConfigText(text: string, source: string): Promise<Loaded> {
  return withProofs(validate(JSON.parse(text)), location.href, source);
}

async function withProofs(config: LocalConfig, base: string, source = base): Promise<Loaded> {
  if (!config.proofs) return { config, proofs: null, source };
  // `proofs: "proofs.json"` next to a served /local.json is served at /local/proofs.json.
  const href = /^https?:/.test(config.proofs) ? config.proofs : new URL(base.endsWith("/local.json") ? `/local/${config.proofs}` : config.proofs, base).href;
  const res = await fetch(href, { cache: "no-store" });
  if (!res.ok) throw new Error(`proofs file ${href}: HTTP ${res.status}`);
  return { config, proofs: (await res.json()) as ProofsFile, source };
}

function validate(raw: unknown): LocalConfig {
  const c = raw as LocalConfig;
  if (typeof c !== "object" || c === null || typeof c.rpcUrl !== "string") throw new Error("config needs at least { rpcUrl }");
  return c;
}

/** RaindexV7 on this chain: local.json's, else the library's deployment table. */
export function orderbookOf(c: LocalConfig): Address {
  return c.contracts?.orderbook ?? getDeployment(c.chainId ?? 1).raindex;
}

/** How this chain's MerkleWords hashes leaves (needed for local proof checks). */
export function leafHashingOf(c: LocalConfig): LeafHashing {
  try { return getDeployment(c.chainId ?? 1).merkleLeafHashing; } catch { return "double"; }
}
