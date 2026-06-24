import { formatUnits, parseUnits } from "ethers";

export const CUSD_DECIMALS = 6;

/** Format base units (6-decimal) as a human-readable cUSD string. cUSD is pegged to USD, so this is also the ~USD value. */
export function formatCusd(base: bigint): string {
  const n = Number(formatUnits(base, CUSD_DECIMALS));
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) + " cUSD";
}

/** Parse a user-entered decimal cUSD amount into 6-decimal base units. Throws on invalid input. */
export function parseCusd(value: string): bigint {
  return parseUnits(value.trim(), CUSD_DECIMALS);
}

export function shortAddr(a?: string | null): string {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function isAddressLike(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}
