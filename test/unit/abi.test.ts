// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import { describe, it, expect } from "vitest";
import { getAbiItem, toEventSelector, toFunctionSelector } from "viem";
import deployed from "../fixtures/raindex-v7.ethereum.selectors.json" with { type: "json" };
import { ethereum, raindexV7ClaimAbi, interpreterStoreV3Abi } from "../../src/index.js";

describe("RaindexV7 ABI (Ethereum 0x91b9…dCaC)", () => {
  it("fixture is for the configured orderbook and codehash", () => {
    expect(deployed.address).toBe(ethereum.raindex);
    expect(deployed.codehash).toBe(ethereum.codehashes[ethereum.raindex]);
  });
  it.each([["takeOrders5", "0xb0460f07"], ["quote3", "0xddebc96f"], ["vaultBalance2", "0x41d1514f"], ["orderExists", "0x2cb77e9f"]] as const)(
    "%s = %s and occurs in the deployed runtime code", (name, sel) => {
      expect(toFunctionSelector(getAbiItem({ abi: raindexV7ClaimAbi, name }) as never)).toBe(sel);
      expect(deployed.selectors).toContain(sel);
    });
  it("store get(uint256,bytes32) = 0x295f36d7, in the deployed store (0x1Aa7…05DC)", () => expect(toFunctionSelector(getAbiItem({ abi: interpreterStoreV3Abi, name: "get" }) as never)).toBe("0x295f36d7"));
  it("event topics: TakeOrderV4 is new, AddOrderV3 is unchanged from V6", () => {
    expect(toEventSelector(getAbiItem({ abi: raindexV7ClaimAbi, name: "AddOrderV3" }) as never)).toBe("0x87491344dfbcf91f6cbbc610cbbeedc85313d37a02df0c93527f7ea5f8db717f");
    expect(toEventSelector(getAbiItem({ abi: raindexV7ClaimAbi, name: "TakeOrderV4" }) as never)).toBe("0xbae4dbf76931c547f765e9def16d693d86daaa596f491de979008831789185ae");
  });
  it("has no V6 functions", () => {
    const names = (raindexV7ClaimAbi as readonly { name?: string }[]).map((i) => i.name);
    for (const n of ["takeOrders4", "takeOrders3", "quote2"]) expect(names).not.toContain(n);
  });
});
