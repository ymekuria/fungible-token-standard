import { Bool, Field, Struct, UInt64 } from 'o1js';

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
}) {
  /**
   * Default mint configuration.
   *
   * By default, minting requires an admin signature (publicMint is false)
   * and allows minting within a specified range (rangeMint is true).
   *
   * Fixed amount minting (fixedAmountMint) is disabled
   */
  static default = new this({
    publicMint: Bool(false),
    fixedAmountMint: Bool(false),
    rangeMint: Bool(true),
  });

  /**
   * Unpacks a Field value into a MintConfig instance.
   *
   * The packed Field is expected to contain 3 bits representing the following configuration flags:
   * 1. publicMint
   * 2. fixedAmountMint
   * 3. rangeMint
   *
   * @param packedMintConfig - The packed mint configuration as a Field.
   * @returns A MintConfig instance with the unpacked configuration flags.
   */
  static unpack(packedMintConfig: Field) {
    const serializedMintConfig = packedMintConfig.toBits(3);
    const [publicMint, fixedAmountMint, rangeMint] = serializedMintConfig;

    return new this({
      publicMint,
      fixedAmountMint,
      rangeMint,
    });
  }

  /**
   * Packs the mint configuration into a single Field value.
   *
   * Each boolean flag from the mint configuration is converted to its 1-bit representation,
   * concatenated together, and then reassembled into a single Field.
   *
   * @param mintConfig - The mint configuration to pack.
   * @returns The packed mint configuration as a Field.
   */
  pack() {
    const { publicMint, fixedAmountMint, rangeMint } = this;

    const serializedMintConfig = [
      publicMint.toField().toBits(1),
      fixedAmountMint.toField().toBits(1),
      rangeMint.toField().toBits(1),
    ].flat();

    const packedMintConfig = Field.fromBits(serializedMintConfig);

    return packedMintConfig;
  }

  /**
   * Validates the minting configuration to ensure that exactly one minting mode
   * is enabled—either fixed amount mint or range mint. Throws an error if both
   * or neither are enabled.
   *
   * @throws If neither or both `fixedAmountMint` and `rangeMint` are enabled.
   */
  validate() {
    const { fixedAmountMint, rangeMint } = this;
    fixedAmountMint
      .toField()
      .add(rangeMint.toField())
      .assertEquals(
        1,
        'Exactly one of the fixed amount or range mint options must be enabled!'
      );
  }
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
}) {
  /**
   * Unpacks a Field value into a MintParams instance.
   *
   * The packed Field is expected to be composed of three concatenated 64-bit segments representing:
   * - fixedAmount,
   * - minAmount, and
   * - maxAmount.
   *
   * Each segment is converted back into a UInt64 value.
   *
   * @param packedMintParams - The packed mint parameters as a Field.
   * @returns A new MintParams instance with the unpacked fixed, minimum, and maximum amounts.
   */
  static unpack(packedMintParams: Field) {
    const serializedMintParams = packedMintParams.toBits(64 * 3);

    const fixedAmount = UInt64.fromBits(serializedMintParams.slice(0, 64));
    const minAmount = UInt64.fromBits(serializedMintParams.slice(64, 64 * 2));
    const maxAmount = UInt64.fromBits(
      serializedMintParams.slice(64 * 2, 64 * 3)
    );

    return new this({
      fixedAmount,
      minAmount,
      maxAmount,
    });
  }

  /**
   * Packs the mint parameters into a single Field value.
   *
   * Each mint parameter (fixedAmount, minAmount, and maxAmount) is converted into a 64-bit representation,
   * concatenated, and then assembled into one Field.
   *
   * @param mintParams - The mint parameters to pack.
   * @returns The packed mint parameters as a Field.
   */
  pack() {
    const { fixedAmount, minAmount, maxAmount } = this;
    const serializedMintParams = [
      fixedAmount.toBits(),
      minAmount.toBits(),
      maxAmount.toBits(),
    ].flat();

    const packedMintParams = Field.fromBits(serializedMintParams);

    return packedMintParams;
  }

  /**
   * Validates that the minting range is correctly configured by asserting that
   * `minAmount` is less than `maxAmount`.
   *
   * @throws If `minAmount` is not less than `maxAmount`.
   */
  validate() {
    const { minAmount, maxAmount } = this;
    minAmount.assertLessThan(maxAmount, 'Invalid mint range!');
  }
}

/**
 * Configuration for dynamic proof verification.
 *
 * This configuration dictates whether some checks are enforced and various elements captured during proof generation
 * must match the corresponding values at verification time.
 *
 * @property shouldVerify - When true, a side-loaded proof is verified during the process.
 * @property requireTokenIdMatch - Enforces that the token ID in the public input must match the token ID in the public output.
 * @property requireMinaBalanceMatch - Enforces that the MINA balance captured during proof generation matches the balance read at verification.
 * @property requireCustomTokenBalanceMatch - Enforces that the custom token balance captured during proof generation matches the balance read at verification.
 * @property requireMinaNonceMatch - Enforces that the MINA account nonce remains consistent between proof generation and verification.
 * @property requireCustomTokenNonceMatch - Enforces that the custom token account nonce remains consistent between proof generation and verification.
 */
class DynamicProofConfig extends Struct({
  shouldVerify: Bool,
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
   * - Side-loaded proof verification (shouldVerify) is disabled.
   * - Token ID matching is enforced.
   * - MINA balance matching is not enforced.
   * - Custom token balance matching is not enforced.
   * - MINA nonce matching is not enforced.
   * - Custom token nonce matching is enforced.
   */
  static default = new this({
    shouldVerify: Bool(false),
    requireTokenIdMatch: Bool(true),
    requireMinaBalanceMatch: Bool(true),
    requireCustomTokenBalanceMatch: Bool(true),
    requireMinaNonceMatch: Bool(true),
    requireCustomTokenNonceMatch: Bool(true),
  });

  /**
   * Unpacks a Field value into a DynamicProofConfig instance.
   *
   * The packed Field is expected to contain 6 bits corresponding to:
   * - shouldVerify
   * - requireTokenIdMatch
   * - requireMinaBalanceMatch
   * - requireCustomTokenBalanceMatch
   * - requireMinaNonceMatch
   * - requireCustomTokenNonceMatch
   *
   * @param packedDynamicProofConfig - The packed dynamic proof configuration as a Field.
   * @returns A new DynamicProofConfig instance with the unpacked configuration flags.
   */
  static unpack(packedDynamicProofConfig: Field) {
    const serializedDynamicProofConfig = packedDynamicProofConfig.toBits(6);
    const [
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    ] = serializedDynamicProofConfig;

    return new this({
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    });
  }

  /**
   * Packs the dynamic proof configuration flags into a single Field value.
   *
   * Each flag is converted into its 1-bit representation, and the resulting bits are concatenated
   * to form a single Field that represents the entire configuration.
   *
   * @param dynamicProofConfig - The dynamic proof configuration to pack.
   * @returns The packed dynamic proof configuration as a Field.
   */
  pack() {
    const {
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    } = this;

    const serializedDynamicProofConfig = [
      shouldVerify.toField().toBits(1),
      requireTokenIdMatch.toField().toBits(1),
      requireMinaBalanceMatch.toField().toBits(1),
      requireCustomTokenBalanceMatch.toField().toBits(1),
      requireMinaNonceMatch.toField().toBits(1),
      requireCustomTokenNonceMatch.toField().toBits(1),
    ].flat();

    const packedDynamicProofConfig = Field.fromBits(
      serializedDynamicProofConfig
    );

    return packedDynamicProofConfig;
  }
}
