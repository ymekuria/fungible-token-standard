import { Bool, Struct, UInt64 } from 'o1js';

export { MintConfig, MintParams, DEFAULT_MINT_CONFIG };
/**
 * MintConfig defines the minting options for tokens.
 *
 * @property publicMint - When true, the admin signature requirement is removed so any user can mint.
 * @property fixedAmountMint - When true, users can mint a fixed, predetermined amount of tokens (e.g., 200 tokens).
 * @property rangeMint - When true, users can mint a variable amount of tokens within a specified range.
 */
class MintConfig extends Struct({
  publicMint: Bool,
  fixedAmountMint: Bool,
  rangeMint: Bool,
  verifySideLoadedProof: Bool,
}) {}

/**
 * MintParams defines the parameters for token minting.
 *
 * @property fixedAmount - The fixed amount of tokens to mint, if applicable.
 * @property minAmount - The minimum number of tokens that can be minted in a ranged mint.
 * @property maxAmount - The maximum number of tokens that can be minted in a ranged mint.
 */
class MintParams extends Struct({
  fixedAmount: UInt64,
  minAmount: UInt64,
  maxAmount: UInt64,
}) {}

/**
 * Default mint configuration.
 *
 * By default, minting requires an admin signature (publicMint is false)
 * and allows minting within a specified range (rangeMint is true).
 * Fixed amount minting (fixedAmountMint) is disabled.
 */
const DEFAULT_MINT_CONFIG = new MintConfig({
  publicMint: Bool(false),
  fixedAmountMint: Bool(false),
  rangeMint: Bool(true),
  verifySideLoadedProof: Bool(false),
});
