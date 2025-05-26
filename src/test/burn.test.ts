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

const proofsEnabled = true;

describe('New Token Standard Burn Tests', () => {
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

    mintParams = MintParams.create(MintConfig.default, {
      minAmount: UInt64.from(0),
      maxAmount: UInt64.from(1000),
    });

    burnParams = BurnParams.create(BurnConfig.default, {
      minAmount: UInt64.from(50),
      maxAmount: UInt64.from(500),
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

  async function testBurnTx(
    user: PublicKey,
    burnAmount: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    numberOfAccounts = 2
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        AccountUpdate.fundNewAccount(user, numberOfAccounts);
        await tokenContract.burn(
          user,
          burnAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.sub(burnAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateBurnConfigTx(
    user: PublicKey,
    burnConfig: BurnConfig,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateBurnConfigTx = await Mina.transaction(
        { sender: user, fee },
        async () => {
          await tokenContract.updateBurnConfig(burnConfig);
        }
      );
      await updateBurnConfigTx.prove();
      await updateBurnConfigTx.sign(signers).send().wait();

      expect(
        BurnConfig.unpack(tokenContract.packedAmountConfigs.get())
      ).toEqual(burnConfig);

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateBurnParamsTx(
    user: PublicKey,
    burnParams: BurnParams,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateBurnParamsTx = await Mina.transaction(
        { sender: user, fee },
        async () => {
          await tokenContract.updateBurnParams(burnParams);
        }
      );
      await updateBurnParamsTx.prove();
      await updateBurnParamsTx.sign(signers).send().wait();

      expect(tokenContract.packedBurnParams.get()).toEqual(burnParams.pack());

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

  async function testBurnSLTx(
    user: PublicKey,
    burnAmount: UInt64,
    signers: PrivateKey[],
    proof?: SideloadedProof,
    vKey?: VerificationKey,
    vKeyMerkleMap?: VKeyMerkleMap,
    expectedErrorMessage?: string
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.burn(
          user,
          burnAmount,
          proof ?? dummyProof,
          vKey ?? dummyVkey,
          vKeyMerkleMap ?? vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.sub(burnAmount));

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

    it('should initialize tokenA contract', async () => {
      const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
        AccountUpdate.fundNewAccount(deployer);
        await tokenContract.initialize(
          tokenAdmin,
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
      });
      await tx.prove();
      await tx.sign([deployer.key, tokenA.key]).send();
    });

    it('should mint for user1 and user2', async () => {
      const mintAmount = UInt64.from(1000);
      const tx = await Mina.transaction({ sender: user1, fee }, async () => {
        AccountUpdate.fundNewAccount(user1, 3);
        await tokenContract.mint(
          user1,
          mintAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );

        await tokenContract.mint(
          user2,
          mintAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );
      });
      await tx.prove();
      await tx.sign([user1.key, tokenAdmin.key]).send().wait();
    });
  });

  describe('Burn Config: Default: Unauthorized/Ranged', () => {
    it('should allow burning without authorization', async () => {
      await testBurnTx(user2, UInt64.from(100), [user2.key], undefined, 0);
    });

    it('should burn an amount within the valid range: user', async () => {
      await testBurnTx(user1, UInt64.from(50), [user1.key], undefined, 0);
    });

    it('should reject burning an amount outside the valid range', async () => {
      await testBurnTx(
        user1,
        UInt64.from(700),
        [user1.key],
        'Not allowed to burn tokens'
      );
    });

    it('should reject burning from the circulating supply account', async () => {
      const expectedErrorMessage =
        "Can't transfer to/from the circulation account";
      try {
        const tx = await Mina.transaction({ sender: user2, fee }, async () => {
          AccountUpdate.fundNewAccount(user2, 2);
          await tokenContract.burn(
            tokenContract.address,
            UInt64.from(100),
            dummyProof,
            dummyVkey,
            vKeyMap
          );
        });
        await tx.prove();
        await tx.sign([user2.key]).send().wait();

        throw new Error('Test should have failed but didnt!');
      } catch (error: unknown) {
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });
  });

  describe('Update Burn Config: Unauthorized/Fixed', () => {
    it('should reject burnConfig update when both range and fixed burn are enabled', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const expectedErrorMessage =
        'Exactly one of the fixed or ranged amount options must be enabled!';
      await updateBurnConfigTx(
        user1,
        burnConfig,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    //! should test authorized burns
    it('should reject burnConfig update when unauthorized by the admin', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';
      await updateBurnConfigTx(
        user2,
        burnConfig,
        [user2.key],
        expectedErrorMessage
      );
    });

    it('should update packed burnConfig', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateBurnConfigTx(user2, burnConfig, [user2.key, tokenAdmin.key]);
    });
  });

  describe('Update Burn Params', () => {
    it('should reject burnParams update given an invalid range', async () => {
      burnParams = new BurnParams({
        fixedAmount: UInt64.from(300),
        minAmount: UInt64.from(100),
        maxAmount: UInt64.from(50),
      });

      const expectedErrorMessage = 'Invalid amount range!';
      await updateBurnParamsTx(
        user2,
        burnParams,
        [user2.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject burnParams update when unauthorized by the admin', async () => {
      burnParams = new BurnParams({
        fixedAmount: UInt64.from(150),
        minAmount: UInt64.from(100),
        maxAmount: UInt64.from(850),
      });

      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';
      await updateBurnParamsTx(
        user1,
        burnParams,
        [user1.key],
        expectedErrorMessage
      );
    });

    it('should update packed burnParams', async () => {
      await updateBurnParamsTx(user1, burnParams, [user1.key, tokenAdmin.key]);
    });
  });

  // burn fixed amount is set to 150
  describe('Burn Config: Unauthorized/Fixed', () => {
    it('should reject burning an amount different from the fixed value', async () => {
      await testBurnTx(
        user1,
        UInt64.from(50),
        [user1.key],
        'Not allowed to burn tokens',
        0
      );
    });

    it('should only burn an amount equal to the fixed value', async () => {
      await testBurnTx(user2, UInt64.from(150), [user2.key], undefined, 0);
    });
  });

  describe('Burn Config: Authorized/Fixed', () => {
    it('update burn config to enforce admin authorization', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(false),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateBurnConfigTx(user2, burnConfig, [user2.key, tokenAdmin.key]);
    });

    it('should reject unauthorized burning', async () => {
      await testBurnTx(
        user1,
        UInt64.from(150),
        [user1.key],
        'the required authorization was not provided or is invalid.'
      );
    });

    it('update burn config again to disable admin authorization', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateBurnConfigTx(user2, burnConfig, [user2.key, tokenAdmin.key]);
    });
  });

  describe('Update Burn Dynamic Proof Config', () => {
    it('should reject burnDynamicProofConfig update when unauthorized by the admin', async () => {
      try {
        let burnDynamicProofConfig = BurnDynamicProofConfig.default;
        burnDynamicProofConfig.shouldVerify = Bool(true);

        const updateBurnDynamicProofConfigTx = await Mina.transaction(
          { sender: user2, fee },
          async () => {
            await tokenContract.updateBurnDynamicProofConfig(
              burnDynamicProofConfig
            );
          }
        );
        await updateBurnDynamicProofConfigTx.prove();
        await updateBurnDynamicProofConfigTx.sign([user2.key]).send().wait();
      } catch (error: unknown) {
        const expectedErrorMessage =
          'the required authorization was not provided or is invalid';
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });

    it('update burn dynamic proof config: enable side-loaded verification', async () => {
      let burnDynamicProofConfig = BurnDynamicProofConfig.default;
      burnDynamicProofConfig.shouldVerify = Bool(true);

      const updateBurnDynamicProofConfigTx = await Mina.transaction(
        { sender: user2, fee },
        async () => {
          await tokenContract.updateBurnDynamicProofConfig(
            burnDynamicProofConfig
          );
        }
      );
      await updateBurnDynamicProofConfigTx.prove();
      await updateBurnDynamicProofConfigTx
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
        Field(2),
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
        Field(10),
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject updating side-loaded vKey hash: non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(11n, Field.random());

      const expectedErrorMessage =
        'Off-chain side-loaded vKey Merkle Map is out of sync!';
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        tamperedVKeyMap,
        Field(2),
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject burn if vKeyHash was never updated', async () => {
      const expectedErrorMessage =
        'Verification key hash is missing for this operation. Please make sure to register it before verifying a side-loaded proof when `shouldVerify` is enabled in the config.';

      await testBurnSLTx(
        user2,
        UInt64.from(150),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should update the side-loaded vKey hash for burns', async () => {
      await updateSLVkeyHashTx(user1, programVkey, vKeyMap, Field(2), [
        user1.key,
        tokenAdmin.key,
      ]);
      vKeyMap.set(Field(2), programVkey.hash);
      expect(tokenContract.vKeyMapRoot.get()).toEqual(vKeyMap.root);
    });
  });

  // SLV = Side-Loaded Verification (enabled)
  describe('Burn Config: Unauthorized/Fixed/SLV Burn', () => {
    it('should reject burn given a non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(6n, Field.random());

      const expectedErrorMessage =
        'Off-chain side-loaded vKey Merkle Map is out of sync!';

      await testBurnSLTx(
        user2,
        UInt64.from(150),
        [user2.key],
        dummyProof,
        dummyVkey,
        tamperedVKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn given a non-compliant vKey hash', async () => {
      const expectedErrorMessage = 'Invalid side-loaded verification key!';

      await testBurnSLTx(
        user2,
        UInt64.from(150),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    //! only passes when `proofsEnabled=true`
    (!proofsEnabled ? test.skip : it)(
      'should reject burn given an invalid proof',
      async () => {
        await program2.compile();
        const burnAmount = UInt64.from(150);
        const invalidProof = await generateDynamicProof2(
          tokenContract.deriveTokenId(),
          user1
        );

        const expectedErrorMessage = 'Constraint unsatisfied (unreduced)';
        await testBurnSLTx(
          user1,
          burnAmount,
          [user1.key],
          invalidProof,
          programVkey,
          vKeyMap,
          expectedErrorMessage
        );
      }
    );

    it('should burn given a valid proof', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const burnAmount = UInt64.from(150);
      await testBurnSLTx(
        user2,
        burnAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap
      );
    });

    it('should reject burn for a non-compliant proof recipient', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage = 'Recipient mismatch in side-loaded proof!';
      await testBurnSLTx(
        user1,
        burnAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn given an invalid proof requireTokenIdMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(Field(1), user1);

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage = 'Token ID mismatch between input and output';
      await testBurnSLTx(
        user1,
        burnAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn given an invalid proof requireMinaBalanceMatch precondition', async () => {
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

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage = 'Mismatch in MINA account balance.';
      await testBurnSLTx(
        user1,
        burnAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn given an invalid proof requireCustomTokenBalanceMatch precondition', async () => {
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
            UInt64.from(150),
            dynamicProof,
            programVkey,
            vKeyMap
          );
        }
      );
      await burnTx.prove();
      await burnTx.sign([user1.key, user2.key]).send().wait();

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage =
        'Custom token balance inconsistency detected!';
      await testBurnSLTx(
        user2,
        burnAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn given an invalid proof requireMinaNonceMatch precondition', async () => {
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

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage = 'Mismatch in MINA account nonce!';
      await testBurnSLTx(
        user1,
        burnAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });
  });
});
