import { Contract, type ContractRunner } from "ethers";
import { REGISTRY_ABI, TOKEN_ABI, INVOICE_ABI } from "../abi";
import { ADDRESSES } from "../config";

export function getContracts(runner: ContractRunner) {
  return {
    registry: new Contract(ADDRESSES.registry, REGISTRY_ABI, runner),
    token: new Contract(ADDRESSES.token, TOKEN_ABI, runner),
    invoiceRegistry: new Contract(ADDRESSES.invoiceRegistry, INVOICE_ABI, runner),
  };
}

/** Translate common wallet/contract errors into a short, human-readable message. */
export function parseError(e: unknown): string {
  const err = e as { shortMessage?: string; reason?: string; info?: { error?: { message?: string } }; message?: string; code?: string | number };
  if (err?.code === "ACTION_REJECTED" || err?.code === 4001) return "Transaction rejected in wallet.";
  return err?.reason || err?.shortMessage || err?.info?.error?.message || err?.message || "Transaction failed.";
}
