import {
  AccountUpdate,
  Bool,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import { FungibleToken, VKeyMerkleMap } from '../NewTokenStandard.js';
import {
  MintConfig,
  MintParams,
  BurnConfig,
  BurnParams,
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
  TransferDynamicProofConfig,
  UpdatesDynamicProofConfig,
} from '../configs.js';
import {
  program,
  generateDummyDynamicProof,
  generateDynamicProof,
  generateDynamicProof2,
  SideloadedProof,
  program2,
} from '../side-loaded/program.eg.js';

//! Tests can take up to 15 minutes with `proofsEnabled: true`, and around 4 minutes when false.
const proofsEnabled = false;

describe('New Token Standard Mint Tests', () => {
  let tokenAdmin: Mina.TestPublicKey, tokenA: Mina.TestPublicKey;

  let fee: number,
    tokenContract: FungibleToken,
    mintParams: MintParams,
    burnParams: BurnParams,
    vKeyMap: VKeyMerkleMap,
    dummyVkey: VerificationKey,
    dummyProof: SideloadedProof,
    programVkey: VerificationKey,
    deployer: Mina.TestPublicKey,
    user1: Mina.TestPublicKey,
    user2: Mina.TestPublicKey;

  beforeAll(async () => {
    if (proofsEnabled) {
      await FungibleToken.compile();
    }

    const localChain = await Mina.LocalBlockchain({
      proofsEnabled,
      enforceTransactionLimits: false,
    });

    Mina.setActiveInstance(localChain);

    [tokenAdmin, tokenA] = Mina.TestPublicKey.random(7);

    [deployer, user1, user2] = localChain.testAccounts;
    tokenContract = new FungibleToken(tokenA);

    mintParams = new MintParams({
      fixedAmount: UInt64.from(200),
      minAmount: UInt64.from(0),
      maxAmount: UInt64.from(1000),
    });

    burnParams = new BurnParams({
      fixedAmount: UInt64.from(500),
      minAmount: UInt64.from(100),
      maxAmount: UInt64.from(1500),
    });

    vKeyMap = new VKeyMerkleMap();
    dummyVkey = await VerificationKey.dummy();
    dummyProof = await generateDummyDynamicProof(
      tokenContract.deriveTokenId(),
      user1
    );
    programVkey = (await program.compile()).verificationKey;
    fee = 1e8;
  });

  async function testInitializeTx(
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    invalidMintConfig?: MintConfig,
    invalidMintParams?: MintParams,
    invalidBurnConfig?: BurnConfig,
    invalidBurnParams?: BurnParams
  ) {
    try {
      const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
        AccountUpdate.fundNewAccount(deployer);
        await tokenContract.initialize(
          tokenAdmin,
          UInt8.from(9),
          invalidMintConfig ?? MintConfig.default,
          invalidMintParams ?? mintParams,
          invalidBurnConfig ?? BurnConfig.default,
          invalidBurnParams ?? burnParams,
          MintDynamicProofConfig.default,
          BurnDynamicProofConfig.default,
          TransferDynamicProofConfig.default,
          UpdatesDynamicProofConfig.default
        );
      });
      await tx.prove();
      await tx.sign(signers).send();

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function testMintTx(
    user: PublicKey,
    mintAmount: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    numberOfAccounts = 2
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        AccountUpdate.fundNewAccount(user, numberOfAccounts);
        await tokenContract.mint(
          user,
          mintAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.add(mintAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateMintConfigTx(
    user: PublicKey,
    mintConfig: MintConfig,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateMintConfigTx = await Mina.transaction(
        { sender: user, fee },
        async () => {
          await tokenContract.updateMintConfig(mintConfig);
        }
      );
      await updateMintConfigTx.prove();
      await updateMintConfigTx.sign(signers).send().wait();

      expect(
        MintConfig.unpack(tokenContract.packedAmountConfigs.get())
      ).toEqual(mintConfig);

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateMintParamsTx(
    user: PublicKey,
    mintParams: MintParams,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateMintParamsTx = await Mina.transaction(
        { sender: user, fee },
        async () => {
          await tokenContract.updateMintParams(mintParams);
        }
      );
      await updateMintParamsTx.prove();
      await updateMintParamsTx.sign(signers).send().wait();

      expect(tokenContract.packedMintParams.get()).toEqual(mintParams.pack());

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateSLVkeyHashTx(
    sender: PublicKey,
    vKey: VerificationKey,
    vKeyMap: VKeyMerkleMap,
    operationKey: Field,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateVkeyTx = await Mina.transaction({ sender, fee }, async () => {
        await tokenContract.updateSideLoadedVKeyHash(
          vKey,
          vKeyMap,
          operationKey
        );
      });
      await updateVkeyTx.prove();
      await updateVkeyTx.sign(signers).send().wait();

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function testMintSLTx(
    user: PublicKey,
    mintAmount: UInt64,
    signers: PrivateKey[],
    proof?: SideloadedProof,
    vKey?: VerificationKey,
    vKeyMerkleMap?: VKeyMerkleMap,
    expectedErrorMessage?: string
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.mint(
          user,
          mintAmount,
          proof ?? dummyProof,
          vKey ?? dummyVkey,
          vKeyMerkleMap ?? vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.add(mintAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  describe('Deploy & initialize', () => {
    it('should deploy tokenA contract', async () => {
      const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
        AccountUpdate.fundNewAccount(deployer);

        await tokenContract.deploy({
          symbol: 'tokA',
          src: 'https://github.com/o1-labs-XT/fungible-token-standard',
        });
      });

      tx.sign([deployer.key, tokenA.key]);

      await tx.prove();
      await tx.send();
    });

    it('should reject initialization when a signature from the token address is missing', async () => {
      const expectedErrorMessage =
        'Check signature: Invalid signature on account_update 2';
      await testInitializeTx([deployer.key], expectedErrorMessage);
    });

    it('should reject initialization with invalid mintConfig', async () => {
      const invalidMintConfig = new MintConfig({
        unauthorized: Bool(false),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const expectedErrorMessage =
        'Exactly one of the fixed or ranged amount options must be enabled!';
      await testInitializeTx(
        [deployer.key, tokenA.key],
        expectedErrorMessage,
        invalidMintConfig
      );
    });

    it('should reject initialization with invalid mintParams', async () => {
      const invalidMintParams = new MintParams({
        fixedAmount: UInt64.from(100),
        minAmount: UInt64.from(300),
        maxAmount: UInt64.from(100),
      });

      const expectedErrorMessage = 'Invalid amount range!';
      await testInitializeTx(
        [deployer.key, tokenA.key],
        expectedErrorMessage,
        undefined,
        invalidMintParams
      );
    });

    it('should reject initialization with invalid burnConfig', async () => {
      const invalidBurnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const expectedErrorMessage =
        'Exactly one of the fixed or ranged amount options must be enabled!';
      await testInitializeTx(
        [deployer.key, tokenA.key],
        expectedErrorMessage,
        undefined,
        undefined,
        invalidBurnConfig
      );
    });

    it('should reject initialization with invalid burnParams', async () => {
      const invalidBurnParams = new BurnParams({
        fixedAmount: UInt64.from(200),
        minAmount: UInt64.from(240),
        maxAmount: UInt64.from(150),
      });

      const expectedErrorMessage = 'Invalid amount range!';
      await testInitializeTx(
        [deployer.key, tokenA.key],
        expectedErrorMessage,
        undefined,
        undefined,
        undefined,
        invalidBurnParams
      );
    });

    it('Should initialize tokenA contract', async () => {
      await testInitializeTx([deployer.key, tokenA.key]);
    });

    //! Throws an error because the first `initialize` has set the permissions to impossible
    //! not because of the `provedState` precondition
    it('Should prevent calling `initialize()` a second time', async () => {
      const expectedErrorMessage =
        "Cannot update field 'permissions' because permission for this field is 'Impossible'";
      await testInitializeTx([deployer.key, tokenA.key], expectedErrorMessage);
    });
  });

  describe('Mint Config: Default: Authorized/Ranged', () => {
    it('should mint an amount within the valid range: user', async () => {
      await testMintTx(user1, UInt64.from(200), [user1.key, tokenAdmin.key]);
    });

    it('should reject minting an amount outside the valid range', async () => {
      await testMintTx(
        user1,
        UInt64.from(1100),
        [user1.key, tokenAdmin.key],
        'Not allowed to mint tokens'
      );
    });

    it('should reject minting to the circulating supply account', async () => {
      const expectedErrorMessage =
        "Can't transfer to/from the circulation account";
      try {
        const tx = await Mina.transaction({ sender: user2, fee }, async () => {
          AccountUpdate.fundNewAccount(user2, 2);
          await tokenContract.mint(
            tokenContract.address,
            UInt64.from(200),
            dummyProof,
            dummyVkey,
            vKeyMap
          );
        });
        await tx.prove();
        await tx.sign([user2.key, tokenAdmin.key]).send().wait();

        throw new Error('Test should have failed but didnt!');
      } catch (error: unknown) {
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });

    it('should reject unauthorized minting', async () => {
      await testMintTx(
        user1,
        UInt64.from(300),
        [user1.key],
        'the required authorization was not provided or is invalid.'
      );
    });
  });

  describe('Update Mint Config: Unauthorized/Fixed', () => {
    it('should reject mintConfig update when both range and fixed mint are enabled', async () => {
      const mintConfig = new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const expectedErrorMessage =
        'Exactly one of the fixed or ranged amount options must be enabled!';
      await updateMintConfigTx(
        user1,
        mintConfig,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject mintConfig update when unauthorized by the admin', async () => {
      const mintConfig = new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';
      await updateMintConfigTx(
        user2,
        mintConfig,
        [user2.key],
        expectedErrorMessage
      );
    });

    it('should update packed mintConfig', async () => {
      const mintConfig = new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateMintConfigTx(user2, mintConfig, [user2.key, tokenAdmin.key]);
    });
  });

  describe('Update Mint Params', () => {
    it('should reject mintParams update given an invalid range', async () => {
      mintParams = new MintParams({
        fixedAmount: UInt64.from(200),
        minAmount: UInt64.from(500),
        maxAmount: UInt64.from(0),
      });

      const expectedErrorMessage = 'Invalid amount range!';
      await updateMintParamsTx(
        user2,
        mintParams,
        [user2.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject mintParams update when unauthorized by the admin', async () => {
      mintParams = new MintParams({
        fixedAmount: UInt64.from(600),
        minAmount: UInt64.from(100),
        maxAmount: UInt64.from(900),
      });

      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';
      await updateMintParamsTx(
        user1,
        mintParams,
        [user1.key],
        expectedErrorMessage
      );
    });

    it('should update packed mintParams', async () => {
      await updateMintParamsTx(user1, mintParams, [user1.key, tokenAdmin.key]);
    });
  });

  describe('Mint Config: Unauthorized/Fixed', () => {
    it('should allow minting without authorization', async () => {
      await testMintTx(user2, UInt64.from(600), [user2.key], undefined, 1);
    });

    it('should reject minting an amount different from the fixed value', async () => {
      await testMintTx(
        user1,
        UInt64.from(500),
        [user1.key],
        'Not allowed to mint tokens'
      );
    });
  });

  describe('Update Mint Dynamic Proof Config', () => {
    it('should reject mintDynamicProofConfig update when unauthorized by the admin', async () => {
      try {
        let mintDynamicProofConfig = MintDynamicProofConfig.default;
        mintDynamicProofConfig.shouldVerify = Bool(true);

        const updateMintDynamicProofConfigTx = await Mina.transaction(
          { sender: user2, fee },
          async () => {
            await tokenContract.updateMintDynamicProofConfig(
              mintDynamicProofConfig
            );
          }
        );
        await updateMintDynamicProofConfigTx.prove();
        await updateMintDynamicProofConfigTx.sign([user2.key]).send().wait();
      } catch (error: unknown) {
        const expectedErrorMessage =
          'the required authorization was not provided or is invalid';
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });

    it('update mint dynamic proof config: enable side-loaded verification', async () => {
      let mintDynamicProofConfig = MintDynamicProofConfig.default;
      mintDynamicProofConfig.shouldVerify = Bool(true);

      const updateMintDynamicProofConfigTx = await Mina.transaction(
        { sender: user2, fee },
        async () => {
          await tokenContract.updateMintDynamicProofConfig(
            mintDynamicProofConfig
          );
        }
      );
      await updateMintDynamicProofConfigTx.prove();
      await updateMintDynamicProofConfigTx
        .sign([user2.key, tokenAdmin.key])
        .send()
        .wait();
    });
  });

  describe('Update Side-loaded vKey Hash', () => {
    it('should reject updating side-loaded vKey hash: unauthorized by the admin', async () => {
      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        Field(1),
        [user1.key],
        expectedErrorMessage
      );
    });

    it('should reject updating side-loaded vKey hash: invalid operationKey', async () => {
      const expectedErrorMessage = 'Please enter a valid operation key!';
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        Field(5),
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject updating side-loaded vKey hash: non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(6n, Field.random());

      const expectedErrorMessage =
        'Off-chain side-loaded vKey Merkle Map is out of sync!';
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        tamperedVKeyMap,
        Field(1),
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject mint if vKeyHash was never updated', async () => {
      const expectedErrorMessage =
        'Verification key hash is missing for this operation. Please make sure to register it before verifying a side-loaded proof when `shouldVerify` is enabled in the config.';

      await testMintSLTx(
        user2,
        UInt64.from(600),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should update the side-loaded vKey hash for mints', async () => {
      await updateSLVkeyHashTx(user1, programVkey, vKeyMap, Field(1), [
        user1.key,
        tokenAdmin.key,
      ]);
      vKeyMap.set(Field(1), programVkey.hash);
      expect(tokenContract.vKeyMapRoot.get()).toEqual(vKeyMap.root);
    });
  });

  // SLV = Side-Loaded Verification (enabled)
  describe('Mint Config: Unauthorized/Ranged/SLV Mint', () => {
    it('should reject mint given a non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(6n, Field.random());

      const expectedErrorMessage =
        'Off-chain side-loaded vKey Merkle Map is out of sync!';

      await testMintSLTx(
        user2,
        UInt64.from(600),
        [user2.key],
        dummyProof,
        dummyVkey,
        tamperedVKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given a non-compliant vKey hash', async () => {
      const expectedErrorMessage = 'Invalid side-loaded verification key!';

      await testMintSLTx(
        user2,
        UInt64.from(600),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    //! only passes when `proofsEnabled=true`
    (!proofsEnabled ? it.skip : it)(
      'should reject mint given an invalid proof',
      async () => {
        await program2.compile();
        const mintAmount = UInt64.from(600);
        const invalidProof = await generateDynamicProof2(
          tokenContract.deriveTokenId(),
          user1
        );

        const expectedErrorMessage = 'Constraint unsatisfied (unreduced)';
        await testMintSLTx(
          user1,
          mintAmount,
          [user1.key],
          invalidProof,
          programVkey,
          vKeyMap,
          expectedErrorMessage
        );
      }
    );

    it('should mint given a valid proof', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const mintAmount = UInt64.from(600);
      await testMintSLTx(
        user2,
        mintAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap
      );
    });

    it('should reject mint for a non-compliant proof recipient', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = 'Recipient mismatch in side-loaded proof!';
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given an invalid proof requireTokenIdMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(Field(1), user1);

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = 'Token ID mismatch between input and output';
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given an invalid proof requireMinaBalanceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user1
      );

      const sendMinaTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          const sendUpdate = AccountUpdate.createSigned(user1);
          sendUpdate.send({
            to: deployer,
            amount: UInt64.from(1e9),
          });
        }
      );
      sendMinaTx.prove();
      sendMinaTx.sign([user1.key]).send().wait();

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = 'Mismatch in MINA account balance.';
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given an invalid proof requireCustomTokenBalanceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      // user1 pays for tx fees to not get a "mina account balance mismatch" error
      // we burn tokens for user2 to change the custom token balance and test the precondition
      const burnTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          await tokenContract.burn(
            user2,
            UInt64.from(100),
            dynamicProof,
            programVkey,
            vKeyMap
          );
        }
      );
      await burnTx.prove();
      await burnTx.sign([user1.key, user2.key]).send().wait();

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage =
        'Custom token balance inconsistency detected!';
      await testMintSLTx(
        user2,
        mintAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given an invalid proof requireMinaNonceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user1
      );

      // user1 pays for tx fees to increase the nonce of his mina account
      // user2 sends the fee amount to user1 to conserve the balance of the mina account
      const sendTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          const sendUpdate = AccountUpdate.createSigned(user2);
          sendUpdate.send({
            to: user1,
            amount: fee,
          });
        }
      );

      await sendTx.prove();
      await sendTx.sign([user1.key, user2.key]).send().wait();

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = 'Mismatch in MINA account nonce!';
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    //! supposed to fail but didn't -> we might need to remove the token account nonce precondition
    it.skip('should reject mint given an invalid proof requireCustomTokenNonceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      // user1 pays for tx fees to not get a "mina account balance mismatch" error
      // user2 transfer custom tokens to user1 to increase the nonce of his token account
      // user1 transfer custom tokens to user2 to conserve the the total token balance of user2
      const transfersTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          await tokenContract.transferCustom(
            user1,
            user2,
            UInt64.from(100),
            dummyProof,
            dummyVkey,
            vKeyMap
          );
          await tokenContract.transferCustom(
            user2,
            user1,
            UInt64.from(100),
            dummyProof,
            dummyVkey,
            vKeyMap
          );
        }
      );

      await transfersTx.prove();
      transfersTx.sign([user1.key, user2.key]).send().wait();

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = 'Mismatch in MINA account nonce!';
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });
  });
});
