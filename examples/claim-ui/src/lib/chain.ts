// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import {
  createPublicClient, createWalletClient, custom, defineChain, erc20Abi, http,
  type Address, type Chain, type EIP1193Provider, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export function localChain(rpcUrl: string, id: number): Chain {
  return defineChain({ id, name: `local-${id}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
}

export function publicClientFor(chain: Chain): PublicClient {
  return createPublicClient({ chain, transport: http(), pollingInterval: 1_000 });
}

/** A local test key: viem signs in the page and sends eth_sendRawTransaction to the Anvil RPC. */
export function keyWallet(chain: Chain, privateKey: Hex): WalletClient {
  return createWalletClient({ account: privateKeyToAccount(privateKey), chain, transport: http() });
}

declare global { interface Window { ethereum?: EIP1193Provider } }

/**
 * An injected wallet (MetaMask …). It must be pointed at the same Anvil: we switch (or add) the chain id with the
 * Anvil RPC, then refuse to go on unless the wallet's node reports the same latest block hash as ours. A fork has
 * chain id 1, so without that check a wallet on real mainnet would look identical.
 */
export async function injectedWallet(chain: Chain, ours: PublicClient): Promise<WalletClient> {
  const eth = window.ethereum;
  if (!eth) throw new Error("no injected wallet (window.ethereum) in this browser");
  const wallet = createWalletClient({ chain, transport: custom(eth) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("the wallet returned no account");
  try { await wallet.switchChain({ id: chain.id }); }
  catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: chain.id }); }
  await assertSameNode(eth, ours);
  return createWalletClient({ account, chain, transport: custom(eth) });
}

/** Also run right before sending: the user can switch the wallet's network at any time, and chain id 1 will not show it. */
export async function assertSameNode(eth: Pick<EIP1193Provider, "request">, ours: PublicClient): Promise<void> {
  const theirs = await eth.request({ method: "eth_getBlockByNumber", params: ["latest", false] }) as { number: Hex; hash: Hex } | null;
  if (!theirs) throw new Error("the wallet's node returned no latest block");
  const mine = await ours.getBlock({ blockNumber: BigInt(theirs.number) }).catch(() => null);
  if (mine?.hash !== theirs.hash)
    throw new Error(`the wallet is not on this Anvil (its block ${BigInt(theirs.number)} is ${theirs.hash}). Point its network for chain ${ours.chain?.id} at ${ours.chain?.rpcUrls.default.http[0]}`);
}

export interface TokenInfo { address: Address; symbol: string; decimals: number }
const tokens = new Map<string, Promise<TokenInfo>>();

export function tokenInfo(client: PublicClient, address: Address): Promise<TokenInfo> {
  const key = `${client.chain?.id}:${address.toLowerCase()}`;
  if (!tokens.has(key)) tokens.set(key, (async () => {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => `${address.slice(0, 8)}…`),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { address, symbol, decimals };
  })().catch((e) => { tokens.delete(key); throw e; }));
  return tokens.get(key)!;
}

export const balanceOf = (client: PublicClient, token: Address, who: Address) =>
  client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

/** Anvil's fork block (anvil_nodeInfo), or undefined on another node or a non-fork Anvil. */
export async function forkBlock(client: PublicClient): Promise<bigint | undefined> {
  try {
    const info = await client.request({ method: "anvil_nodeInfo" as never }) as { forkConfig?: { forkBlockNumber?: number | string } };
    const n = info.forkConfig?.forkBlockNumber;
    return n === undefined || n === null ? undefined : BigInt(n);
  } catch { return undefined; }
}
