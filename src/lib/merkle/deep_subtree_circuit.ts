import {
  arrayProp,
  Bool,
  Circuit,
  CircuitValue,
  Field,
  Poseidon,
} from 'snarkyjs';
import { EMPTY_VALUE } from '../constant';
import { FieldElements, Hasher } from '../model';
import { BaseMerkleProof } from './proofs';
import { ProvableMerkleTreeUtils } from './verify_circuit';

export { ProvableDeepMerkleSubTree };

class ProvableDeepMerkleSubTree<V extends FieldElements> {
  private nodeStore: Map<string, Field[]>;
  private valueStore: Map<string, Field>;
  private root: Field;
  private height: number;
  private hasher: Hasher;
  private hashValue: boolean;

  constructor(
    root: Field,
    height: number,
    options: { hasher: Hasher; hashValue: boolean } = {
      hasher: Poseidon.hash,
      hashValue: true,
    }
  ) {
    this.root = root;
    this.nodeStore = new Map<string, Field[]>();
    this.valueStore = new Map<string, Field>();
    this.height = height;
    this.hasher = options.hasher;
    this.hashValue = options.hashValue;
  }

  private getValueField(value?: V): Field {
    let valueHashOrValueField = EMPTY_VALUE;
    if (value) {
      let valueFields = value.toFields();
      valueHashOrValueField = valueFields[0];
      if (this.hashValue) {
        valueHashOrValueField = this.hasher(valueFields);
      }
    }

    return valueHashOrValueField;
  }

  public getRoot(): Field {
    return this.root;
  }

  public getHeight(): number {
    return this.height;
  }

  public addBranch(proof: BaseMerkleProof, index: Field, value?: V) {
    Circuit.asProver(() => {
      const keyField = index;
      const valueField = this.getValueField(value);

      let updates = getUpdatesBySideNodes(
        proof.sideNodes,
        keyField,
        valueField,
        this.height,
        this.hasher
      );

      for (let i = 0, h = updates.length; i < h; i++) {
        let v = updates[i];
        this.nodeStore.set(v[0].toString(), v[1]);
      }

      this.valueStore.set(keyField.toString(), valueField);
    });
  }

  public prove(index: Field): BaseMerkleProof {
    return Circuit.witness(BaseMerkleProof, () => {
      const path = index;
      let pathStr = path.toString();
      let valueHash = this.valueStore.get(pathStr);
      if (valueHash === undefined) {
        throw new Error(
          `The DeepSubTree does not contain a branch of the path: ${pathStr}`
        );
      }
      const pathBits = path.toBits(this.height);
      let sideNodes: Field[] = [];
      let nodeHash: Field = this.root;
      for (let i = 0; i < this.height; i++) {
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

      class MerkleProof_ extends ProvableMerkleTreeUtils.MerkleProof(
        this.height
      ) {}

      return new MerkleProof_(this.root, sideNodes).toConstant();
    });
  }

  public update(index: Field, value?: V): Field {
    const path = index;
    const pathBits = path.toBits(this.height);
    const valueField = this.getValueField(value);

    class SideNodes extends CircuitValue {
      @arrayProp(Field, this.height) arr: Field[];
      constructor(arr: Field[]) {
        super();
        this.arr = arr;
      }
    }

    let fieldArr: SideNodes = Circuit.witness(SideNodes, () => {
      let sideNodes: Field[] = [];
      let nodeHash: Field = this.root;
      for (let i = 0; i < this.height; i++) {
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

      return new SideNodes(sideNodes).toConstant();
    });

    let sideNodes = fieldArr.arr;
    const oldValueHash = Circuit.witness(Field, () => {
      let oldValueHash = this.valueStore.get(path.toString());
      if (oldValueHash === undefined) {
        throw new Error('oldValueHash does not exist');
      }
      return oldValueHash.toConstant();
    });
    impliedRootForHeightInCircuit(
      sideNodes,
      pathBits,
      oldValueHash,
      this.height
    ).assertEquals(this.root);

    let currentHash = valueField;

    Circuit.asProver(() => {
      this.nodeStore.set(currentHash.toString(), [currentHash]);
    });

    for (let i = this.height - 1; i >= 0; i--) {
      let sideNode = sideNodes[i];

      let currentValue = Circuit.if(
        pathBits[i],
        [sideNode, currentHash],
        [currentHash, sideNode]
      );

      currentHash = this.hasher(currentValue);

      Circuit.asProver(() => {
        this.nodeStore.set(currentHash.toString(), currentValue);
      });
    }

    Circuit.asProver(() => {
      this.valueStore.set(path.toString(), valueField);
    });

    this.root = currentHash;

    return this.root;
  }
}

function impliedRootForHeightInCircuit(
  sideNodes: Field[],
  pathBits: Bool[],
  leaf: Field,
  height: number
): Field {
  let impliedRoot = leaf;
  for (let i = height - 1; i >= 0; i--) {
    let sideNode = sideNodes[i];
    let [left, right] = Circuit.if(
      pathBits[i],
      [sideNode, impliedRoot],
      [impliedRoot, sideNode]
    );
    impliedRoot = Poseidon.hash([left, right]);
  }
  return impliedRoot;
}

function getUpdatesBySideNodes(
  sideNodes: Field[],
  keyHashOrKeyField: Field,
  valueHashOrValueField: Field,
  height: number,
  hasher: Hasher = Poseidon.hash
): [Field, Field[]][] {
  let currentHash: Field = valueHashOrValueField;
  let updates: [Field, Field[]][] = [];

  const pathBits = keyHashOrKeyField.toBits(height);
  updates.push([currentHash, [currentHash]]);

  for (let i = height - 1; i >= 0; i--) {
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

  return updates;
}
