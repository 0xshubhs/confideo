// Chain + contract configuration. Addresses come from `.env` (see .env.example), populated after
// `npx hardhat deploy --network sepolia`.

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
export const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);

export const ADDRESSES = {
  registry: (import.meta.env.VITE_ATTESTATION_REGISTRY ?? "") as string,
  token: (import.meta.env.VITE_TOKEN ?? "") as string,
  invoiceRegistry: (import.meta.env.VITE_INVOICE_REGISTRY ?? "") as string,
};

export function addressesConfigured(): boolean {
  const ok = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a) && a !== "0x0000000000000000000000000000000000000000";
  return ok(ADDRESSES.registry) && ok(ADDRESSES.token) && ok(ADDRESSES.invoiceRegistry);
}

// Used to add Sepolia to the wallet if missing.
export const SEPOLIA_PARAMS = {
  chainId: "0xaa36a7",
  chainName: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

export const EXPLORER = "https://sepolia.etherscan.io";
