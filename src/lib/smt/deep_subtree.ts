import { Field, Poseidon } from 'snarkyjs';
import { EMPTY_VALUE, SMT_DEPTH } from '../constant';
import { FieldElements, Hasher } from '../model';
import { SparseMerkleProof } from './proofs';

export { DeepSparseMerkleSubTree };

class DeepSparseMerkleSubTree<
  K extends FieldElements,
  V extends FieldElements
> {
  private nodeStore: Map<string, Field[]>;
  private valueStore: Map<string, Field>;
  private root: Field;
  private hasher: Hasher;
  private config: { hashKey: boolean; hashValue: boolean };

  constructor(
    root: Field,
    options: { hasher: Hasher; hashKey: boolean; hashValue: boolean } = {
      hasher: Poseidon.hash,
      hashKey: true,
      hashValue: true,
    }
  ) {
    this.root = root;
    this.nodeStore = new Map<string, Field[]>();
    this.valueStore = new Map<string, Field>();
    this.hasher = options.hasher;
    this.config = { hashKey: options.hashKey, hashValue: options.hashValue };
  }

  public getRoot(): Field {
    return this.root;
  }

  public getHeight(): number {
    return SMT_DEPTH;
  }

  private getKeyField(key: K): Field {
    let keyFields = key.toFields();
    let keyHashOrKeyField = keyFields[0];
    if (this.config.hashKey) {
      keyHashOrKeyField = this.hasher(keyFields);
    }

    return keyHashOrKeyField;
  }

  private getValueField(value?: V): Field {
    let valueHashOrValueField = EMPTY_VALUE;
    if (value) {
      let valueFields = value.toFields();
      valueHashOrValueField = valueFields[0];
      if (this.config.hashValue) {
        valueHashOrValueField = this.hasher(valueFields);
      }
    }
    return valueHashOrValueField;
  }

  public has(key: K, value: V): boolean {
    const keyField = this.getKeyField(key);
    const valueField = this.getValueField(value);
    let v = this.valueStore.get(keyField.toString());
    if (v === undefined || !v.equals(valueField).toBoolean()) {
      return false;
    }

    return true;
  }

  public addBranch(
    proof: SparseMerkleProof,
    key: K,
    value?: V,
    ignoreInvalidProof: boolean = false
  ) {
    const keyField = this.getKeyField(key);
    const valueField = this.getValueField(value);
    let { ok, updates } = verifyProofWithUpdates(
      proof,
      this.root,
      keyField,
      valueField,
      this.hasher
    );

    if (!ok) {
      if (!ignoreInvalidProof) {
        throw new Error(
          `invalid proof, keyField: ${keyField.toString()}, valueField: ${valueField.toString()}`
        );
      } else {
        return;
      }
    }

    for (let i = 0, len = updates.length; i < len; i++) {
      let v = updates[i];
      this.nodeStore.set(v[0].toString(), v[1]);
    }

    this.valueStore.set(keyField.toString(), valueField);
  }

  public prove(key: K): SparseMerkleProof {
    const path = this.getKeyField(key);
    let pathStr = path.toString();
    let valueHash = this.valueStore.get(pathStr);
    if (valueHash === undefined) {
      throw new Error(
        `The DeepSubTree does not contain a branch of the path: ${pathStr}`
      );
    }
    let treeHeight = this.getHeight();
    const pathBits = path.toBits(treeHeight);
    let sideNodes: Field[] = [];
    let nodeHash: Field = this.root;
    for (let i = 0; i < treeHeight; i++) {
      const currentValue = this.nodeStore.get(nodeHash.toString());
      if (currentValue === undefined) {
        throw new Error(
          'Make sure you have added the correct proof, key and value using the addBranch method'
        );
      }

      if (pathBits[i].toBoolean()) {
        sideNodes.push(currentValue[0]);
        nodeHash = currentValue[1];
      } else {
        sideNodes.push(currentValue[1]);
        nodeHash = currentValue[0];
      }
    }

    return new SparseMerkleProof(sideNodes, this.root);
  }

  public update(key: K, value?: V): Field {
    const path = this.getKeyField(key);
    const valueField = this.getValueField(value);

    const treeHeight = this.getHeight();
    const pathBits = path.toBits(treeHeight);

    let sideNodes: Field[] = [];
    let nodeHash: Field = this.root;

    for (let i = 0; i < treeHeight; i++) {
      const currentValue = this.nodeStore.get(nodeHash.toString());
      if (currentValue === undefined) {
        throw new Error(
          'Make sure you have added the correct proof, key and value using the addBranch method'
        );
      }

      if (pathBits[i].toBoolean()) {
        sideNodes.push(currentValue[0]);
        nodeHash = currentValue[1];
      } else {
        sideNodes.push(currentValue[1]);
        nodeHash = currentValue[0];
      }
    }

    let currentHash = valueField;
    this.nodeStore.set(currentHash.toString(), [currentHash]);

    for (let i = this.getHeight() - 1; i >= 0; i--) {
      let sideNode = sideNodes[i];

      let currentValue: Field[] = [];
      if (pathBits[i].toBoolean()) {
        currentValue = [sideNode, currentHash];
      } else {
        currentValue = [currentHash, sideNode];
      }
      currentHash = this.hasher(currentValue);

      this.nodeStore.set(currentHash.toString(), currentValue);
    }

    this.valueStore.set(path.toString(), valueField);
    this.root = currentHash;

    return this.root;
  }
}

function verifyProofWithUpdates(
  proof: SparseMerkleProof,
  expectedRoot: Field,
  keyHashOrKeyField: Field,
  valueHashOrValueField: Field,
  hasher: Hasher = Poseidon.hash
): { ok: boolean; updates: [Field, Field[]][] } {
  if (!proof.root.equals(expectedRoot).toBoolean()) {
    return { ok: false, updates: [] };
  }

  const { actualRoot, updates } = computeRoot(
    proof.sideNodes,
    keyHashOrKeyField,
    valueHashOrValueField,
    hasher
  );

  return { ok: actualRoot.equals(expectedRoot).toBoolean(), updates };
}

function computeRoot(
  sideNodes: Field[],
  keyHashOrKeyField: Field,
  valueHashOrValueField: Field,
  hasher: Hasher = Poseidon.hash
): { actualRoot: Field; updates: [Field, Field[]][] } {
  let currentHash: Field = valueHashOrValueField;

  const pathBits = keyHashOrKeyField.toBits(SMT_DEPTH);
  let updates: [Field, Field[]][] = [];

  updates.push([currentHash, [currentHash]]);

  for (let i = SMT_DEPTH - 1; i >= 0; i--) {
    let node = sideNodes[i];

    let currentValue: Field[] = [];
    if (pathBits[i].toBoolean()) {
      currentValue = [node, currentHash];
    } else {
      currentValue = [currentHash, node];
    }
    currentHash = hasher(currentValue);

    updates.push([currentHash, currentValue]);
  }
  return { actualRoot: currentHash, updates };
}
