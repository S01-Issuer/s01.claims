/** The distributions dashboard: every claim order on the orderbook, from AddOrderV3 / TakeOrderV4 / DepositV2 logs. */
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import {
  buildLeaf, decodeOrder, floatToFixed, isClaimed, orderHash as hashOrder, parseAmount, raindexV7ClaimAbi, type OrderV4,
} from "@s01/claims";
import { tokenInfo, type TokenInfo } from "./chain";
import type { WalletClaim } from "./claims";

const addOrder = raindexV7ClaimAbi.find((x) => x.type === "event" && x.name === "AddOrderV3")!;
const takeOrder = raindexV7ClaimAbi.find((x) => x.type === "event" && x.name === "TakeOrderV4")!;
// Not in @s01/claims (claimants never need it): RaindexV7's deposit event, amount in base units.
const deposit = parseAbiItem("event DepositV2(address sender, address token, bytes32 vaultId, uint256 depositAmountUint256)");

export interface KnownOrder { flush?: string; root?: Hex; order?: Hex }
/** A leaf we know of (proofs file, or API claims of the local.json investors). */
export interface KnownLeaf { wallet: Address; claim: WalletClaim["claim"] }

export interface DistributionRow {
  orderHash: Hex;
  flush?: string;
  root?: Hex;
  owner: Address;
  token: TokenInfo;
  vaultId: Hex;
  addedBlock?: bigint;
  live: boolean;
  /** Σ DepositV2 into the order's vault since the scan start; null when the order was added before it. */
  deposited: bigint | null;
  claimed: bigint;
  takes: number;
  vault: bigint;
  leaves: { known: number; claimed: number };
}

export async function scanDistributions(client: PublicClient, a: {
  raindex: Address; fromBlock: bigint; known: Map<string, KnownOrder>; leaves: Map<string, KnownLeaf[]>;
}): Promise<DistributionRow[]> {
  const logs = await client.getLogs({ address: a.raindex, events: [addOrder, takeOrder, deposit], fromBlock: a.fromBlock, toBlock: "latest" });
  const orders = new Map<string, { order: OrderV4; addedBlock?: bigint }>();
  const takes = new Map<string, { n: number; input: Hex[] }>();
  const deposits: { sender: Address; token: Address; vaultId: Hex; amount: bigint }[] = [];
  for (const log of logs) {
    if (log.eventName === "AddOrderV3") orders.set(log.args.orderHash!.toLowerCase(), { order: log.args.order as OrderV4, addedBlock: log.blockNumber });
    else if (log.eventName === "TakeOrderV4") {
      const h = hashOrder(log.args.config!.order as OrderV4).toLowerCase();
      const t = takes.get(h) ?? { n: 0, input: [] };
      t.n++; t.input.push(log.args.input!); // the taker's input = what the order paid out
      takes.set(h, t);
    } else deposits.push({ sender: log.args.sender!, token: log.args.token!, vaultId: log.args.vaultId!, amount: log.args.depositAmountUint256! });
  }
  // Orders we know of but added before the scan start (only their bytes are known).
  for (const [h, k] of a.known) if (!orders.has(h) && k.order) orders.set(h, { order: decodeOrder(k.order) });

  const rows = await Promise.all([...orders].map(async ([h, { order, addedBlock }]): Promise<DistributionRow> => {
    const out = order.validOutputs[0]!;
    const token = await tokenInfo(client, out.token);
    const [vaultFloat, live] = await Promise.all([
      client.readContract({ address: a.raindex, abi: raindexV7ClaimAbi, functionName: "vaultBalance2", args: [order.owner, out.token, out.vaultId] }),
      client.readContract({ address: a.raindex, abi: raindexV7ClaimAbi, functionName: "orderExists", args: [h as Hex] }),
    ]);
    const t = takes.get(h) ?? { n: 0, input: [] };
    const known = a.leaves.get(h) ?? [];
    const claimedLeaves = await Promise.all(known.map((l) => isClaimed(client, {
      raindex: a.raindex, order, leaf: buildLeaf({ index: l.claim.index, wallet: l.wallet, amount: parseAmount(l.claim.amount, token.decimals) }, token.decimals),
    })));
    const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
    const k = a.known.get(h);
    return {
      orderHash: h as Hex, owner: order.owner, token, vaultId: out.vaultId, live,
      ...(k?.flush ? { flush: k.flush } : {}), ...(k?.root ? { root: k.root } : {}), ...(addedBlock !== undefined ? { addedBlock } : {}),
      deposited: addedBlock === undefined ? null
        : deposits.filter((d) => same(d.sender, order.owner) && same(d.token, out.token) && d.vaultId === out.vaultId).reduce((s, d) => s + d.amount, 0n),
      claimed: t.input.reduce((s, f) => s + floatToFixed(f, token.decimals), 0n),
      takes: t.n,
      vault: floatToFixed(vaultFloat, token.decimals),
      leaves: { known: known.length, claimed: claimedLeaves.filter(Boolean).length },
    };
  }));
  return rows.sort((x, y) => (x.flush ?? "").localeCompare(y.flush ?? "") || Number((x.addedBlock ?? 0n) - (y.addedBlock ?? 0n)));
}
