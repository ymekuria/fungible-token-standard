import {
  ZkProgram,
  Field,
  DynamicProof,
  Struct,
  AccountUpdate,
  PublicKey,
  UInt64,
} from 'o1js';

export { program, ProgramProof, SideloadedProof, PublicInputs, PublicOutputs };

class PublicInputs extends Struct({
  tokenId: Field,
  address: PublicKey,
}) {}

class PublicOutputs extends Struct({
  minaAccountData: AccountUpdate,
  tokenIdAccountData: AccountUpdate,
  minaBalance: UInt64,
  tokenIdBalance: UInt64,
}) {}

const program = ZkProgram({
  name: 'approve-mint',
  publicInput: PublicInputs,
  publicOutput: PublicOutputs,
  methods: {
    approveMint: {
      privateInputs: [],
      async method(publicInputs: PublicInputs) {
        const { tokenId, address } = publicInputs;

        const minaAccountData = AccountUpdate.default(address);
        const tokenIdAccountData = AccountUpdate.default(address, tokenId);

        const minaBalance = minaAccountData.account.balance.get();
        minaBalance.assertGreaterThan(UInt64.from(100 * 1e9));

        const tokenIdBalance = tokenIdAccountData.account.balance.get();
        tokenIdBalance.assertGreaterThanOrEqual(UInt64.from(150));

        return {
          publicOutput: new PublicOutputs({
            minaAccountData,
            tokenIdAccountData,
            minaBalance,
            tokenIdBalance,
          }),
        };
      },
    },
  },
});

class ProgramProof extends ZkProgram.Proof(program) {}

class SideloadedProof extends DynamicProof<PublicInputs, PublicOutputs> {
  static publicInputType = PublicInputs;
  static publicOutputType = PublicOutputs;
  static maxProofsVerified = 0 as const;
}

// ---------------------- UTILS ----------------------------

export async function generateDynamicProof(tokenId: Field, address: PublicKey) {
  const publicInputs = new PublicInputs({
    tokenId,
    address,
  });

  const proof = (await program.approveMint(publicInputs)).proof;
  const dynamicProof = SideloadedProof.fromProof(proof);

  return dynamicProof;
}

export async function generateDummyDynamicProof(
  tokenId: Field,
  address: PublicKey
) {
  const publicInputs = new PublicInputs({
    tokenId,
    address,
  });
  const publicOutputs = new PublicOutputs({
    minaAccountData: AccountUpdate.dummy(),
    tokenIdAccountData: AccountUpdate.dummy(),
    minaBalance: UInt64.from(0),
    tokenIdBalance: UInt64.from(0),
  });

  let dummyProof = await program.Proof.dummy(publicInputs, publicOutputs, 0);
  const dynamicDummyProof = SideloadedProof.fromProof(dummyProof);

  return dynamicDummyProof;
}
