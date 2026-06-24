// Singleton FHEVM relayer-SDK instance. initSDK() loads the WASM once; createInstance() wires it to
// the injected wallet using the prebuilt SepoliaConfig (the JS config object — NOT the removed Solidity
// SepoliaConfig contract).
import { initSDK, createInstance, SepoliaConfig, type FhevmInstance } from "@zama-fhe/relayer-sdk/web";

let instancePromise: Promise<FhevmInstance> | null = null;

export async function getFhevm(): Promise<FhevmInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      await initSDK();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error("No injected wallet found (window.ethereum).");
      return createInstance({ ...SepoliaConfig, network: ethereum });
    })().catch((e) => {
      // Allow a later retry if init fails.
      instancePromise = null;
      throw e;
    });
  }
  return instancePromise;
}

export type { FhevmInstance };
