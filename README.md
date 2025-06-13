# Fungible Token Contract

A configurable token contract for Mina, designed for flexibility and compatibility.

## Core Concepts

- **Standard Token Operations**: Mint, burn, transfer, and custom account update support
- **Flexible Configuration**: On-chain state is used to store token configuration, including constants and verification keys
- **Side-loaded Proofs**: Side-loaded proofs can be employed to add complexity to a token implementation without altering the verification key of the entire contract
- **Event Emission**: Events are emitted on state changes for any applications watching the contract to listen for

## Chain State & Contract Structure

### On-Chain State

The `FungibleToken` contract stores:

- `decimals`: Token decimal precision
- `admin`: Administrator public key with special privileges
- `packedAmountConfigs`: Configuration for mint/burn operations
- `packedMintParams`, `packedBurnParams`: Parameters for mint/burn operations
- `packedDynamicProofConfigs`: Configuration for dynamic proof verification
- `vKeyMapRoot`: Root hash for verification key Merkle map (for side-loaded proofs)

### Deploy Arguments

When deploying a token contract:

```typescript
await token.deploy({
  symbol: "TKN",  // Token symbol
  src: "https://github.com/o1-labs-XT/fungible-token-contract/blob/main/src/FungibleTokenContract.ts"  // Source code reference
});

await token.initialize(
  adminPublicKey,  // Admin account
  UInt8.from(9),   // Decimals (e.g., 9)
  MintConfig.default,
  mintParams,
  BurnConfig.default,
  burnParams,
  MintDynamicProofConfig.default,
  BurnDynamicProofConfig.default,
  TransferDynamicProofConfig.default,
  UpdatesDynamicProofConfig.default
);
```

### Contract Methods

- `mint/mintWithProof`: Create new tokens
- `burn/burnWithProof`: Destroy tokens
- `transferCustom/transferCustomWithProof`: Transfer tokens between accounts
- `getBalanceOf`: Query account balance
- `getCirculating`: Get total circulating supply
- `updateMintConfig/updateBurnConfig`: Update token configuration
- `setAdmin`: Change the admin account

### Events

- `MintEvent`: Emitted when tokens are minted
- `BurnEvent`: Emitted when tokens are burned
- `TransferEvent`: Emitted when tokens are transferred
- `BalanceChangeEvent`: Tracks balance changes
- `SetAdminEvent`: Admin account changes
- Various configuration update events

## Code Examples

### Initialize a Token

```typescript
import { FungibleToken, MintConfig, MintParams, BurnConfig, BurnParams } from './fungible-token-standard';

// Create token contract instance
const token = new FungibleToken(contractPublicKey);

// Configure token parameters
const mintParams = MintParams.create(MintConfig.default, {
  minAmount: UInt64.from(1),
  maxAmount: UInt64.from(1000),
});

const burnParams = BurnParams.create(BurnConfig.default, {
  minAmount: UInt64.from(100),
  maxAmount: UInt64.from(1500),
});

// Deploy and initialize
await token.deploy({
  symbol: "TKN",
  src: "https://github.com/your-repo/token-contract"
});

await token.initialize(
  adminPublicKey,
  UInt8.from(9),
  MintConfig.default,
  mintParams,
  BurnConfig.default,
  burnParams,
  MintDynamicProofConfig.default,
  BurnDynamicProofConfig.default,
  TransferDynamicProofConfig.default,
  UpdatesDynamicProofConfig.default
);
```

### Mint Tokens

```typescript
// Mint tokens to an account
await token.mint(recipientPublicKey, UInt64.from(1000));
```

### Transfer Tokens

```typescript
// Transfer tokens between accounts
await token.transferCustom(
  senderPublicKey,
  recipientPublicKey,
  UInt64.from(500)
);
```

### Burn Tokens

```typescript
// Burn tokens from an account
await token.burn(accountPublicKey, UInt64.from(200));
```

### Check Balance

```typescript
// Query account balance
const balance = await token.getBalanceOf(accountPublicKey);
console.log(`Account balance: ${balance.toString()}`);
```

## Running Examples

The repository includes several example applications:

```sh
# Run the end-to-end example
node build/src/examples/e2e.eg.js

# Run the escrow example
node build/src/examples/escrow.eg.js

# Run the concurrent transfer example
node build/src/examples/concurrent-transfer.eg.js
```

## Technical Limitations & Best Practices

### Limitations

- **Transaction Size**: Complex operations with multiple account updates may exceed Mina's transaction size limits
- **Proof Generation**: Side-loaded proofs require additional computational resources
- **Account Updates**: Limited to 9 account updates per transaction

### Best Practices

- Configure token parameters carefully based on your use case
- For public token operations, use standard methods (mint, burn, transferCustom)
- For private operations requiring ZK proofs, use the WithProof variants
- Consider the trade-offs between fixed and ranged amount configurations
- Use admin privileges judiciously for security-critical operations

## Build and Test

```sh
# Build the project
npm run build

# Run all tests
npm run test

# Run tests in watch mode
npm run testw

# Run test coverage
npm run coverage
```

## License

[Apache-2.0](LICENSE)
