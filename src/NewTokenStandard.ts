import {
  AccountUpdate,
  AccountUpdateForest,
  assert,
  Bool,
  DeployArgs,
  Int64,
  method,
  Permissions,
  Provable,
  PublicKey,
  State,
  state,
  Struct,
  TokenContractV2,
  Types,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import { MintConfig, MintParams, DEFAULT_MINT_CONFIG } from './configs.js';

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
  /** Setting this to `true` will allow changing the verification key later with a signature from the deployer. This will allow updating the token contract at a later stage, for instance to react to an update of the o1js library.
   * Setting it to `false` will make changes to the contract impossible, unless there is a backward incompatible change to the protocol. (see https://docs.minaprotocol.com/zkapps/writing-a-zkapp/feature-overview/permissions#example-impossible-to-upgrade and https://minafoundation.github.io/mina-fungible-token/deploy.html) */
  allowUpdates: boolean;
}

const FungibleTokenErrors = {
  noAdminKey: 'could not fetch admin contract key',
  noPermissionToChangeAdmin: 'Not allowed to change admin contract',
  noPermissionToMint: 'Not allowed to mint tokens',
  noPermissionToPause: 'Not allowed to pause token',
  noPermissionToResume: 'Not allowed to resume token',
  noTransferFromCirculation: "Can't transfer to/from the circulation account",
  noPermissionChangeAllowed:
    "Can't change permissions for access or receive on token accounts",
  flashMinting:
    'Flash-minting or unbalanced transaction detected. Please make sure that your transaction is balanced, and that your `AccountUpdate`s are ordered properly, so that tokens are not received before they are sent.',
  unbalancedTransaction: 'Transaction is unbalanced',
};

class FungibleToken extends TokenContractV2 {
  @state(UInt8) decimals = State<UInt8>();
  @state(PublicKey) admin = State<PublicKey>();
  @state(MintConfig) mintConfig = State<MintConfig>();
  //TODO add state for `mintParams` -> requires data packing!

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
      setVerificationKey: props.allowUpdates
        ? Permissions.VerificationKey.proofDuringCurrentVersion()
        : Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
      access: Permissions.proof(),
    });
  }

  /** Initializes the account for tracking total circulation.
   * @argument {PublicKey} admin - public key where the admin contract is deployed
   * @argument {UInt8} decimals - number of decimals for the token
   */
  @method
  async initialize(admin: PublicKey, decimals: UInt8) {
    this.account.provedState.requireEquals(Bool(false));

    this.admin.set(admin);
    this.decimals.set(decimals);

    //! should be maintained as on-chain state and updated exclusively by the admin
    this.mintConfig.set(DEFAULT_MINT_CONFIG);

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
   * This will only work when `allowUpdates` has been set to `true` during deployment.
   */
  @method
  async updateVerificationKey(vk: VerificationKey) {
    const canChangeVerificationKey = await this.canChangeVerificationKey(vk);
    canChangeVerificationKey.assertTrue(
      FungibleTokenErrors.noPermissionToChangeAdmin
    );
    this.account.verificationKey.set(vk);
  }

  @method
  async setAdmin(admin: PublicKey) {
    const canChangeAdmin = await this.canChangeAdmin(admin);
    canChangeAdmin.assertTrue(FungibleTokenErrors.noPermissionToChangeAdmin);

    this.admin.set(admin);
    this.emitEvent('SetAdmin', new SetAdminEvent({ adminKey: admin }));
  }

  @method.returns(AccountUpdate)
  async mint(recipient: PublicKey, amount: UInt64): Promise<AccountUpdate> {
    const accountUpdate = this.internal.mint({ address: recipient, amount });
    accountUpdate.body.useFullCommitment;

    //! mint parameters are hardcoded here!
    // In a production environment, these parameters should be stored on-chain
    // and updated exclusively by the admin.
    const mintParams = new MintParams({
      fixedAmount: UInt64.from(200),
      minAmount: UInt64.from(0),
      maxAmount: UInt64.from(1000),
    });

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
    return accountUpdate;
  }

  @method.returns(AccountUpdate)
  async burn(from: PublicKey, amount: UInt64): Promise<AccountUpdate> {
    const accountUpdate = this.internal.burn({ address: from, amount });
    const circulationUpdate = AccountUpdate.create(
      this.address,
      this.deriveTokenId()
    );
    from
      .equals(this.address)
      .assertFalse(FungibleTokenErrors.noTransferFromCirculation);
    circulationUpdate.balanceChange = Int64.fromUnsigned(amount).negV2();
    this.emitEvent('Burn', new BurnEvent({ from, amount }));
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
      totalBalance.isPositiveV2().assertFalse(FungibleTokenErrors.flashMinting);
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
    const { fixedAmountMint, rangeMint } = mintConfig;
    fixedAmountMint
      .toField()
      .add(rangeMint.toField())
      .assertEquals(
        1,
        'Exactly one of fixed amount mint or range mint must be enabled!'
      );
    this.mintConfig.set(mintConfig);
  }

  //! a config can be added to enforce additional conditions when updating the verification key.
  private async canChangeVerificationKey(_vk: VerificationKey): Promise<Bool> {
    await this.ensureAdminSignature(Bool(true));
    return Bool(true);
  }

  //! a config can be added to enforce additional conditions when updating the admin public key.
  private async canChangeAdmin(_admin: PublicKey) {
    await this.ensureAdminSignature(Bool(true));
    return Bool(true);
  }

  private async canMint(accountUpdate: AccountUpdate, mintParams: MintParams) {
    const mintConfig = this.mintConfig.getAndRequireEquals();
    const { fixedAmount, minAmount, maxAmount } = mintParams;

    minAmount.assertLessThan(maxAmount, 'Invalid mint range!');

    await this.ensureAdminSignature(mintConfig.publicMint.not());

    const magnitude = accountUpdate.body.balanceChange.magnitude;

    const isFixed = magnitude.equals(fixedAmount);

    const lowerBound = magnitude.greaterThanOrEqual(minAmount);
    const upperBound = magnitude.lessThanOrEqual(maxAmount);
    const isInRange = lowerBound.and(upperBound);

    return Provable.switch(
      [mintConfig.fixedAmountMint, mintConfig.rangeMint],
      Bool,
      [isFixed, isInRange]
    );
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
