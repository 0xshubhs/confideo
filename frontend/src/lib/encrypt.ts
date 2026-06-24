import { getFhevm } from "./fhevm";

export type EncryptedBatch = {
  handles: (Uint8Array | string)[];
  inputProof: Uint8Array | string;
};

/**
 * Encrypt a list of 64-bit amounts as a single batched input bound to (contractAddress, userAddress).
 * Returns the per-amount handles and the single proof, ready to pass to a contract that calls
 * FHE.fromExternal(handle, proof). The handles MUST be consumed by the exact `contractAddress` and the
 * tx MUST be sent by `userAddress`, or the proof check fails.
 */
export async function encryptAmounts(
  contractAddress: string,
  userAddress: string,
  amounts: bigint[],
): Promise<EncryptedBatch> {
  const instance = await getFhevm();
  const input = instance.createEncryptedInput(contractAddress, userAddress);
  for (const a of amounts) input.add64(a);
  const enc = await input.encrypt();
  return { handles: enc.handles, inputProof: enc.inputProof };
}
