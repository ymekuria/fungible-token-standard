import { Bool, Struct, UInt64 } from 'o1js';

export { MintConfig, MintParams, DynamicProofConfig };

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
}) {
  /**
   * Default mint configuration.
   *
   * By default, minting requires an admin signature (publicMint is false)
   * and allows minting within a specified range (rangeMint is true).
   *
   * Fixed amount minting (fixedAmountMint) is disabled.
   */
  static default = new this({
    publicMint: Bool(false),
    fixedAmountMint: Bool(false),
    rangeMint: Bool(true),
    verifySideLoadedProof: Bool(false),
  });
}

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
 * Configuration for dynamic proof verification.
 *
 * This configuration dictates whether some checks are enforced and various elements captured during proof generation
 * must match the corresponding values at verification time.
 *
 * @property requireTokenIdMatch - Enforces that the token ID in the public input must match the token ID in the public output.
 * @property requireMinaBalanceMatch - Enforces that the MINA balance captured during proof generation matches the balance read at verification.
 * @property requireCustomTokenBalanceMatch - Enforces that the custom token balance captured during proof generation matches the balance read at verification.
 * @property requireMinaNonceMatch - Enforces that the MINA account nonce remains consistent between proof generation and verification.
 * @property requireCustomTokenNonceMatch - Enforces that the custom token account nonce remains consistent between proof generation and verification.
 */
class DynamicProofConfig extends Struct({
  requireTokenIdMatch: Bool,
  requireMinaBalanceMatch: Bool,
  requireCustomTokenBalanceMatch: Bool,
  requireMinaNonceMatch: Bool,
  requireCustomTokenNonceMatch: Bool,
}) {
  /**
   * The default dynamic proof configuration.
   *
   * By default:
   * - Token ID matching is enforced.
   * - MINA balance matching is not enforced.
   * - Custom token balance matching is not enforced.
   * - MINA nonce matching is not enforced.
   * - Custom token nonce matching is enforced.
   */
  static default = new this({
    requireTokenIdMatch: Bool(true),
    requireMinaBalanceMatch: Bool(false),
    requireCustomTokenBalanceMatch: Bool(false),
    requireMinaNonceMatch: Bool(false),
    requireCustomTokenNonceMatch: Bool(true),
  });
}
