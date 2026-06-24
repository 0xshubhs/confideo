import type { Signer } from "ethers";
import { getFhevm } from "./fhevm";

// A user-decryption authorization is an EIP-712 signature over an ephemeral keypair, valid for a set of
// contracts for `durationDays`. We cache it per (user, contract-set) so the wallet only prompts once per
// session instead of on every decrypt.
type DecryptAuth = {
  user: string;
  contracts: string[];
  privateKey: string;
  publicKey: string;
  signature: string; // 0x-stripped, as userDecrypt expects
  startTimestamp: number;
  durationDays: number;
};

let cached: DecryptAuth | null = null;

function covers(auth: DecryptAuth, user: string, contracts: string[]): boolean {
  return auth.user.toLowerCase() === user.toLowerCase() && contracts.every((c) => auth.contracts.map((x) => x.toLowerCase()).includes(c.toLowerCase()));
}

async function getAuth(signer: Signer, contracts: string[]): Promise<DecryptAuth> {
  const user = await signer.getAddress();
  if (cached && covers(cached, user, contracts)) return cached;

  const instance = await getFhevm();
  const { publicKey, privateKey } = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 365;
  const eip712 = instance.createEIP712(publicKey, contracts, startTimestamp, durationDays);

  // Sign ONLY the UserDecryptRequestVerification type so ethers doesn't re-encode the EIP712Domain.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signature = await signer.signTypedData(
    eip712.domain as any,
    { UserDecryptRequestVerification: (eip712.types as any).UserDecryptRequestVerification } as any,
    eip712.message as any,
  );

  cached = {
    user,
    contracts,
    privateKey,
    publicKey,
    signature: signature.replace(/^0x/, ""),
    startTimestamp,
    durationDays,
  };
  return cached;
}

/** Clears the cached decryption authorization (e.g. on account/network change). */
export function resetDecryptAuth() {
  cached = null;
}

/**
 * Decrypt a single ciphertext handle the connected user is ACL-authorized for.
 * @param handle bytes32 ciphertext handle returned by a contract view.
 * @param contractAddress the contract that holds (allowThis'd) the handle.
 * @param signer the connected wallet (must be FHE-allowed on the handle).
 * @param authContracts all contracts to authorize in one signature (defaults to [contractAddress]).
 */
export async function decryptHandle(
  handle: string,
  contractAddress: string,
  signer: Signer,
  authContracts?: string[],
): Promise<bigint> {
  const instance = await getFhevm();
  const contracts = authContracts && authContracts.length ? authContracts : [contractAddress];
  const auth = await getAuth(signer, contracts);

  const results = await instance.userDecrypt(
    [{ handle, contractAddress }],
    auth.privateKey,
    auth.publicKey,
    auth.signature,
    auth.contracts,
    auth.user,
    auth.startTimestamp,
    auth.durationDays,
  );
  const out = results as unknown as Record<string, string | number | bigint>;
  return BigInt(out[handle]);
}

const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Whether a handle is the uninitialized ciphertext (no value yet). */
export function isUninitialized(handle: string): boolean {
  return !handle || handle === ZERO_HANDLE;
}
