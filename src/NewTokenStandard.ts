import {
  AccountUpdate,
  AccountUpdateForest,
  assert,
  Bool,
  DeployArgs,
  Field,
  Int64,
  method,
  Permissions,
  Provable,
  PublicKey,
  State,
  state,
  Struct,
  TokenContract,
  Types,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import {
  MintConfig,
  MintParams,
  BurnConfig,
  BurnParams,
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
} from './configs.js';
import { SideloadedProof } from './side-loaded/program.eg.js';

export {
  FungibleTokenErrors,
  FungibleToken,
  SetAdminEvent,
  MintEvent,
  BurnEvent,
  BalanceChangeEvent,
};

interface FungibleTokenDeployProps extends Exclude<DeployArgs, undefined> {
  /** The token symbol. */
  symbol: string;
  /** A source code reference, which is placed within the `zkappUri` of the contract account.
   * Typically a link to a file on github. */
  src: string;
}

const FungibleTokenErrors = {
  noAdminKey: 'could not fetch admin contract key',
  noPermissionToChangeAdmin: 'Not allowed to change admin contract',
  noPermissionToMint: 'Not allowed to mint tokens',
  noPermissionToBurn: 'Not allowed to burn tokens',
  noPermissionToPause: 'Not allowed to pause token',
  noPermissionToResume: 'Not allowed to resume token',
  noTransferFromCirculation: "Can't transfer to/from the circulation account",
  noPermissionChangeAllowed:
    "Can't change permissions for access or receive on token accounts",
  flashMinting:
    'Flash-minting or unbalanced transaction detected. Please make sure that your transaction is balanced, and that your `AccountUpdate`s are ordered properly, so that tokens are not received before they are sent.',
  unbalancedTransaction: 'Transaction is unbalanced',
};

class FungibleToken extends TokenContract {
  @state(UInt8) decimals = State<UInt8>();
  @state(PublicKey) admin = State<PublicKey>();
  @state(Field) packedAmountConfigs = State<Field>();
  @state(Field) packedMintParams = State<Field>();
  @state(Field) packedBurnParams = State<Field>();
  @state(Field) packedDynamicProofConfigs = State<Field>();
  //TODO Consider adding integrating a URI-like mechanism for enhanced referencing.
  @state(Field) vKey = State<Field>(); // the side-loaded verification key hash.

  readonly events = {
    SetAdmin: SetAdminEvent,
    Mint: MintEvent,
    Burn: BurnEvent,
    BalanceChange: BalanceChangeEvent,
  };

  private async ensureAdminSignature(condition: Bool) {
    const admin = this.admin.getAndRequireEquals();
    const accountUpdate = AccountUpdate.createIf(condition, admin);
    accountUpdate.requireSignature();

    return accountUpdate;
  }

  async deploy(props: FungibleTokenDeployProps) {
    await super.deploy(props);
    this.account.zkappUri.set(props.src);
    this.account.tokenSymbol.set(props.symbol);

    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
      access: Permissions.proof(),
    });
  }

  /** Initializes the account for tracking total circulation.
   * @argument {PublicKey} admin - public key where the admin contract is deployed
   * @argument {UInt8} decimals - number of decimals for the token
   */
  @method
  async initialize(
    admin: PublicKey,
    decimals: UInt8,
    mintConfig: MintConfig,
    mintParams: MintParams,
    burnConfig: BurnConfig,
    burnParams: BurnParams,
    mintDynamicProofConfig: MintDynamicProofConfig,
    burnDynamicProofConfig: BurnDynamicProofConfig
  ) {
    this.account.provedState.requireEquals(Bool(false));

    this.admin.set(admin);
    this.decimals.set(decimals);

    mintConfig.validate();
    this.packedAmountConfigs.set(mintConfig.packConfigs(burnConfig));

    mintParams.validate();
    this.packedMintParams.set(mintParams.pack());

    burnParams.validate();
    this.packedBurnParams.set(burnParams.pack());

    this.packedDynamicProofConfigs.set(
      mintDynamicProofConfig.packConfigs(burnDynamicProofConfig)
    );

    const accountUpdate = AccountUpdate.createSigned(
      this.address,
      this.deriveTokenId()
    );

    let permissions = Permissions.default();
    // This is necessary in order to allow token holders to burn.
    permissions.send = Permissions.none();
    permissions.setPermissions = Permissions.impossible();
    accountUpdate.account.permissions.set(permissions);
  }

  /** Update the verification key.
   * This will only work after a hardfork that increments the transaction version, the permission will be treated as `signature`.
   */
  @method
  async updateVerificationKey(vk: VerificationKey) {
    const canChangeVerificationKey = await this.canChangeVerificationKey(vk);
    canChangeVerificationKey.assertTrue(
      FungibleTokenErrors.noPermissionToChangeAdmin
    );
    this.account.verificationKey.set(vk);
  }

  /** Update the hash of the side-loaded verification key.
   * @note Evaluate whether different methods require separate verification key hashes in future iterations.
   */
  @method
  async updateSideLoadedVKeyHash(vKey: VerificationKey) {
    await this.ensureAdminSignature(Bool(true));
    this.vKey.set(vKey.hash);
  }

  @method
  async setAdmin(admin: PublicKey) {
    const canChangeAdmin = await this.canChangeAdmin(admin);
    canChangeAdmin.assertTrue(FungibleTokenErrors.noPermissionToChangeAdmin);

    this.admin.set(admin);
    this.emitEvent('SetAdmin', new SetAdminEvent({ adminKey: admin }));
  }

  @method.returns(AccountUpdate)
  async mint(
    recipient: PublicKey,
    amount: UInt64,
    proof: SideloadedProof,
    vk: VerificationKey // provide the full verification key since only the hash is stored.
  ): Promise<AccountUpdate> {
    const accountUpdate = this.internal.mint({ address: recipient, amount });
    accountUpdate.body.useFullCommitment;

    const packedMintParams = this.packedMintParams.getAndRequireEquals();
    const mintParams = MintParams.unpack(packedMintParams);

    const canMint = await this.canMint(accountUpdate, mintParams);
    canMint.assertTrue(FungibleTokenErrors.noPermissionToMint);

    recipient
      .equals(this.address)
      .assertFalse(FungibleTokenErrors.noTransferFromCirculation);

    this.approve(accountUpdate);

    this.emitEvent('Mint', new MintEvent({ recipient, amount }));

    const circulationUpdate = AccountUpdate.create(
      this.address,
      this.deriveTokenId()
    );

    circulationUpdate.balanceChange = Int64.fromUnsigned(amount);

    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const mintDynamicProofConfig = MintDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );
    await this.verifySideLoadedProof(
      proof,
      vk,
      recipient,
      mintDynamicProofConfig
    );

    return accountUpdate;
  }

  @method.returns(AccountUpdate)
  async burn(
    from: PublicKey,
    amount: UInt64,
    proof: SideloadedProof,
    vk: VerificationKey
  ): Promise<AccountUpdate> {
    const accountUpdate = this.internal.burn({ address: from, amount });

    const packedBurnParams = this.packedBurnParams.getAndRequireEquals();
    const burnParams = BurnParams.unpack(packedBurnParams);

    const canBurn = await this.canBurn(accountUpdate, burnParams);
    canBurn.assertTrue(FungibleTokenErrors.noPermissionToBurn);

    const circulationUpdate = AccountUpdate.create(
      this.address,
      this.deriveTokenId()
    );
    from
      .equals(this.address)
      .assertFalse(FungibleTokenErrors.noTransferFromCirculation);
    circulationUpdate.balanceChange = Int64.fromUnsigned(amount).neg();
    this.emitEvent('Burn', new BurnEvent({ from, amount }));

    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const burnDynamicProofConfig = BurnDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );
    await this.verifySideLoadedProof(proof, vk, from, burnDynamicProofConfig);

    return accountUpdate;
  }

  @method
  async transfer(from: PublicKey, to: PublicKey, amount: UInt64) {
    from
      .equals(this.address)
      .assertFalse(FungibleTokenErrors.noTransferFromCirculation);
    to.equals(this.address).assertFalse(
      FungibleTokenErrors.noTransferFromCirculation
    );
    this.internal.send({ from, to, amount });
  }

  private checkPermissionsUpdate(update: AccountUpdate) {
    let permissions = update.update.permissions;

    let { access, receive } = permissions.value;
    let accessIsNone = Provable.equal(
      Types.AuthRequired,
      access,
      Permissions.none()
    );
    let receiveIsNone = Provable.equal(
      Types.AuthRequired,
      receive,
      Permissions.none()
    );
    let updateAllowed = accessIsNone.and(receiveIsNone);

    assert(
      updateAllowed.or(permissions.isSome.not()),
      FungibleTokenErrors.noPermissionChangeAllowed
    );
  }

  /** Approve `AccountUpdate`s that have been created outside of the token contract.
   *
   * @argument {AccountUpdateForest} updates - The `AccountUpdate`s to approve. Note that the forest size is limited by the base token contract, @see TokenContract.MAX_ACCOUNT_UPDATES The current limit is 9.
   */
  @method
  async approveBase(updates: AccountUpdateForest): Promise<void> {
    let totalBalance = Int64.from(0);
    this.forEachUpdate(updates, (update, usesToken) => {
      // Make sure that the account permissions are not changed
      this.checkPermissionsUpdate(update);
      this.emitEventIf(
        usesToken,
        'BalanceChange',
        new BalanceChangeEvent({
          address: update.publicKey,
          amount: update.balanceChange,
        })
      );
      // Don't allow transfers to/from the account that's tracking circulation
      update.publicKey
        .equals(this.address)
        .and(usesToken)
        .assertFalse(FungibleTokenErrors.noTransferFromCirculation);

      totalBalance = Provable.if(
        usesToken,
        totalBalance.add(update.balanceChange),
        totalBalance
      );
      totalBalance.isPositive().assertFalse(FungibleTokenErrors.flashMinting);
    });
    totalBalance.assertEquals(
      Int64.zero,
      FungibleTokenErrors.unbalancedTransaction
    );
  }

  @method.returns(UInt64)
  async getBalanceOf(address: PublicKey): Promise<UInt64> {
    const account = AccountUpdate.create(address, this.deriveTokenId()).account;
    const balance = account.balance.get();
    account.balance.requireEquals(balance);
    return balance;
  }

  /** Reports the current circulating supply
   * This does take into account currently unreduced actions.
   */
  async getCirculating(): Promise<UInt64> {
    let circulating = await this.getBalanceOf(this.address);
    return circulating;
  }

  @method.returns(UInt8)
  async getDecimals(): Promise<UInt8> {
    return this.decimals.getAndRequireEquals();
  }

  @method
  async updateMintConfig(mintConfig: MintConfig) {
    //! maybe enforce that sender is admin instead of approving with an admin signature
    this.ensureAdminSignature(Bool(true));
    mintConfig.validate();
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();
    this.packedAmountConfigs.set(mintConfig.updatePackedConfigs(packedConfigs));
  }

  @method
  async updateBurnConfig(burnConfig: BurnConfig) {
    //! maybe enforce that sender is admin instead of approving with an admin signature
    this.ensureAdminSignature(Bool(true));
    burnConfig.validate();
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();
    this.packedAmountConfigs.set(burnConfig.updatePackedConfigs(packedConfigs));
  }

  @method
  async updateMintParams(mintParams: MintParams) {
    this.ensureAdminSignature(Bool(true));
    mintParams.validate();

    this.packedMintParams.set(mintParams.pack());
  }

  @method
  async updateBurnParams(burnParams: BurnParams) {
    this.ensureAdminSignature(Bool(true));
    burnParams.validate();

    this.packedBurnParams.set(burnParams.pack());
  }

  @method
  async updateMintDynamicProofConfig(
    mintDynamicProofConfig: MintDynamicProofConfig
  ) {
    //! maybe enforce more restriction
    this.ensureAdminSignature(Bool(true));
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();

    this.packedDynamicProofConfigs.set(
      mintDynamicProofConfig.updatePackedConfigs(packedDynamicProofConfigs)
    );
  }

  @method
  async updateBurnDynamicProofConfig(
    burnDynamicProofConfig: BurnDynamicProofConfig
  ) {
    //! maybe enforce more restriction
    this.ensureAdminSignature(Bool(true));
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();

    this.packedDynamicProofConfigs.set(
      burnDynamicProofConfig.updatePackedConfigs(packedDynamicProofConfigs)
    );
  }

  //! A config can be added to enforce additional conditions when updating the verification key.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async canChangeVerificationKey(_vk: VerificationKey): Promise<Bool> {
    await this.ensureAdminSignature(Bool(true));
    return Bool(true);
  }

  //! A config can be added to enforce additional conditions when updating the admin public key.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async canChangeAdmin(_admin: PublicKey) {
    await this.ensureAdminSignature(Bool(true));
    return Bool(true);
  }

  private async canMint(accountUpdate: AccountUpdate, mintParams: MintParams) {
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();
    const mintConfig = MintConfig.unpack(packedConfigs);

    const { fixedAmount, minAmount, maxAmount } = mintParams;

    await this.ensureAdminSignature(mintConfig.unauthorized.not());

    const magnitude = accountUpdate.body.balanceChange.magnitude;

    const isFixed = magnitude.equals(fixedAmount);

    const lowerBound = magnitude.greaterThanOrEqual(minAmount);
    const upperBound = magnitude.lessThanOrEqual(maxAmount);
    const isInRange = lowerBound.and(upperBound);

    const canMint = Provable.switch(
      [mintConfig.fixedAmount, mintConfig.rangedAmount],
      Bool,
      [isFixed, isInRange]
    );

    return canMint;
  }

  private async canBurn(accountUpdate: AccountUpdate, burnParams: BurnParams) {
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();
    const burnConfig = BurnConfig.unpack(packedConfigs);

    const { fixedAmount, minAmount, maxAmount } = burnParams;

    await this.ensureAdminSignature(burnConfig.unauthorized.not());

    const magnitude = accountUpdate.body.balanceChange.magnitude;

    const isFixed = magnitude.equals(fixedAmount);

    const lowerBound = magnitude.greaterThanOrEqual(minAmount);
    const upperBound = magnitude.lessThanOrEqual(maxAmount);
    const isInRange = lowerBound.and(upperBound);

    const canBurn = Provable.switch(
      [burnConfig.fixedAmount, burnConfig.rangedAmount],
      Bool,
      [isFixed, isInRange]
    );

    return canBurn;
  }

  private async verifySideLoadedProof(
    proof: SideloadedProof,
    vk: VerificationKey,
    recipient: PublicKey,
    dynamicProofConfig: MintDynamicProofConfig | BurnDynamicProofConfig
  ) {
    const {
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    } = dynamicProofConfig;

    // Ensure the provided side-loaded verification key hash matches the stored on-chain state.
    const isVKeyValid = Provable.if(
      shouldVerify,
      vk.hash.equals(this.vKey.getAndRequireEquals()),
      Bool(true)
    );
    isVKeyValid.assertTrue('Invalid side-loaded verification key!');

    const { address } = proof.publicInput;

    // Check that the address in the proof corresponds to the recipient passed by the provable method.
    const isRecipientValid = Provable.if(
      shouldVerify,
      address.equals(recipient),
      Bool(true)
    );
    isRecipientValid.assertTrue('Recipient mismatch in side-loaded proof!');

    const {
      minaAccountData,
      tokenIdAccountData,
      minaBalance,
      tokenIdBalance,
      minaNonce,
      tokenIdNonce,
    } = proof.publicOutput;

    // Verify that the tokenId provided in the public input matches the tokenId in the public output,
    // unless token ID matching is not enforced.
    Provable.if(
      shouldVerify,
      tokenIdAccountData.tokenId
        .equals(this.deriveTokenId())
        .or(requireTokenIdMatch.not()),
      Bool(true)
    ).assertTrue('Token ID mismatch between input and output.');

    // Ensure the MINA account data uses native MINA.
    Provable.if(
      shouldVerify,
      minaAccountData.tokenId.equals(1),
      Bool(true)
    ).assertTrue('Incorrect token ID; expected native MINA.');

    // Verify that the MINA balance captured during proof generation matches the current on-chain balance at verification.
    // unless balance matching is not enforced.
    Provable.if(
      shouldVerify,
      minaAccountData.account.balance
        .get()
        .equals(minaBalance)
        .or(requireMinaBalanceMatch.not()),
      Bool(true)
    ).assertTrue('Mismatch in MINA account balance.');

    // Verify that the CUSTOM TOKEN balance captured during proof generation matches the current on-chain balance at verification.
    // unless balance matching is not enforced.
    Provable.if(
      shouldVerify,
      tokenIdAccountData.account.balance
        .get()
        .equals(tokenIdBalance)
        .or(requireCustomTokenBalanceMatch.not()),
      Bool(true)
    ).assertTrue('Custom token balance inconsistency detected!');

    // Verify that the MINA account nonce captured during proof generation matches the nonce at verification.
    // unless nonce matching is not enforced.
    Provable.if(
      shouldVerify,
      minaAccountData.account.nonce
        .get()
        .equals(minaNonce)
        .or(requireMinaNonceMatch.not()),
      Bool(true)
    ).assertTrue('Mismatch in MINA account nonce!');

    // Verify that the CUSTOM TOKEN nonce captured during proof generation matches the nonce at verification.
    // unless nonce matching is not enforced.
    Provable.if(
      shouldVerify,
      tokenIdAccountData.account.nonce
        .get()
        .equals(tokenIdNonce)
        .or(requireCustomTokenNonceMatch.not()),
      Bool(true)
    ).assertTrue('Mismatch in Custom token account nonce!');

    // Conditionally verify the provided side-loaded proof.
    proof.verifyIf(vk, shouldVerify);
  }
}

class SetAdminEvent extends Struct({
  adminKey: PublicKey,
}) {}
class MintEvent extends Struct({
  recipient: PublicKey,
  amount: UInt64,
}) {}

class BurnEvent extends Struct({
  from: PublicKey,
  amount: UInt64,
}) {}

class BalanceChangeEvent extends Struct({
  address: PublicKey,
  amount: Int64,
}) {}
