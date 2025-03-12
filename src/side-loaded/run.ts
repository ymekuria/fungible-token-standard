import { equal } from 'node:assert';
import {
  AccountUpdate,
  Bool,
  Mina,
  PrivateKey,
  Provable,
  UInt64,
  UInt8,
} from 'o1js';
import { FungibleToken } from '../NewTokenStandard.js';
import { MintConfig } from '../configs.js';
import {
  program,
  generateDummyDynamicProof,
  generateDynamicProof,
} from './program.eg.js';

// const cs = await FungibleToken.analyzeMethods();
// console.log(cs);

const localChain = await Mina.LocalBlockchain({
  proofsEnabled: false,
  enforceTransactionLimits: false,
});
Mina.setActiveInstance(localChain);
const fee = 1e8;

const [deployer, owner, alexa] = localChain.testAccounts;
const contract = PrivateKey.randomKeypair();
const admin = PrivateKey.randomKeypair();

const token = new FungibleToken(contract.publicKey);

// 4185797382523560386307881027368447066967585209309211872358080091069402725399
const scVkey = (await FungibleToken.compile()).verificationKey;
Provable.log('FTS verification key: ', scVkey.hash);

// 28601859585317876844971055556684855811670354347630700621724962653324656992162
const vKey = (await program.compile()).verificationKey;
Provable.log('Program verification key: ', vKey.hash);

// ----------------------- DEPLOY --------------------------------
console.log('Deploying token contract.');
const deployTx = await Mina.transaction(
  {
    sender: deployer,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 2);
    await token.deploy({
      symbol: 'abc',
      src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
      allowUpdates: true,
    });
    await token.initialize(admin.publicKey, UInt8.from(9));
  }
);
await deployTx.prove();
deployTx.sign([deployer.key, contract.privateKey]);
const deployTxResult = await deployTx.send().then((v) => v.wait());
console.log('Deploy tx result:', deployTxResult.toPretty());
equal(deployTxResult.status, 'included');

// ----------------------------- Generate Dummy Dynamic Proof -----------------------------------------

const dynamicDummyProof = await generateDummyDynamicProof(
  token.deriveTokenId(),
  alexa
);

// ----------------------- MINT IN RANGE::AUTHORIZED::ALEXA --------------------------------
const alexaBalanceBeforeMint = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance before mint:', alexaBalanceBeforeMint);
equal(alexaBalanceBeforeMint, 0n);

console.log('Minting new tokens to Alexa.');
const mintTx = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(owner, 2);
    Provable.log('mina token id: ', AccountUpdate.default(owner).tokenId);
    await token.mint(alexa, new UInt64(300), dynamicDummyProof, vKey);
  }
);
// console.log(mintTx.toPretty().length, mintTx.toPretty());
await mintTx.prove();
mintTx.sign([owner.key, admin.privateKey]);
const mintTxResult = await mintTx.send().then((v) => v.wait());
console.log(
  'Mint tx result:',
  mintTxResult.toPretty().length,
  mintTxResult.toPretty()
);

const alexaBalanceAfterMint = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after mint:', alexaBalanceAfterMint);
equal(alexaBalanceAfterMint, 300n);

// ----------------------- UPDATE MINT CONFIG::AUTHORIZED::FIXED::VERIFY --------------------------------
console.log('updating the mint config...');
const updateMintConfigTx = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await token.updateMintConfig(
      new MintConfig({
        publicMint: Bool(false),
        fixedAmountMint: Bool(true),
        rangeMint: Bool(false),
        verifySideLoadedProof: Bool(true),
      })
    );
  }
);
await updateMintConfigTx.prove();
await updateMintConfigTx.sign([alexa.key, admin.privateKey]).send().wait();
console.log(
  updateMintConfigTx.toPretty().length,
  updateMintConfigTx.toPretty()
);

// ----------------------- UPDATE SIDE-LOADED VKEY --------------------------------
console.log('updating the side-loaded vkey...');
const updateVkeyTx = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await token.updateSideLoadedVKeyHash(vKey);
  }
);
await updateVkeyTx.prove();
await updateVkeyTx.sign([alexa.key, admin.privateKey]).send().wait();
console.log(updateVkeyTx.toPretty().length, updateVkeyTx.toPretty());

// ----------------------------- Generate Dynamic Proof -----------------------------------------

const dynamicProof = await generateDynamicProof(token.deriveTokenId(), alexa);

// ----------------------- MINT IN RANGE::AUTHORIZED::ALEXA::VKEY --------------------------------

const alexaBalanceBeforeMint2 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance before mint2:', alexaBalanceBeforeMint2);
equal(alexaBalanceBeforeMint2, 300n);

console.log('Minting new tokens to Alexa.');
const mintTx2 = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await token.mint(alexa, new UInt64(200), dynamicProof, vKey);
  }
);
// console.log(mintTx.toPretty().length, mintTx.toPretty());
await mintTx2.prove();
mintTx2.sign([alexa.key, admin.privateKey]);
const mintTxResult2 = await mintTx2.send().then((v) => v.wait());
console.log(
  'Mint tx result:',
  mintTxResult2.toPretty().length,
  mintTxResult2.toPretty()
);

const alexaBalanceAfterMint2 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after mint2:', alexaBalanceAfterMint2);
equal(alexaBalanceAfterMint2, 500n);

// ----------------------- MINT IN RANGE::AUTHORIZED::ALEXA::VKEY::IGNORE BALANCE/NONCE --------------------------------
const alexaBalanceBeforeMint3 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance before mint3:', alexaBalanceBeforeMint3);
equal(alexaBalanceBeforeMint3, 500n);

console.log('Minting new tokens to Alexa.');
const mintTx3 = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    // the proof is being reused here!
    await token.mint(alexa, new UInt64(200), dynamicProof, vKey);
  }
);
// console.log(mintTx.toPretty().length, mintTx.toPretty());
await mintTx3.prove();
mintTx3.sign([owner.key, admin.privateKey]);
const mintTxResult3 = await mintTx3.send().then((v) => v.wait());
console.log(
  'Mint tx result:',
  mintTxResult3.toPretty().length,
  mintTxResult3.toPretty()
);

const alexaBalanceAfterMint3 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after mint3:', alexaBalanceAfterMint3);
equal(alexaBalanceAfterMint3, 700n);
