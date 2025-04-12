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
import { FungibleToken } from './NewTokenStandard.js';
import {
  BurnConfig,
  BurnParams,
  DynamicProofConfig,
  MintConfig,
  MintParams,
} from './configs.js';
import {
  program,
  generateDummyDynamicProof,
  generateDynamicProof,
  generateDynamicProof2,
  SideloadedProof,
  program2,
} from './side-loaded/program.eg.js';
const proofsEnabled = false;

describe('New Token Standard Tests', () => {
  let tokenAdmin: Mina.TestPublicKey, tokenA: Mina.TestPublicKey;

  let fee: number,
    deployerPrivateKey: PrivateKey,
    deployerPublicKey: PublicKey,
    tokenContract: FungibleToken,
    mintConfig: MintConfig,
    mintParams: MintParams,
    burnParams: BurnParams,
    dynamicProofConfig: DynamicProofConfig,
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
    deployerPrivateKey = deployer.key;
    deployerPublicKey = deployerPrivateKey.toPublicKey();
    tokenContract = new FungibleToken(tokenA);

    mintConfig = MintConfig.default;
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

    dynamicProofConfig = new DynamicProofConfig({
      shouldVerify: Bool(false),
      requireTokenIdMatch: Bool(true),
      requireMinaBalanceMatch: Bool(true),
      requireCustomTokenBalanceMatch: Bool(true),
      requireMinaNonceMatch: Bool(true),
      requireCustomTokenNonceMatch: Bool(true),
    });

    dummyVkey = await VerificationKey.dummy();
    dummyProof = await generateDummyDynamicProof(
      tokenContract.deriveTokenId(),
      user1
    );
    programVkey = (await program.compile()).verificationKey;
    fee = 1e8;
  });

  async function testMintTx(
    user: PublicKey,
    mintAmount: UInt64,
    signers: PrivateKey[]
  ) {
    const userBalanceBefore = await tokenContract.getBalanceOf(user);
    const tx = await Mina.transaction({ sender: user, fee }, async () => {
      AccountUpdate.fundNewAccount(user, 2);
      await tokenContract.mint(user, mintAmount, dummyProof, dummyVkey);
    });
    await tx.prove();
    await tx.sign(signers).send().wait();

    const userBalanceAfter = await tokenContract.getBalanceOf(user);
    expect(userBalanceAfter).toEqual(userBalanceBefore.add(mintAmount));
  }

  async function testInvalidMintTx(
    user: PublicKey,
    mintAmount: UInt64,
    signers: PrivateKey[],
    errorMessage?: string
  ) {
    const mintTx = async () => {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        AccountUpdate.fundNewAccount(user, 2);
        await tokenContract.mint(user, mintAmount, dummyProof, dummyVkey);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();
    };
    expect(mintTx).rejects.toThrowError(errorMessage);
  }

  async function updateMintConfigTx(
    user: PublicKey,
    mintConfig: MintConfig,
    signers: PrivateKey[]
  ) {
    const updateMintConfigTx = await Mina.transaction(
      { sender: user, fee },
      async () => {
        await tokenContract.updateMintConfig(mintConfig);
      }
    );
    await updateMintConfigTx.prove();
    await updateMintConfigTx.sign(signers).send().wait();
  }

  async function updateMintParamsTx(
    user: PublicKey,
    mintParams: MintParams,
    signers: PrivateKey[]
  ) {
    const updateMintParamsTx = await Mina.transaction(
      { sender: user, fee },
      async () => {
        await tokenContract.updateMintParams(mintParams);
      }
    );
    await updateMintParamsTx.prove();
    await updateMintParamsTx.sign(signers).send().wait();
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
      const initializeTx = async () => {
        const tx = await Mina.transaction(
          { sender: deployer, fee },
          async () => {
            AccountUpdate.fundNewAccount(deployer);
            await tokenContract.initialize(
              tokenAdmin,
              UInt8.from(9),
              mintConfig,
              mintParams,
              BurnConfig.default,
              burnParams,
              dynamicProofConfig
            );
          }
        );

        await tx.prove();
        await tx.sign([deployer.key]).send();
      };

      expect(initializeTx).rejects.toThrowError(
        'Check signature: Invalid signature on account_update 2'
      );
    });

    it('should reject initialization with invalid mintParams', async () => {
      const invalidMintParams = new MintParams({
        fixedAmount: UInt64.from(100),
        minAmount: UInt64.from(300),
        maxAmount: UInt64.from(100),
      });

      const initializeTx = async () => {
        const tx = await Mina.transaction(
          { sender: deployer, fee },
          async () => {
            await tokenContract.initialize(
              tokenAdmin,
              UInt8.from(9),
              mintConfig,
              invalidMintParams,
              BurnConfig.default,
              burnParams,
              dynamicProofConfig
            );
          }
        );

        await tx.prove();
        await tx.sign([deployer.key, tokenA.key]).send();
      };

      const errorMessage = 'Invalid mint range!';
      expect(initializeTx).rejects.toThrowError(errorMessage);
    });

    it('should reject initialization with invalid mintConfig', async () => {
      const invalidMintConfig = new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const initializeTx = async () => {
        const tx = await Mina.transaction(
          { sender: deployer, fee },
          async () => {
            await tokenContract.initialize(
              tokenAdmin,
              UInt8.from(9),
              invalidMintConfig,
              mintParams,
              BurnConfig.default,
              burnParams,

              dynamicProofConfig
            );
          }
        );

        await tx.prove();
        await tx.sign([deployer.key, tokenA.key]).send();
      };

      const errorMessage =
        'Exactly one of the fixed or ranged amount options must be enabled!';
      expect(initializeTx).rejects.toThrowError(errorMessage);
    });

    it('Should initialize tokenA contract', async () => {
      const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
        AccountUpdate.fundNewAccount(deployer);
        await tokenContract.initialize(
          tokenAdmin,
          UInt8.from(9),
          mintConfig,
          mintParams,
          BurnConfig.default,
          burnParams,
          dynamicProofConfig
        );
      });

      tx.sign([deployer.key, tokenA.key]);

      await tx.prove();
      await tx.send();
    });

    //! Throws an error because the first `initialize` has set the permissions to impossible
    //! not because of the `provedState` precondition
    it('Should prevent calling `initialize()` a second time', async () => {
      const initializeTx = async () => {
        const tx = await Mina.transaction(
          { sender: deployer, fee },
          async () => {
            await tokenContract.initialize(
              tokenAdmin,
              UInt8.from(9),
              mintConfig,
              mintParams,
              BurnConfig.default,
              burnParams,
              dynamicProofConfig
            );
          }
        );

        await tx.prove();
        await tx.sign([deployer.key, tokenA.key]).send();
      };

      const errorMessage =
        "Cannot update field 'permissions' because permission for this field is 'Impossible'";
      expect(initializeTx).rejects.toThrowError(errorMessage);
    });
  });

  describe('Mint Tests', () => {
    describe('Mint Config: Default', () => {
      it('should mint an amount within the valid range: user', async () => {
        await testMintTx(user1, UInt64.from(200), [user1.key, tokenAdmin.key]);
      });

      it('should reject minting an amount outside the valid range', async () => {
        await testInvalidMintTx(
          user1,
          UInt64.from(1100),
          [user1.key, tokenAdmin.key],
          'Not allowed to mint tokens'
        );
      });

      it('should reject unauthorized minting', async () => {
        await testInvalidMintTx(
          user1,
          UInt64.from(300),
          [user1.key],
          'the required authorization was not provided or is invalid.'
        );
      });
    });

    describe('Mint Config: Public/Fixed Mint', () => {
      describe('Update Mint Config', () => {
        it('should reject mintConfig update when both range and fixed mint are enabled', async () => {
          const mintConfig = new MintConfig({
            unauthorized: Bool(true),
            fixedAmount: Bool(true),
            rangedAmount: Bool(true),
          });
          const tx = async () =>
            updateMintConfigTx(user1, mintConfig, [user1.key, tokenAdmin.key]);

          expect(tx).rejects.toThrowError(
            'Exactly one of the fixed or ranged amount options must be enabled!'
          );
        });

        it('should reject mintConfig update when unauthorized by the admin', async () => {
          const mintConfig = new MintConfig({
            unauthorized: Bool(true),
            fixedAmount: Bool(true),
            rangedAmount: Bool(false),
          });
          const tx = async () =>
            updateMintConfigTx(user2, mintConfig, [user2.key]);

          expect(tx).rejects.toThrowError(
            'the required authorization was not provided or is invalid.'
          );
        });

        it('should update packed mintConfig', async () => {
          const mintConfig = new MintConfig({
            unauthorized: Bool(true),
            fixedAmount: Bool(true),
            rangedAmount: Bool(false),
          });

          await updateMintConfigTx(user2, mintConfig, [
            user2.key,
            tokenAdmin.key,
          ]);

          expect(
            MintConfig.unpack(tokenContract.packedAmountConfigs.get())
          ).toEqual(mintConfig);
        });
      });

      describe('Update Mint Params', () => {
        it('should reject mintParams update given an invalid range', async () => {
          mintParams = new MintParams({
            fixedAmount: UInt64.from(200),
            minAmount: UInt64.from(500),
            maxAmount: UInt64.from(0),
          });

          const tx = async () =>
            updateMintParamsTx(user2, mintParams, [user2.key, tokenAdmin.key]);

          expect(tx).rejects.toThrowError('Invalid mint range!');
        });

        it('should reject mintParams update when unauthorized by the admin', async () => {
          mintParams = new MintParams({
            fixedAmount: UInt64.from(600),
            minAmount: UInt64.from(100),
            maxAmount: UInt64.from(900),
          });

          const tx = async () =>
            updateMintParamsTx(user1, mintParams, [user1.key]);

          expect(tx).rejects.toThrowError(
            'the required authorization was not provided or is invalid.'
          );
        });

        it('should update packed mintParams', async () => {
          await updateMintParamsTx(user1, mintParams, [
            user1.key,
            tokenAdmin.key,
          ]);

          expect(tokenContract.packedMintParams.get()).toEqual(
            mintParams.pack()
          );
        });
      });

      it('should allow minting without authorization', async () => {
        const userBalanceBefore = await tokenContract.getBalanceOf(user2);
        const tx = await Mina.transaction({ sender: user2, fee }, async () => {
          AccountUpdate.fundNewAccount(user2);
          await tokenContract.mint(
            user2,
            UInt64.from(600),
            dummyProof,
            dummyVkey
          );
        });
        await tx.prove();
        await tx.sign([user2.key]).send().wait();

        const userBalanceAfter = await tokenContract.getBalanceOf(user2);
        expect(userBalanceAfter).toEqual(
          userBalanceBefore.add(UInt64.from(600))
        );
      });

      it('should reject minting an amount different from the fixed value', async () => {
        await testInvalidMintTx(
          user1,
          UInt64.from(500),
          [user1.key],
          'Not allowed to mint tokens'
        );
      });
    });
  });

  describe('Mint Config: Authorized/Range/SLVerify Mint', () => {
    it('should update mintConfig and proofConfig for Authorized / Range / SLVerify settings', async () => {
      const mintConfig = new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateMintConfigTx(user2, mintConfig, [user2.key, tokenAdmin.key]);

      let dynamicProofConfig = DynamicProofConfig.default;
      dynamicProofConfig.shouldVerify = Bool(true);

      const updatePackedDynamicProofConfigTx = await Mina.transaction(
        { sender: user2, fee },
        async () => {
          await tokenContract.updatePackedDynamicProofConfig(
            dynamicProofConfig
          );
        }
      );
      await updatePackedDynamicProofConfigTx.prove();
      await updatePackedDynamicProofConfigTx
        .sign([user2.key, tokenAdmin.key])
        .send()
        .wait();

      expect(
        MintConfig.unpack(tokenContract.packedAmountConfigs.get())
      ).toEqual(mintConfig);
    });

    it('should reject updating SL vKey when unauthorized by the admin', async () => {
      const vKey = (await program.compile()).verificationKey;
      const updateVkeyTx = async () => {
        const tx = await Mina.transaction({ sender: user1, fee }, async () => {
          await tokenContract.updateSideLoadedVKeyHash(vKey);
        });
        await tx.prove();
        await tx.sign([user1.key]).send().wait();
      };
      expect(updateVkeyTx).rejects.toThrowError(
        'the required authorization was not provided or is invalid.'
      );
    });

    it('should update the on-chain side-loaded verification key', async () => {
      const updateVkeyTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          await tokenContract.updateSideLoadedVKeyHash(programVkey);
        }
      );
      await updateVkeyTx.prove();
      await updateVkeyTx.sign([user1.key, tokenAdmin.key]).send().wait();
    });

    //! supposed to fail but didn't -> this might be a bug!
    it.skip('should reject mint given an invalid proof', async () => {
      await program2.compile();
      const mintAmount = UInt64.from(600);
      const invalidProof = await generateDynamicProof2(
        tokenContract.deriveTokenId(),
        user1
      );

      const mintTx = async () => {
        const tx = await Mina.transaction({ sender: user1, fee }, async () => {
          await tokenContract.mint(
            user1,
            mintAmount,
            invalidProof,
            programVkey
          );
        });
        await tx.prove();
        await tx.sign([user1.key]).send().wait();
      };
      expect(mintTx).rejects.toThrowError();
    });

    it('should reject minting given a non-compliant SL vKey', async () => {
      const mintTx = async () => {
        const tx = await Mina.transaction({ sender: user1, fee }, async () => {
          await tokenContract.mint(
            user1,
            UInt64.from(600),
            dummyProof,
            dummyVkey
          );
        });
        await tx.prove();
        await tx.sign([user1.key]).send().wait();
      };

      expect(mintTx).rejects.toThrowError(
        'Invalid side-loaded verification key!'
      );
    });

    it('should mint given a valid proof', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const mintAmount = UInt64.from(600);
      const userBalanceBefore = await tokenContract.getBalanceOf(user2);

      const tx = await Mina.transaction({ sender: user2, fee }, async () => {
        await tokenContract.mint(user2, mintAmount, dynamicProof, programVkey);
      });
      await tx.prove();
      await tx.sign([user2.key]).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user2);
      expect(userBalanceAfter).toEqual(userBalanceBefore.add(mintAmount));
    });

    it('should reject mint for a non-compliant proof recipient', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const mintAmount = UInt64.from(600);
      const mintTx = async () => {
        const tx = await Mina.transaction({ sender: user1, fee }, async () => {
          await tokenContract.mint(
            user1,
            mintAmount,
            dynamicProof,
            programVkey
          );
        });
        await tx.prove();
        await tx.sign([user1.key]).send().wait();
      };

      expect(mintTx).rejects.toThrowError(
        'Recipient mismatch in side-loaded proof!'
      );
    });

    it('should reject mint given an invalid proof requireTokenIdMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(Field(1), user1);

      const mintAmount = UInt64.from(600);
      const mintTx = async () => {
        const tx = await Mina.transaction({ sender: user1, fee }, async () => {
          await tokenContract.mint(
            user1,
            mintAmount,
            dynamicProof,
            programVkey
          );
        });
        await tx.prove();
        await tx.sign([user1.key]).send().wait();
      };
      expect(mintTx).rejects.toThrowError(
        'Token ID mismatch between input and output'
      );
    });

    it('should reject mint given an invalid proof requireMinaBalanceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user1
      );

      const mintAmount = UInt64.from(600);
      const sendMinaTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          const sendUpdate = AccountUpdate.createSigned(user1);
          sendUpdate.send({
            to: deployerPublicKey,
            amount: UInt64.from(1e9),
          });
        }
      );
      sendMinaTx.prove();
      sendMinaTx.sign([user1.key]).send().wait();

      const mintTx = async () => {
        const tx = await Mina.transaction({ sender: user1, fee }, async () => {
          await tokenContract.mint(
            user1,
            mintAmount,
            dynamicProof,
            programVkey
          );
        });
        await tx.prove();
        await tx.sign([user1.key]).send().wait();
      };
      expect(mintTx).rejects.toThrowError('Mismatch in MINA account balance.');
    });

    it('should reject mint given an invalid proof requireCustomTokenBalanceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      //? in a tx can some account updates pass and some fail
      const mintAmount = UInt64.from(600);
      // user1 pays for tx fees to not get a "mina account balance mismatch" error
      // we burn tokens for user2 to change the custom token balance and test the precondition
      const burnTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          await tokenContract.burn(
            user2,
            UInt64.from(100),
            dynamicProof,
            programVkey
          );
        }
      );
      await burnTx.prove();
      await burnTx.sign([user1.key, user2.key]).send().wait();

      const mintTx = async () => {
        const tx = await Mina.transaction({ sender: user2, fee }, async () => {
          await tokenContract.mint(
            user2,
            mintAmount,
            dynamicProof,
            programVkey
          );
        });
        await tx.prove();
        await tx.sign([user2.key]).send().wait();
      };
      expect(mintTx).rejects.toThrowError(
        'Custom token balance inconsistency detected!'
      );
    });

    it('should reject mint given an invalid proof requireMinaNonceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user1
      );

      const mintAmount = UInt64.from(600);
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

      const mintTx = async () => {
        const tx = await Mina.transaction({ sender: user1, fee }, async () => {
          await tokenContract.mint(
            user1,
            mintAmount,
            dynamicProof,
            programVkey
          );
        });
        await tx.prove();
        await tx.sign([user1.key]).send().wait();
      };
      expect(mintTx).rejects.toThrowError('Mismatch in MINA account nonce!');
    });

    //! supposed to fail but didn't -> we might need to remove the token account nonce precondition
    it.skip('should reject mint given an invalid proof requireCustomTokenNonceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );
      const mintAmount = UInt64.from(600);
      // user1 pays for tx fees to not get a "mina account balance mismatch" error
      // user2 transfer custom tokens to user1 to increase the nonce of his token account
      // user1 transfer custom tokens to user2 to conserve the the total token balance of user2
      const transfersTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          await tokenContract.transfer(user1, user2, UInt64.from(100));
          await tokenContract.transfer(user2, user1, UInt64.from(100));
        }
      );

      await transfersTx.prove();
      transfersTx.sign([user1.key, user2.key]).send().wait();

      const mintTx = async () => {
        const tx = await Mina.transaction({ sender: user2, fee }, async () => {
          await tokenContract.mint(
            user2,
            mintAmount,
            dynamicProof,
            programVkey
          );
        });
        await tx.prove();
        await tx.sign([user2.key]).send().wait();
      };
      expect(mintTx).rejects.toThrowError('Mismatch in MINA account nonce!');
    });
  });
});
