// SPDX-License-Identifier: LicenseRef-DCL-1.0
// SPDX-FileCopyrightText: Copyright (c) 2026 S01 Issuer GmbH
import type { Address, Hex } from "viem";
import { ClaimsError } from "./errors.js";
import type { LeafHashing } from "./leaf.js";

/** A Raindex stack a claims order can live on. Data only: nothing in the library hardcodes an address. */
export interface RaindexDeployment {
  chainId: number;
  name: string;
  /** RaindexV7 orderbook: where claims are taken. */
  raindex: Address;
  raindexSubParser: Address;
  /** rain.merkle `MerkleWords` (the `merkle-proof-verify` sub-parser). */
  merkleWords: Address;
  /** How that `MerkleWords` hashes the leaf into the tree (`LeafHashing`): what `verifyProof` needs for its orders. */
  merkleLeafHashing: LeafHashing;
  /** Rainlang registry (`IRainlangV2`: compiler/interpreter/store/parser). */
  rainlang: Address;
  compiler: Address;
  parser: Address;
  interpreter: Address;
  store: Address;
  /** Runtime codehash of each address above, read from chain. A UI can check `getCode` against these. */
  codehashes: Record<Address, Hex>;
  /** Release tags the addresses come from. */
  versions: { raindex: string; merkle: string; rainlang: string };
}

/** Ethereum mainnet: RaindexV7 (raindex sol-v0.1.16 = sol-v0.1.17), MerkleWords merkle 0.1.1, Rainlang 0.1.10. Verified on chain 2026-10-29. */
export const ethereum: RaindexDeployment = {
  chainId: 1,
  name: "ethereum",
  raindex: "0x91b95120D085Aa99C05167f3767eB63460c1dCaC",
  raindexSubParser: "0xF81BCa8871dFdAd2BBA6953f7a9c5C3822020a38",
  merkleWords: "0xc65Bc255AAbC51b7371296Ab52C1e3c25b79d2C3",
  merkleLeafHashing: "double",
  rainlang: "0xdE1c4555B6c5f45ABA9887A55dFD52480Ba1c9a0",
  compiler: "0xFb7615D8508Ec129d67Ebd4117cD15E673Ae070B",
  parser: "0xa972E9bc2A60eac31a1eea6335470e98A88ec84C",
  interpreter: "0x780ca179B190c5E57FD7Ac308a7D966da4Cee428",
  store: "0x1Aa775533E28B1D843e1A589034984E3a62005DC",
  codehashes: {
    "0x91b95120D085Aa99C05167f3767eB63460c1dCaC": "0x68d6223023b2516f30acb5b6d4973cbaf5054e9d6156d27c51180939ba233cf5",
    "0xF81BCa8871dFdAd2BBA6953f7a9c5C3822020a38": "0x303da2f6de1eaef16d1fe3f763e23b0b846f5c5aae1f8b26b2d54b71908e9859",
    "0xc65Bc255AAbC51b7371296Ab52C1e3c25b79d2C3": "0xc66e740871b933e17e4ac6d748234aa8af1b90c3e3e1e7e905b7bfc0c1a575c7",
    "0xdE1c4555B6c5f45ABA9887A55dFD52480Ba1c9a0": "0x89d9c960625e4287928038ced3509a74982966f2736c5bc3feedd5c6cdf1aaf2",
    "0xFb7615D8508Ec129d67Ebd4117cD15E673Ae070B": "0xd9b2728380c23a2b5e071c9b798dc23a85589798176982b0629710decbfb8a4a",
    "0xa972E9bc2A60eac31a1eea6335470e98A88ec84C": "0x39cc19032ab38a041625493a3e718839a5d2658ed07b518bfff0e04d38e5e797",
    "0x780ca179B190c5E57FD7Ac308a7D966da4Cee428": "0x3841eedb46dc2a7554ac802514cd2ac7c5df3653123cd9d132690986bb097d30",
    "0x1Aa775533E28B1D843e1A589034984E3a62005DC": "0xdaa0024dc105c6a9ea0838604bad0a5e662743eca97789c2cecfdf8667d0bf9b",
  },
  versions: { raindex: "sol-v0.1.17", merkle: "sol-v0.1.1", rainlang: "0.1.10" },
};

export const deployments: Readonly<Record<number, RaindexDeployment>> = { [ethereum.chainId]: ethereum };

/** The deployment for `chainId`, or `UNSUPPORTED_CHAIN`. */
export function getDeployment(chainId: number): RaindexDeployment {
  const d = deployments[chainId];
  if (!d) throw new ClaimsError("UNSUPPORTED_CHAIN", `no Raindex deployment known for chain ${chainId}`);
  return d;
}
