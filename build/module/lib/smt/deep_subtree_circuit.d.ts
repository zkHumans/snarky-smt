import { Field, Provable } from 'snarkyjs';
import { Hasher } from '../model';
import { SparseMerkleProof } from './proofs';
export { ProvableDeepSparseMerkleSubTree };
/**
 * ProvableDeepSparseMerkleSubTree is a deep sparse merkle subtree for working on only a few leafs in circuit.
 *
 * @class ProvableDeepSparseMerkleSubTree
 * @template K
 * @template V
 */
declare class ProvableDeepSparseMerkleSubTree<K, V> {
    private nodeStore;
    private valueStore;
    private root;
    private hasher;
    private config;
    private keyType;
    private valueType;
    /**
     * Creates an instance of ProvableDeepSparseMerkleSubTree.
     * @param {Field} root merkle root
     * @param {Provable<K>} keyType
     * @param {Provable<V>} valueType
     * @param {{ hasher: Hasher; hashKey: boolean; hashValue: boolean }} [options={
     *       hasher: Poseidon.hash,
     *       hashKey: true,
     *       hashValue: true,
     *     }]  hasher: The hash function to use, defaults to Poseidon.hash; hashKey:
     * whether to hash the key, the default is true; hashValue: whether to hash the value,
     * the default is true.
     * @memberof ProvableDeepSparseMerkleSubTree
     */
    constructor(root: Field, keyType: Provable<K>, valueType: Provable<V>, options?: {
        hasher: Hasher;
        hashKey: boolean;
        hashValue: boolean;
    });
    /**
     * Get current root.
     *
     * @return {*}  {Field}
     * @memberof ProvableDeepSparseMerkleSubTree
     */
    getRoot(): Field;
    /**
     * Get height of the tree.
     *
     * @return {*}  {number}
     * @memberof ProvableDeepSparseMerkleSubTree
     */
    getHeight(): number;
    private getKeyField;
    private getValueField;
    /**
     * Add a branch to the tree, a branch is generated by smt.prove.
     *
     * @param {SparseMerkleProof} proof
     * @param {K} key
     * @param {V} [value]
     * @memberof ProvableDeepSparseMerkleSubTree
     */
    addBranch(proof: SparseMerkleProof, key: K, value?: V): void;
    /**
     *  Create a merkle proof for a key against the current root.
     *
     * @param {K} key
     * @return {*}  {SparseMerkleProof}
     * @memberof ProvableDeepSparseMerkleSubTree
     */
    prove(key: K): SparseMerkleProof;
    /**
     * Update a new value for a key in the tree and return the new root of the tree.
     *
     * @param {K} key
     * @param {V} [value]
     * @return {*}  {Field}
     * @memberof ProvableDeepSparseMerkleSubTree
     */
    update(key: K, value?: V): Field;
}