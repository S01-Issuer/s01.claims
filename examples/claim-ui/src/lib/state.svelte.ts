import type { Chain, PublicClient } from "viem";
import { forkBlock, localChain, publicClientFor } from "./chain";
import { leafHashingOf, orderbookOf, type Loaded } from "./config";
import type { Address } from "viem";
import type { LeafHashing } from "@s01/claims";

export interface Session {
  loaded: Loaded;
  chain: Chain;
  client: PublicClient;
  raindex: Address;
  hashing: LeafHashing;
  fromBlock: bigint;
}

/** App-wide state. `session` is replaced as a whole, never mutated (viem clients are not made reactive). */
export const app = $state({ block: 0n, error: "" });
let current = $state.raw<Session | null>(null);
let unwatch: (() => void) | undefined;

export const session = () => current;

export async function connect(loaded: Loaded): Promise<void> {
  unwatch?.();
  const chain = localChain(loaded.config.rpcUrl, loaded.config.chainId ?? 1);
  const client = publicClientFor(chain);
  const id = await client.getChainId();
  if (loaded.config.chainId !== undefined && id !== loaded.config.chainId) throw new Error(`RPC is chain ${id}, config says ${loaded.config.chainId}`);
  const fork = loaded.config.forkBlock !== undefined ? BigInt(loaded.config.forkBlock) : await forkBlock(client);
  app.block = await client.getBlockNumber();
  current = {
    loaded, chain, client, raindex: orderbookOf(loaded.config), hashing: leafHashingOf(loaded.config),
    // Logs only from the fork block on: before it, the fork would ask the upstream node.
    fromBlock: fork !== undefined ? fork + 1n : 0n,
  };
  // Every component that shows chain state re-reads when this changes.
  unwatch = client.watchBlockNumber({ emitOnBegin: false, poll: true, pollingInterval: 1_000, onBlockNumber: (n) => { app.block = n; }, onError: () => {} });
}
