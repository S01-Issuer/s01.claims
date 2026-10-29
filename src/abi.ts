/**
 * RaindexV7 fragments (as const), from rainlanguage/raindex `raindex-interface` 0.1.13 `src/interface/IRaindexV7.sol`
 * and rainlang 0.2.30 `IInterpreterCallerV5.sol` / `IInterpreterStoreV3.sol` (raindex sol-v0.1.16/0.1.17, deployed on
 * Ethereum at 0x91b95120D085Aa99C05167f3767eB63460c1dCaC). Floats are bytes32. Every function selector here occurs in
 * the deployed runtime code (test/unit/abi.test.ts pins them).
 */

export const evaluableV4Param = {
  type: "tuple", name: "evaluable",
  components: [
    { type: "address", name: "interpreter" },
    { type: "address", name: "store" },
    { type: "bytes", name: "bytecode" },
  ],
} as const;

export const ioV2sParam = <const N extends string>(name: N) => ({
  type: "tuple[]", name,
  components: [
    { type: "address", name: "token" },
    { type: "bytes32", name: "vaultId" },
  ],
}) as const;

/** OrderV4 tuple parameter (unchanged from RaindexV6), for `encodeAbiParameters` / `decodeAbiParameters`. */
export const orderV4Param = {
  type: "tuple", name: "order",
  components: [
    { type: "address", name: "owner" },
    evaluableV4Param,
    ioV2sParam("validInputs"),
    ioV2sParam("validOutputs"),
    { type: "bytes32", name: "nonce" },
  ],
} as const;

/** SignedContextV2: EIP-712 signed, with the signer's chosen domain separator carried alongside (not signed over). */
export const signedContextV2sParam = {
  type: "tuple[]", name: "signedContext",
  components: [
    { type: "address", name: "signer" },
    { type: "bytes32", name: "domainSeparator" },
    { type: "bytes32[]", name: "context" },
    { type: "bytes", name: "signature" },
  ],
} as const;

/** TaskV3[] (used by addOrder5 / deposit5 / withdraw5 / removeOrder4). */
export const tasksV3Param = {
  type: "tuple[]", name: "tasks",
  components: [evaluableV4Param, signedContextV2sParam],
} as const;

const takeOrderConfigV5Components = [
  orderV4Param,
  { type: "uint256", name: "inputIOIndex" },
  { type: "uint256", name: "outputIOIndex" },
  signedContextV2sParam,
] as const;

/** Errors RaindexV7 and the libraries it calls can revert with (from RaindexV7.json). `ensure` reverts are `Error(string)`. */
export const raindexV7ErrorsAbi = [
  { type: "error", name: "AddressEmptyCode", inputs: [{ type: "address", name: "target" }] },
  { type: "error", name: "ClearZeroAmount", inputs: [] },
  { type: "error", name: "DivisionByZero", inputs: [{ type: "int256", name: "signedCoefficient" }, { type: "int256", name: "exponent" }] },
  { type: "error", name: "ExponentOverflow", inputs: [{ type: "int256", name: "signedCoefficient" }, { type: "int256", name: "exponent" }] },
  { type: "error", name: "ExponentUnderflow", inputs: [{ type: "int256", name: "signedCoefficient" }, { type: "int256", name: "exponent" }] },
  { type: "error", name: "FailedCall", inputs: [] },
  { type: "error", name: "FixedDecimalOverflow", inputs: [{ type: "int256", name: "signedCoefficient" }, { type: "int256", name: "exponent" }, { type: "uint8", name: "decimals" }] },
  { type: "error", name: "FlashLenderCallbackFailed", inputs: [{ type: "bytes32", name: "result" }] },
  { type: "error", name: "FlashLenderUnsupportedToken", inputs: [{ type: "address", name: "token" }] },
  { type: "error", name: "InvalidSignature", inputs: [{ type: "uint256", name: "i" }] },
  { type: "error", name: "MinimumIO", inputs: [{ type: "bytes32", name: "minimumIO" }, { type: "bytes32", name: "actualIO" }] },
  { type: "error", name: "MulDivOverflow", inputs: [{ type: "uint256", name: "x" }, { type: "uint256", name: "y" }, { type: "uint256", name: "denominator" }] },
  { type: "error", name: "NegativeBounty", inputs: [] },
  { type: "error", name: "NegativeFixedDecimalConversion", inputs: [{ type: "int256", name: "signedCoefficient" }, { type: "int256", name: "exponent" }] },
  { type: "error", name: "NegativePull", inputs: [] },
  { type: "error", name: "NegativePush", inputs: [] },
  { type: "error", name: "NegativeVaultBalance", inputs: [{ type: "bytes32", name: "amount" }] },
  { type: "error", name: "NegativeVaultBalanceChange", inputs: [{ type: "bytes32", name: "amount" }] },
  { type: "error", name: "NoOrders", inputs: [] },
  { type: "error", name: "NotOrderOwner", inputs: [{ type: "address", name: "owner" }] },
  { type: "error", name: "NotRainMetaV1", inputs: [{ type: "bytes", name: "unmeta" }] },
  { type: "error", name: "OrderNoHandleIO", inputs: [] },
  { type: "error", name: "OrderNoInputs", inputs: [] },
  { type: "error", name: "OrderNoOutputs", inputs: [] },
  { type: "error", name: "OrderNoSources", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ type: "address", name: "token" }] },
  { type: "error", name: "SameOwner", inputs: [] },
  { type: "error", name: "TOFUTokenDecimalsNotDeployed", inputs: [{ type: "address", name: "deployedAddress" }] },
  { type: "error", name: "TokenDecimalsReadFailure", inputs: [{ type: "address", name: "token" }, { type: "uint8", name: "status" }] },
  { type: "error", name: "TokenMismatch", inputs: [] },
  { type: "error", name: "TokenSelfTrade", inputs: [] },
  { type: "error", name: "UnsupportedCalculateOutputs", inputs: [{ type: "uint256", name: "outputs" }] },
  { type: "error", name: "ZeroDepositAmount", inputs: [{ type: "address", name: "sender" }, { type: "address", name: "token" }, { type: "bytes32", name: "vaultId" }] },
  { type: "error", name: "ZeroMaximumIO", inputs: [] },
  { type: "error", name: "ZeroVaultId", inputs: [{ type: "address", name: "sender" }, { type: "address", name: "token" }] },
  { type: "error", name: "ZeroWithdrawTargetAmount", inputs: [{ type: "address", name: "sender" }, { type: "address", name: "token" }, { type: "bytes32", name: "vaultId" }] },
] as const;

/** What a claimant calls or decodes on RaindexV7. */
export const raindexV7ClaimAbi = [
  ...raindexV7ErrorsAbi,
  {
    type: "function", name: "takeOrders5", stateMutability: "nonpayable",
    inputs: [{
      type: "tuple", name: "config",
      components: [
        { type: "bytes32", name: "minimumIO" },
        { type: "bytes32", name: "maximumIO" },
        { type: "bytes32", name: "maximumIORatio" },
        { type: "bool", name: "IOIsInput" },
        { type: "tuple[]", name: "orders", components: takeOrderConfigV5Components },
        { type: "bytes", name: "data" },
      ],
    }],
    outputs: [{ type: "bytes32", name: "totalTakerInput" }, { type: "bytes32", name: "totalTakerOutput" }],
  },
  {
    type: "function", name: "quote3", stateMutability: "view",
    inputs: [{ type: "tuple", name: "quoteConfig", components: takeOrderConfigV5Components }],
    outputs: [{ type: "bool", name: "exists" }, { type: "bytes32", name: "outputMax" }, { type: "bytes32", name: "ioRatio" }],
  },
  {
    type: "function", name: "vaultBalance2", stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }, { type: "address", name: "token" }, { type: "bytes32", name: "vaultId" }],
    outputs: [{ type: "bytes32", name: "balance" }],
  },
  {
    type: "function", name: "orderExists", stateMutability: "view",
    inputs: [{ type: "bytes32", name: "orderHash" }],
    outputs: [{ type: "bool", name: "exists" }],
  },
  {
    type: "event", name: "AddOrderV3",
    inputs: [
      { type: "address", name: "sender", indexed: false },
      { type: "bytes32", name: "orderHash", indexed: false },
      { ...orderV4Param, indexed: false },
    ],
  },
  {
    type: "event", name: "TakeOrderV4",
    inputs: [
      { type: "address", name: "sender", indexed: false },
      { type: "tuple", name: "config", indexed: false, components: takeOrderConfigV5Components },
      { type: "bytes32", name: "input", indexed: false },
      { type: "bytes32", name: "output", indexed: false },
    ],
  },
  {
    type: "event", name: "OrderCalculateReverted",
    inputs: [
      { type: "address", name: "sender", indexed: false },
      { type: "address", name: "owner", indexed: false },
      { type: "bytes32", name: "orderHash", indexed: false },
    ],
  },
  {
    type: "event", name: "OrderZeroAmount",
    inputs: [
      { type: "address", name: "sender", indexed: false },
      { type: "address", name: "owner", indexed: false },
      { type: "bytes32", name: "orderHash", indexed: false },
    ],
  },
] as const;

/** IInterpreterStoreV3 `get`: where `claims.rain` records a claimed leaf. */
export const interpreterStoreV3Abi = [
  {
    type: "function", name: "get", stateMutability: "view",
    inputs: [{ type: "uint256", name: "namespace" }, { type: "bytes32", name: "key" }],
    outputs: [{ type: "bytes32", name: "value" }],
  },
] as const;
