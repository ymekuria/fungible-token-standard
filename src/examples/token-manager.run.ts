import {
  Mina,
  PrivateKey,
  AccountUpdate,
  UInt64,
  Bytes,
  VerificationKey,
  UInt8,
  Hash,
} from 'o1js';
import { FungibleToken, VKeyMerkleMap } from '../NewTokenStandard.js';
import {
  EcdsaAndKeccakProgram,
  TokenManager,
  EcdsaAndKeccakProgramPublicInput,
  Secp256k1,
  Ecdsa,
} from './token-manager.new.js';
import { generateDummyDynamicProof } from '../side-loaded/program.eg.js';
import {
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
  TransferDynamicProofConfig,
  UpdatesDynamicProofConfig,
  MintConfig,
  MintParams,
  BurnConfig,
  BurnParams,
} from '../configs.js';
import { equal } from 'node:assert';

const proofsEnabled = false;

const localChain = await Mina.LocalBlockchain({
  proofsEnabled,
  enforceTransactionLimits: false,
});
Mina.setActiveInstance(localChain);
const fee = 1e8;

const [deployer, alexa] = localChain.testAccounts;
const fungibleTokenKeypair = PrivateKey.randomKeypair();
const tokenManagerKeypair = PrivateKey.randomKeypair();
const fungibleTokenAddress = fungibleTokenKeypair.publicKey;
const tokenManagerAddress = tokenManagerKeypair.publicKey;

const vKeyMap = new VKeyMerkleMap();
const dummyVKey = await VerificationKey.dummy();

console.log('---- Addresses ----');
console.log('Deployer:', deployer.toBase58());
console.log('Alexa:', alexa.toBase58());
console.log('FungibleToken Contract:', fungibleTokenAddress.toBase58());
console.log('TokenManager Contract:', tokenManagerAddress.toBase58());

console.log('\n---- Compiling Contracts & ZkPrograms ----');
await EcdsaAndKeccakProgram.compile();
await FungibleToken.compile();
await TokenManager.compile();
console.log('Compilation complete.');

console.log('\n---- Deploying FungibleToken Contract ----');
const fungibleToken = new FungibleToken(fungibleTokenAddress);

const deployFtTx = await Mina.transaction(
  { sender: deployer, fee },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 2);
    await fungibleToken.deploy({
      symbol: 'TKN',
      src: 'https://github.com/o1-labs-XT/fungible-token-standard/blob/main/src/NewTokenStandard.ts',
    });
    await fungibleToken.initialize(
      tokenManagerAddress,
      UInt8.from(9),
      MintConfig.default,
      new MintParams({
        fixedAmount: UInt64.from(100),
        minAmount: UInt64.from(20),
        maxAmount: UInt64.MAXINT(),
      }),
      BurnConfig.default,
      new BurnParams({
        fixedAmount: UInt64.from(100),
        minAmount: UInt64.from(20),
        maxAmount: UInt64.MAXINT(),
      }),
      MintDynamicProofConfig.default,
      BurnDynamicProofConfig.default,
      TransferDynamicProofConfig.default,
      UpdatesDynamicProofConfig.default
    );
  }
);
deployFtTx.sign([deployer.key, fungibleTokenKeypair.privateKey]);
await deployFtTx.prove();
await deployFtTx.send();
console.log(
  'FungibleToken deployed and initialized with TokenManager as admin.'
);

const dummyFtProof = await generateDummyDynamicProof(
  fungibleToken.deriveTokenId(),
  deployer
);
console.log('Dummy FT SideloadedProof generated.');

console.log('\n---- Deploying TokenManager Contract ----');
const tokenManager = new TokenManager(tokenManagerAddress);
const deployTmTx = await Mina.transaction(
  { sender: deployer, fee },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 1);
    await tokenManager.deploy({ tokenAddress: fungibleTokenAddress });
  }
);
deployTmTx.sign([deployer.key, tokenManagerKeypair.privateKey]);
await deployTmTx.prove();
await deployTmTx.send();
console.log('TokenManager deployed.');

const ftAdminAfterInit = fungibleToken.admin.getAndRequireEquals();
equal(
  ftAdminAfterInit.toBase58(),
  tokenManagerAddress.toBase58(),
  'TokenManager was not set as admin during FT initialization.'
);

console.log('\n---- Act 1: Initial Mint to TokenManager by Deployer ----');
const initialMintAmountToTm = UInt64.MAXINT();
let tmBalanceBeforeMint = await fungibleToken.getBalanceOf(tokenManagerAddress);
console.log(
  `TokenManager balance before mint: ${tmBalanceBeforeMint.toBigInt()}`
);

const initialMintTx = await Mina.transaction(
  { sender: deployer, fee },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 1);
    await fungibleToken.mint(
      tokenManagerAddress,
      initialMintAmountToTm,
      dummyFtProof,
      dummyVKey,
      vKeyMap
    );
  }
);
initialMintTx.sign([deployer.key, tokenManagerKeypair.privateKey]);
await initialMintTx.prove();
await initialMintTx.send();
console.log('Initial mint transaction sent.');

let tmBalanceAfterMint = await fungibleToken.getBalanceOf(tokenManagerAddress);
console.log(
  `TokenManager balance after mint: ${tmBalanceAfterMint.toBigInt()}`
);
equal(
  tmBalanceAfterMint.toBigInt(),
  tmBalanceBeforeMint.toBigInt() + initialMintAmountToTm.toBigInt(),
  'TokenManager balance after mint is incorrect.'
);

console.log('\n---- Act 2: Alexa Withdraws Tokens from TokenManager ----');
const alexaSecp256k1PrivateKey = Secp256k1.Scalar.random();
const alexaSecp256k1PublicKey = Secp256k1.generator.scale(
  alexaSecp256k1PrivateKey
);
const withdrawalAmount = UInt64.from(500);

const ecdsaMessageString = 'Hello World!';
const ecdsaMessageForSigning = Bytes(32).fromString(ecdsaMessageString);

const alexaEcdsaSignature = Ecdsa.sign(
  ecdsaMessageForSigning.toBytes(),
  alexaSecp256k1PrivateKey.toBigInt()
);
console.log('Alexa ECDSA inputs prepared.');

const keccakPreimageString = 'Alice and Bob...';
const keccakPreimage = Bytes(32).fromString(keccakPreimageString);
const expectedKeccakHash = Hash.Keccak256.hash(keccakPreimage);
console.log('Alexa Keccak inputs prepared.');

const combinedProofPublicInput = new EcdsaAndKeccakProgramPublicInput({
  signature: alexaEcdsaSignature,
  publicKey: alexaSecp256k1PublicKey,
  message: ecdsaMessageForSigning,
  expectedKeccakHash: expectedKeccakHash,
});

const ecdsaAndKeccakVerificationResult =
  await EcdsaAndKeccakProgram.verifyEcdsaAndKeccak(
    combinedProofPublicInput,
    keccakPreimage
  );
const alexaCombinedProof = ecdsaAndKeccakVerificationResult.proof;
console.log('Alexa Combined ECDSA and Keccak Proof generated for withdrawal.');

let initialAlexaBalance = await fungibleToken.getBalanceOf(alexa);
console.log(
  `Initial Alexa balance before withdrawal: ${initialAlexaBalance.toBigInt()}`
);
let tmBalanceBeforeWithdraw = await fungibleToken.getBalanceOf(
  tokenManagerAddress
);
console.log(
  `TokenManager balance before Alexa withdraws: ${tmBalanceBeforeWithdraw.toBigInt()}`
);

const withdrawTx = await Mina.transaction({ sender: alexa, fee }, async () => {
  AccountUpdate.fundNewAccount(alexa);
  await tokenManager.withdrawTokens(
    withdrawalAmount,
    alexaCombinedProof,
    dummyFtProof,
    dummyVKey,
    vKeyMap
  );
});
withdrawTx.sign([alexa.key, tokenManagerKeypair.privateKey]);
await withdrawTx.prove();
await withdrawTx.send();
console.log('Withdrawal transaction sent.');

let finalAlexaBalance = await fungibleToken.getBalanceOf(alexa);
console.log(
  `Final Alexa balance after withdrawal: ${finalAlexaBalance.toBigInt()}`
);
let finalTmBalance = await fungibleToken.getBalanceOf(tokenManagerAddress);
console.log(
  `TokenManager balance after Alexa withdraws: ${finalTmBalance.toBigInt()}`
);

equal(
  finalAlexaBalance.toBigInt(),
  initialAlexaBalance.toBigInt() + withdrawalAmount.toBigInt(),
  'Alexa balance after withdrawal is incorrect.'
);
equal(
  finalTmBalance.toBigInt(),
  tmBalanceBeforeWithdraw.toBigInt() - withdrawalAmount.toBigInt(),
  'TokenManager balance after withdrawal is incorrect.'
);
