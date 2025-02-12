import {
  AccountUpdate,
  AccountUpdateForest,
  Bool,
  DeployArgs,
  Int64,
  method,
  Mina,
  Permissions,
  PrivateKey,
  PublicKey,
  SmartContract,
  State,
  state,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import {
  FungibleToken,
  FungibleTokenAdmin,
  FungibleTokenAdminBase,
  FungibleTokenAdminDeployProps,
  FungibleTokenErrors,
} from './index.js';

const proofsEnabled = false; //process.env.SKIP_PROOFS !== 'true';
if (!proofsEnabled) console.log('Skipping proof generation in tests.');

describe('token integration', () => {
  let fungibleTokenVerificationKey: VerificationKey;

  let tokenAdmin: Mina.TestPublicKey,
    newTokenAdmin: Mina.TestPublicKey,
    tokenA: Mina.TestPublicKey,
    tokenBAdmin: Mina.TestPublicKey,
    tokenB: Mina.TestPublicKey,
    thirdPartyA: Mina.TestPublicKey,
    thirdPartyB: Mina.TestPublicKey;

  let deployerPrivateKey: PrivateKey,
    deployerPublicKey: PublicKey,
    senderPrivateKey: PrivateKey,
    senderPublicKey: PublicKey,
    receiverPrivateKey: PrivateKey,
    receiverPublicKey: PublicKey,
    deployer: Mina.TestPublicKey,
    sender: Mina.TestPublicKey,
    receiver: Mina.TestPublicKey,
    tokenAdminContract: FungibleTokenAdmin,
    newTokenAdminContract: FungibleTokenAdmin,
    tokenAContract: FungibleToken,
    tokenBAdminContract: CustomTokenAdmin,
    tokenBContract: FungibleToken,
    thirdPartyAContract: ThirdParty,
    thirdPartyBContract: ThirdParty;

  beforeAll(async () => {
    if (proofsEnabled) {
      await FungibleToken.compile();
      await ThirdParty.compile();
      await FungibleTokenAdmin.compile();
      await CustomTokenAdmin.compile();
    }
    const localChain = await Mina.LocalBlockchain({
      proofsEnabled,
      enforceTransactionLimits: false,
    });
    Mina.setActiveInstance(localChain);

    const fungibleTokenVerificationKeyData = await FungibleToken.compile();
    fungibleTokenVerificationKey = VerificationKey.fromValue(
      fungibleTokenVerificationKeyData.verificationKey
    );

    [
      tokenAdmin,
      newTokenAdmin,
      tokenA,
      tokenBAdmin,
      tokenB,
      thirdPartyA,
      thirdPartyB,
    ] = Mina.TestPublicKey.random(7);

    [deployer, sender, receiver] = localChain.testAccounts;
    deployerPrivateKey = deployer.key;
    deployerPublicKey = deployerPrivateKey.toPublicKey();
    senderPrivateKey = sender.key;
    senderPublicKey = senderPrivateKey.toPublicKey();
    receiverPrivateKey = receiver.key;
    receiverPublicKey = receiverPrivateKey.toPublicKey();
    tokenAdminContract = new FungibleTokenAdmin(tokenAdmin);
    newTokenAdminContract = new FungibleTokenAdmin(newTokenAdmin);
    tokenAContract = new FungibleToken(tokenA);
    tokenBAdminContract = new CustomTokenAdmin(tokenBAdmin);
    tokenBContract = new FungibleToken(tokenB);
    thirdPartyAContract = new ThirdParty(thirdPartyA);
    thirdPartyBContract = new ThirdParty(thirdPartyB);
  });

  describe('deploy', () => {
    it('should deploy token contract A', async () => {
      const tx = await Mina.transaction(
        {
          sender: deployer,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(deployer, 3);
          await tokenAdminContract.deploy({
            adminPublicKey: tokenAdmin,
          });
          await tokenAContract.deploy({
            symbol: 'tokA',
            src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
            allowUpdates: true,
          });
          await tokenAContract.initialize(
            tokenAdmin,
            UInt8.from(9),
            Bool(true)
          );
        }
      );

      tx.sign([deployer.key, tokenA.key, tokenAdmin.key]);

      await tx.prove();
      await tx.send();
    });

    it('should reject a change of the verification key without an admin signature', async () => {
      const updateVKeyTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: deployer,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.updateVerificationKey(
              fungibleTokenVerificationKey
            );
          }
        );

        await tx.prove();
        await tx.sign([deployer.key]).send();
      };
      expect(updateVKeyTx).rejects.toThrowError(
        'the required authorization was not provided or is invalid.'
      );
    });

    it('should allow a change of the verification key', async () => {
      const tx = await Mina.transaction(
        {
          sender: deployer,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.updateVerificationKey(
            fungibleTokenVerificationKey
          );
        }
      );

      tx.sign([deployer.key, tokenAdmin.key]);

      await tx.prove();
      await tx.send();
    });

    it('should deploy token contract B', async () => {
      const tx = await Mina.transaction(
        {
          sender: deployer,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(deployer, 3);
          await tokenBAdminContract.deploy({
            adminPublicKey: tokenBAdmin,
          });
          await tokenBContract.deploy({
            symbol: 'tokB',
            src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
            allowUpdates: false,
          });
          await tokenBContract.initialize(
            tokenBAdmin,
            UInt8.from(9),
            Bool(false)
          );
        }
      );

      tx.sign([deployer.key, tokenB.key, tokenBAdmin.key]);

      await tx.prove();
      await tx.send();
    });

    it('should not allow a change of the verification key if allowUpdates is false', async () => {
      const updateVKeyTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenBContract.updateVerificationKey(
              await VerificationKey.dummy()
            );
          }
        );

        await tx.prove();
        await tx.sign([sender.key, tokenBAdmin.key]).send();
      };

      expect(updateVKeyTx).rejects.toThrowError(
        "Cannot update field 'verificationKey' because permission for this field is 'Impossible'"
      );
    });

    it('should deploy a third party contract', async () => {
      const tx = await Mina.transaction(
        {
          sender: deployer,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(deployer, 2);
          await thirdPartyAContract.deploy({ ownerAddress: tokenA });
          await thirdPartyBContract.deploy({ ownerAddress: tokenA });
        }
      );

      tx.sign([deployer.key, thirdPartyA.key, thirdPartyB.key]);

      await tx.prove();
      await tx.send();
    });

    //! Throws an error because the first `initialize` set the permissions to impossible
    //! not because of the `provedState` precondition
    it('should prevent calling `initialize()` a second time', async () => {
      const initializeTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: deployer,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.initialize(
              tokenAdmin,
              UInt8.from(9),
              Bool(true)
            );
          }
        );

        await tx.prove();
        await tx.sign([deployer.key, tokenA.key]).send();
      };

      expect(initializeTx).rejects.toThrowError();
    });
  });

  describe('admin', () => {
    const mintAmount = UInt64.from(1000);
    const burnAmount = UInt64.from(100);

    it('should not mint before calling resume()', async () => {
      const mintTx = async () => {
        await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            AccountUpdate.fundNewAccount(sender, 1);
            await tokenAContract.mint(sender, mintAmount);
          }
        );
      };

      expect(mintTx).rejects.toThrowError(FungibleTokenErrors.tokenPaused);
    });

    it('should accept a call to resume()', async () => {
      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.resume();
        }
      );
      tx.sign([sender.key, tokenAdmin.key]);
      await tx.prove();
      await tx.send();
    });

    it('should mint for the sender and receiver account', async () => {
      const initialBalance = (
        await tokenAContract.getBalanceOf(sender)
      ).toBigInt();
      const initialCirculating = (
        await tokenAContract.getCirculating()
      ).toBigInt();

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await tokenAContract.mint(sender, mintAmount);
        }
      );

      tx.sign([sender.key, tokenAdmin.key]);
      await tx.prove();
      await tx.send();

      const tx2 = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await tokenAContract.mint(receiver, mintAmount);
        }
      );

      tx2.sign([sender.key, tokenAdmin.key]);
      await tx2.prove();
      await tx2.send();

      expect((await tokenAContract.getBalanceOf(sender)).toBigInt()).toEqual(
        initialBalance + mintAmount.toBigInt()
      );
      expect((await tokenAContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating + mintAmount.mul(UInt64.from(2)).toBigInt()
      );
    });

    it('should burn tokens for the sender account', async () => {
      const initialBalance = (
        await tokenAContract.getBalanceOf(sender)
      ).toBigInt();
      const initialCirculating = (
        await tokenAContract.getCirculating()
      ).toBigInt();

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.burn(sender, burnAmount);
        }
      );

      tx.sign([sender.key]);
      await tx.prove();
      await tx.send();

      expect((await tokenAContract.getBalanceOf(sender)).toBigInt()).toEqual(
        initialBalance - burnAmount.toBigInt()
      );
      expect((await tokenAContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating - burnAmount.toBigInt()
      );
    });

    it('should refuse to mint tokens without signature from the token admin', async () => {
      const mintTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.mint(sender, mintAmount);
          }
        );

        await tx.prove();
        await tx.sign([sender.key]).send();
      };
      expect(mintTx).rejects.toThrowError(
        'required authorization was not provided'
      );
    });

    it('should refuse to burn tokens without signature from the token holder', async () => {
      const burnTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.burn(receiver, burnAmount);
          }
        );

        await tx.prove();
        await tx.sign([sender.key]).send();
      };

      expect(burnTx).rejects.toThrowError(
        'Invalid signature on account_update 1'
      );
    });

    it('correctly changes the admin contract', async () => {
      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await newTokenAdminContract.deploy({
            adminPublicKey: newTokenAdmin,
          });
          await tokenAContract.setAdmin(newTokenAdmin);
        }
      );
      tx.sign([sender.key, tokenAdmin.key, newTokenAdmin.key]);
      await tx.prove();
      await tx.send();

      const tx2 = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.mint(sender, mintAmount);
        }
      );
      tx2.sign([sender.key, newTokenAdmin.key]);
      await tx2.prove();
      await tx2.send();

      const mintTx3 = async () => {
        const tx3 = await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.mint(sender, mintAmount);
          }
        );
        await tx3.prove();
        await tx3.sign([sender.key, tokenAdmin.key]).send();
      };
      expect(mintTx3).rejects.toThrowError(
        'required authorization was not provided'
      );
    });
  });

  describe('transfers', () => {
    const sendAmount = UInt64.from(1);

    it('should do a transfer initiated by the token contract', async () => {
      const initialBalanceSender = (
        await tokenAContract.getBalanceOf(sender)
      ).toBigInt();
      const initialBalanceReceiver = (
        await tokenAContract.getBalanceOf(receiver)
      ).toBigInt();
      const initialCirculating = (
        await tokenAContract.getCirculating()
      ).toBigInt();

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.transfer(sender, receiver, sendAmount);
        }
      );

      tx.sign([sender.key]);
      await tx.prove();
      await tx.send();

      expect((await tokenAContract.getBalanceOf(sender)).toBigInt()).toEqual(
        initialBalanceSender - sendAmount.toBigInt()
      );
      expect((await tokenAContract.getBalanceOf(receiver)).toBigInt()).toEqual(
        initialBalanceReceiver + sendAmount.toBigInt()
      );
      expect((await tokenAContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating
      );
    });

    it('should reject a transaction not signed by the token holder', async () => {
      const transferTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.transfer(receiver, sender, sendAmount);
          }
        );

        await tx.prove();
        await tx.sign([sender.key]).send();
      };
      expect(transferTx).rejects.toThrowError(
        'Invalid signature on account_update 1'
      );
    });

    it('should do a transaction constructed manually, approved by the token contract', async () => {
      const initialBalanceSender = (
        await tokenAContract.getBalanceOf(sender)
      ).toBigInt();
      const initialBalanceReceiver = (
        await tokenAContract.getBalanceOf(receiver)
      ).toBigInt();
      const initialCirculating = (
        await tokenAContract.getCirculating()
      ).toBigInt();

      const updateSend = AccountUpdate.createSigned(
        sender,
        tokenAContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).negV2();

      const updateReceive = AccountUpdate.create(
        receiver,
        tokenAContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const tx = await Mina.transaction(
        {
          sender: deployer,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.approveAccountUpdates([
            updateSend,
            updateReceive,
          ]);
        }
      );
      await tx.sign([sender.key, deployer.key]).prove();
      await tx.send();

      expect((await tokenAContract.getBalanceOf(sender)).toBigInt()).toEqual(
        initialBalanceSender - sendAmount.toBigInt()
      );
      expect((await tokenAContract.getBalanceOf(receiver)).toBigInt()).toEqual(
        initialBalanceReceiver + sendAmount.toBigInt()
      );
      expect((await tokenAContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating
      );
    });

    it('should reject flash-minting transactions', async () => {
      const updateSend = AccountUpdate.createSigned(
        sender,
        tokenAContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).negV2();
      const updateReceive = AccountUpdate.create(
        receiver,
        tokenAContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);
      updateReceive;
      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.approveAccountUpdates([
              updateReceive,
              updateSend,
            ]);
          }
        );
      };
      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.flashMinting
      );
    });

    it('should reject unbalanced transactions', async () => {
      const updateSend = AccountUpdate.createSigned(
        sender,
        tokenAContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).negV2();
      const updateReceive = AccountUpdate.create(
        receiver,
        tokenAContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount).mul(2);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(deployer, async () => {
          await tokenAContract.approveAccountUpdates([
            updateSend,
            updateReceive,
          ]);
        });
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.flashMinting
      );
    });

    it('rejects transactions with mismatched tokens', async () => {
      const updateSend = AccountUpdate.createSigned(
        sender,
        tokenAContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        receiver,
        tokenBContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee: 1e8,
          },
          async () => {
            AccountUpdate.fundNewAccount(sender, 1);
            await tokenAContract.approveAccountUpdates([updateSend]);
            await tokenBContract.approveAccountUpdates([updateReceive]);
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        // FungibleTokenErrors.flashMinting
        FungibleTokenErrors.unbalancedTransaction
      );
    });

    it("Should prevent transfers from account that's tracking circulation", async () => {
      const transferTx = async () => {
        await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            AccountUpdate.fundNewAccount(sender, 1);
            await tokenAContract.transfer(tokenA, receiver, sendAmount);
          }
        );
      };

      expect(transferTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });

    it("Should prevent transfers to account that's tracking circulation", async () => {
      const transferTx = async () => {
        await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            AccountUpdate.fundNewAccount(sender, 1);
            await tokenAContract.transfer(sender, tokenA, sendAmount);
          }
        );
      };
      expect(transferTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });

    it("Should reject manually constructed transfers from the account that's tracking circulation", async () => {
      const updateSend = AccountUpdate.createSigned(
        tokenA,
        tokenAContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).negV2();
      const updateReceive = AccountUpdate.create(
        receiver,
        tokenAContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.approveAccountUpdates([
              updateSend,
              updateReceive,
            ]);
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });

    it("Should reject manually constructed transfers to the account that's tracking circulation", async () => {
      const updateSend = AccountUpdate.createSigned(
        sender,
        tokenAContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).negV2();
      const updateReceive = AccountUpdate.create(
        tokenA,
        tokenAContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.approveAccountUpdates([
              updateSend,
              updateReceive,
            ]);
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });
  });

  describe('account permissions', () => {
    it("should reject a transaction that's changing the account permission for receive", async () => {
      // const permissions = localChain.getAccount(
      const permissions = Mina.getAccount(
        sender,
        tokenAContract.deriveTokenId()
      ).permissions;
      permissions.receive = Permissions.impossible();
      const updateSend = AccountUpdate.createSigned(
        sender,
        tokenAContract.deriveTokenId()
      );
      updateSend.account.permissions.set(permissions);

      const approveBaseTx = async () => {
        await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.approveBase(
              AccountUpdateForest.fromFlatArray([updateSend])
            );
          }
        );
      };

      expect(approveBaseTx).rejects.toThrowError(
        FungibleTokenErrors.noPermissionChangeAllowed
      );
    });
  });

  describe('pausing/resuming', () => {
    const sendAmount = UInt64.from(1);

    it('can be paused by the admin', async () => {
      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.pause();
        }
      );
      tx.sign([sender.key, newTokenAdmin.key]);
      await tx.prove();
      await tx.send();
    });

    it('will block transactions while paused', async () => {
      const transferTx = async () => {
        await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenAContract.transfer(sender, receiver, sendAmount);
          }
        );
      };

      expect(transferTx).rejects.toThrowError(FungibleTokenErrors.tokenPaused);
    });

    it('can be resumed by the admin', async () => {
      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.resume();
        }
      );
      tx.sign([sender.key, newTokenAdmin.key]);
      await tx.prove();
      await tx.send();
    });

    it('will accept transactions after resume', async () => {
      const initialBalanceSender = (
        await tokenAContract.getBalanceOf(sender)
      ).toBigInt();
      const initialBalanceReceiver = (
        await tokenAContract.getBalanceOf(receiver)
      ).toBigInt();
      const initialCirculating = (
        await tokenAContract.getCirculating()
      ).toBigInt();

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          await tokenAContract.transfer(sender, receiver, sendAmount);
        }
      );

      tx.sign([sender.key]);
      await tx.prove();
      await tx.send();

      expect((await tokenAContract.getBalanceOf(sender)).toBigInt()).toEqual(
        initialBalanceSender - sendAmount.toBigInt()
      );
      expect((await tokenAContract.getBalanceOf(receiver)).toBigInt()).toEqual(
        initialBalanceReceiver + sendAmount.toBigInt()
      );
      expect((await tokenAContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating
      );
    });

    it('should prevent the deployer from minting without calling into the admin contract', async () => {
      const attackTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            // AccountUpdate.fundNewAccount(sender, 1)
            let nopUpdate = AccountUpdate.default(
              tokenA,
              tokenAContract.tokenId
            );

            let maliciousUpdate = AccountUpdate.default(
              sender,
              tokenAContract.deriveTokenId()
            );
            maliciousUpdate.balanceChange = Int64.create(UInt64.from(100n));
            maliciousUpdate.body.mayUseToken = {
              parentsOwnToken: new Bool(true),
              inheritFromParent: new Bool(false),
            };
            AccountUpdate.attachToTransaction(nopUpdate);

            nopUpdate.approve(maliciousUpdate);

            nopUpdate.requireSignature();
            maliciousUpdate.requireSignature();
          }
        );

        await tx.prove();
        await tx.sign([sender.key, tokenA.key]).send();
      };
      expect(attackTx).rejects.toThrowError();
    });
  });

  describe('third party', () => {
    const depositAmount = UInt64.from(100);

    it('should deposit from the user to the token account of the third party', async () => {
      const initialBalance = (
        await tokenAContract.getBalanceOf(sender)
      ).toBigInt();
      const initialCirculating = (
        await tokenAContract.getCirculating()
      ).toBigInt();

      const tokenId = tokenAContract.deriveTokenId();

      const updateWithdraw = AccountUpdate.createSigned(sender, tokenId);
      updateWithdraw.balanceChange = Int64.fromUnsigned(depositAmount).negV2();

      const updateDeposit = await thirdPartyAContract.deposit(depositAmount);
      updateDeposit.body.mayUseToken =
        AccountUpdate.MayUseToken.InheritFromParent;

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await tokenAContract.approveBase(
            AccountUpdateForest.fromFlatArray([updateWithdraw, updateDeposit])
          );
        }
      );

      tx.sign([sender.key]);

      await tx.prove();
      await tx.send();

      expect(
        (await tokenAContract.getBalanceOf(thirdPartyA)).toBigInt()
      ).toEqual(depositAmount.toBigInt());
      expect((await tokenAContract.getBalanceOf(sender)).toBigInt()).toEqual(
        initialBalance - depositAmount.toBigInt()
      );
      expect((await tokenAContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating
      );
    });

    it('should send tokens from one contract to another', async () => {
      const initialBalance = (
        await tokenAContract.getBalanceOf(thirdPartyA)
      ).toBigInt();
      const initialBalance2 = (
        await tokenAContract.getBalanceOf(thirdPartyB)
      ).toBigInt();
      const initialCirculating = (
        await tokenAContract.getCirculating()
      ).toBigInt();

      const transferAmount = UInt64.from(1);
      const updateWithdraw = await thirdPartyAContract.withdraw(transferAmount);
      const updateDeposit = await thirdPartyBContract.deposit(transferAmount);
      updateDeposit.body.mayUseToken =
        AccountUpdate.MayUseToken.InheritFromParent;

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await tokenAContract.approveBase(
            AccountUpdateForest.fromFlatArray([updateWithdraw, updateDeposit])
          );
        }
      );
      await tx.sign([sender.key, thirdPartyA.key]).prove();
      await tx.send();

      expect(
        (await tokenAContract.getBalanceOf(thirdPartyA)).toBigInt()
      ).toEqual(initialBalance - transferAmount.toBigInt());
      expect(
        (await tokenAContract.getBalanceOf(thirdPartyB)).toBigInt()
      ).toEqual(initialBalance2 + transferAmount.toBigInt());
      expect((await tokenAContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating
      );
    });

    it('should reject an unbalanced transaction', async () => {
      const depositAmount = UInt64.from(5);
      const withdrawAmount = UInt64.from(10);
      const updateWithdraw = await thirdPartyAContract.withdraw(withdrawAmount);
      const updateDeposit = await thirdPartyBContract.deposit(depositAmount);
      updateDeposit.body.mayUseToken =
        AccountUpdate.MayUseToken.InheritFromParent;

      const approveBaseTx = async () => {
        await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            AccountUpdate.fundNewAccount(sender, 1);
            await tokenAContract.approveBase(
              AccountUpdateForest.fromFlatArray([updateWithdraw, updateDeposit])
            );
          }
        );
      };

      expect(approveBaseTx).rejects.toThrowError(
        FungibleTokenErrors.unbalancedTransaction
      );
    });
  });

  describe('Custom Admin Contract', () => {
    const mintAmount = UInt64.from(500);
    const illegalMintAmount = UInt64.from(1000);
    const sendAmount = UInt64.from(100);

    it('should mint with a custom admin contract', async () => {
      FungibleToken.AdminContract = CustomTokenAdmin;
      const initialBalance = (
        await tokenBContract.getBalanceOf(sender)
      ).toBigInt();
      const initialCirculating = (
        await tokenBContract.getCirculating()
      ).toBigInt();

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await tokenBContract.mint(sender, mintAmount);
        }
      );

      tx.sign([sender.key]);
      await tx.prove();
      await tx.send();

      expect((await tokenBContract.getBalanceOf(sender)).toBigInt()).toEqual(
        initialBalance + mintAmount.toBigInt()
      );
      expect((await tokenBContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating + mintAmount.toBigInt()
      );
      FungibleToken.AdminContract = FungibleTokenAdmin;
    });

    it('should send tokens without having the custom admin contract', async () => {
      const initialBalanceSender = (
        await tokenBContract.getBalanceOf(sender)
      ).toBigInt();
      const initialBalanceReceiver = (
        await tokenBContract.getBalanceOf(receiver)
      ).toBigInt();
      const initialCirculating = (
        await tokenBContract.getCirculating()
      ).toBigInt();

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee: 1e8,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await tokenBContract.transfer(sender, receiver, sendAmount);
        }
      );

      tx.sign([sender.key]);
      await tx.prove();
      await tx.send();

      expect((await tokenBContract.getBalanceOf(sender)).toBigInt()).toEqual(
        initialBalanceSender - sendAmount.toBigInt()
      );
      expect((await tokenBContract.getBalanceOf(receiver)).toBigInt()).toEqual(
        initialBalanceReceiver + sendAmount.toBigInt()
      );
      expect((await tokenBContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating
      );
    });

    it('should not mint too many B tokens', async () => {
      FungibleToken.AdminContract = CustomTokenAdmin;
      const mintTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenBContract.mint(sender, illegalMintAmount);
          }
        );

        await tx.prove();
        await tx.sign([senderPrivateKey]).send();
      };

      expect(mintTx).rejects.toThrowError();

      FungibleToken.AdminContract = FungibleTokenAdmin;
    });

    //! does NOT fail because there's no condition on the amount to mint
    //! in the vanilla admin contract
    it('should not mint too many B tokens using the vanilla admin contract', async () => {
      // }, //   skip: !proofsEnabled, // {
      const mintTx = async () => {
        const tx = await Mina.transaction(
          {
            sender: sender,
            fee: 1e8,
          },
          async () => {
            await tokenBContract.mint(sender, illegalMintAmount);
          }
        );
        await tx.prove();
        await tx.sign([sender.key, tokenBAdmin.key]).send();
      };
      await mintTx();
      // expect(mintTx).rejects.toThrowError();
    });
  });
});

/** This is a faucet style admin contract, where anyone can mint, but only up to 500 tokens in a
 * single AccountUpdate */
class CustomTokenAdmin extends SmartContract implements FungibleTokenAdminBase {
  @state(PublicKey)
  private adminPublicKey = State<PublicKey>();

  async deploy(props: FungibleTokenAdminDeployProps) {
    await super.deploy(props);
    this.adminPublicKey.set(props.adminPublicKey);
  }

  private ensureAdminSignature() {
    const admin = this.adminPublicKey.getAndRequireEquals();
    return AccountUpdate.createSigned(admin);
  }

  @method.returns(Bool)
  public async canMint(accountUpdate: AccountUpdate) {
    return accountUpdate.body.balanceChange.magnitude.lessThanOrEqual(
      UInt64.from(500)
    );
  }

  @method.returns(Bool)
  public async canChangeAdmin(_admin: PublicKey) {
    this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  public async canPause(): Promise<Bool> {
    this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  public async canResume(): Promise<Bool> {
    this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  public async canChangeVerificationKey(_vk: VerificationKey): Promise<Bool> {
    this.ensureAdminSignature();
    return Bool(true);
  }
}

export default class ThirdParty extends SmartContract {
  @state(PublicKey)
  ownerAddress = State<PublicKey>();

  public get tokenOwner() {
    return new FungibleToken(this.ownerAddress.getAndRequireEquals());
  }

  async deploy(args: DeployArgs & { ownerAddress: PublicKey }) {
    await super.deploy(args);
    this.ownerAddress.set(args.ownerAddress);
  }

  @method.returns(AccountUpdate)
  public async deposit(amount: UInt64) {
    const accountUpdate = AccountUpdate.create(
      this.address,
      this.tokenOwner.deriveTokenId()
    );
    accountUpdate.balanceChange = Int64.fromUnsigned(amount);
    return accountUpdate;
  }

  @method.returns(AccountUpdate)
  public async withdraw(amount: UInt64) {
    const accountUpdate = AccountUpdate.create(
      this.address,
      this.tokenOwner.deriveTokenId()
    );
    accountUpdate.balanceChange = Int64.fromUnsigned(amount).negV2();
    accountUpdate.requireSignature();
    return accountUpdate;
  }
}
