/*
Description: 
This example describes how developers can use Merkle Trees as a basic off-chain storage tool.
zkApps on Mina can only store a small amount of data on-chain, but many use cases require your application to at least reference big amounts of data.
Merkle Trees give developers the power of storing large amounts of data off-chain, but proving its integrity to the on-chain smart contract!
! Unfamiliar with Merkle Trees? No problem! Check out https://blog.ethereum.org/2015/11/15/merkling-in-ethereum/
*/

import {
  SmartContract,
  isReady,
  shutdown,
  Poseidon,
  Field,
  Experimental,
  Permissions,
  DeployArgs,
  State,
  state,
  Circuit,
  CircuitValue,
  PublicKey,
  UInt64,
  prop,
  Mina,
  method,
  UInt32,
  PrivateKey,
  Party,
  CircuitString,
} from 'snarkyjs';
import { SMT_EMPTY_VALUE } from '../lib/constant';
import { SparseMerkleProof } from '../lib/proofs';
import { SparseMerkleTree } from '../lib/smt';
import { MemoryStore } from '../lib/store/memory_store';
import { createEmptyValue } from '../lib/utils';
import {
  computeRootByFieldInCircuit,
  verifyProofByFieldInCircuit,
  verifyProofInCircuit,
} from '../lib/verify_circuit';

await isReady;

const doProofs = true;

class Account extends CircuitValue {
  @prop publicKey: PublicKey;
  @prop points: UInt32;

  constructor(publicKey: PublicKey, points: UInt32) {
    super(publicKey, points);
    this.publicKey = publicKey;
    this.points = points;
  }

  hash(): Field {
    return Poseidon.hash(this.toFields());
  }

  addPoints(n: number): Account {
    return new Account(this.publicKey, this.points.add(n));
  }
}

// we need the initiate tree root in order to tell the contract about our off-chain storage
let initialCommitment: Field = Field.zero;
/*
    We want to write a smart contract that serves as a leaderboard,
    but only has the commitment of the off-chain storage stored in an on-chain variable.
    The accounts of all participants will be stored off-chain!
    If a participant can guess the preimage of a hash, they will be granted one point :)
  */

class Leaderboard extends SmartContract {
  // a commitment is a cryptographic primitive that allows us to commit to data, with the ability to "reveal" it later
  @state(Field) commitment = State<Field>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
    this.balance.addInPlace(UInt64.fromNumber(initialBalance));
    this.commitment.set(initialCommitment);
  }

  // If an account with this name does not exist, it is added as a new account (non-existence merkle proof)
  @method
  addNewAccount(
    name: CircuitString,
    account: Account,
    merkleProof: SparseMerkleProof
  ) {
    // we fetch the on-chain commitment
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    // We need to prove that the account is not in Merkle Tree.
    // Or you can use generic methods
    // const emptyAccount = createEmptyValue(Account);
    // verifyProofInCircuit<CircuitString, Account>(
    //   merkleProof,
    //   commitment,
    //   name,
    //   emptyAccount,
    //   Account
    // ).assertTrue();
    const keyHash = Poseidon.hash(name.toFields());
    const emptyHash = SMT_EMPTY_VALUE;
    verifyProofByFieldInCircuit(
      merkleProof,
      commitment,
      keyHash,
      emptyHash
    ).assertTrue();

    // add new account
    let newCommitment = computeRootByFieldInCircuit(
      merkleProof.sideNodes,
      keyHash,
      account.hash()
    );
    this.commitment.set(newCommitment);
  }

  // existence merkle proof
  @method
  guessPreimage(
    guess: Field,
    name: CircuitString,
    account: Account,
    merkleProof: SparseMerkleProof
  ) {
    // this is our hash! its the hash of the preimage "22", but keep it a secret!
    let target = Field(
      '17057234437185175411792943285768571642343179330449434169483610110583519635705'
    );
    // if our guess preimage hashes to our target, we won a point!
    Poseidon.hash([guess]).assertEquals(target);

    // we fetch the on-chain commitment
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    // we check that the account is within the committed Merkle Tree
    // Or you can use generic methods
    // verifyProofInCircuit<CircuitString, Account>(
    //     merkleProof,
    //     commitment,
    //     name,
    //     account,
    //     Account
    //   ).assertTrue();
    const keyHash = Poseidon.hash(name.toFields());
    const valueHash = account.hash();
    verifyProofByFieldInCircuit(
      merkleProof,
      commitment,
      keyHash,
      valueHash
    ).assertTrue();

    // we update the account and grant one point!
    let newAccount = account.addPoints(1);

    // we calculate the new Merkle Root, based on the account changes
    // Or you can use generic methods
    // let newCommitment = computeRootInCircuit<CircuitString, Account>(
    //     merkleProof.sideNodes,
    //     name,
    //     newAccount,
    //     Account
    //   );
    let newCommitment = computeRootByFieldInCircuit(
      merkleProof.sideNodes,
      keyHash,
      newAccount.hash()
    );

    this.commitment.set(newCommitment);
  }
}

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
let initialBalance = 10_000_000_000;

let feePayer = Local.testAccounts[0].privateKey;

// the zkapp account
let zkappKey = PrivateKey.random();
let zkappAddress = zkappKey.toPublicKey();

let store = new MemoryStore<Account>();
let smt = await SparseMerkleTree.buildNewTree<CircuitString, Account>(store);

const Bob = CircuitString.fromString('Bob');
const Alice = CircuitString.fromString('Alice');
const Charlie = CircuitString.fromString('Charlie');
const Olivia = CircuitString.fromString('Olivia');

let bobAc = new Account(Local.testAccounts[0].publicKey, UInt32.from(0));
let aliceAc = new Account(Local.testAccounts[1].publicKey, UInt32.from(0));
let charlieAc = new Account(Local.testAccounts[2].publicKey, UInt32.from(0));
let oliviaAc = new Account(Local.testAccounts[3].publicKey, UInt32.from(2));

await smt.update(Bob, bobAc);
await smt.update(Alice, aliceAc);
await smt.update(Charlie, charlieAc);

// now that we got our accounts set up, we need the commitment to deploy our contract!
initialCommitment = smt.getRoot();

let leaderboardZkApp = new Leaderboard(zkappAddress);
console.log('Deploying leaderboard..');
if (doProofs) {
  await Leaderboard.compile(zkappAddress);
}
let tx = await Mina.transaction(feePayer, () => {
  Party.fundNewAccount(feePayer, { initialBalance });
  leaderboardZkApp.deploy({ zkappKey });
});
tx.send();

console.log('Initial points: ' + (await smt.get(Bob))?.points);

console.log('Making guess..');
await makeGuess(Bob, 22);

console.log('Final points: ' + (await smt.get(Bob))?.points);

await addNewAccount(Olivia, oliviaAc);

console.log('Final Olivia points: ' + (await smt.get(Olivia))?.points);

shutdown();

async function addNewAccount(name: CircuitString, account: Account) {
  let merkleProof = await smt.prove(name);

  let tx = await Mina.transaction(feePayer, () => {
    leaderboardZkApp.addNewAccount(name, account, merkleProof);
    if (!doProofs) leaderboardZkApp.sign(zkappKey);
  });
  if (doProofs) {
    await tx.prove();
  }
  tx.send();

  await smt.update(name, account!);
  leaderboardZkApp.commitment.get().assertEquals(smt.getRoot());
}

async function makeGuess(name: CircuitString, guess: number) {
  let account = await smt.get(name);

  let merkleProof = await smt.prove(name);

  let tx = await Mina.transaction(feePayer, () => {
    leaderboardZkApp.guessPreimage(Field(guess), name, account!, merkleProof);
    if (!doProofs) leaderboardZkApp.sign(zkappKey);
  });
  if (doProofs) {
    await tx.prove();
  }
  tx.send();

  // if the transaction was successful, we can update our off-chain storage as well
  account!.points = account!.points.add(1);
  await smt.update(name, account!);
  leaderboardZkApp.commitment.get().assertEquals(smt.getRoot());
}