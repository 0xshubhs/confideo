// Chain + contract configuration. Addresses come from `.env` (see .env.example), populated after
// `npx hardhat deploy --network sepolia`.

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
export const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);

// Deployed on Ethereum Sepolia (wired in code — no .env required; env still overrides if set).
export const ADDRESSES = {
  registry: (import.meta.env.VITE_ATTESTATION_REGISTRY ?? "0x1E5A8cD2008a9b28d846Db5020ba7370BB851b31") as string,
  token: (import.meta.env.VITE_TOKEN ?? "0x41414A6A89f0c0b175998128327daFa045277073") as string,
  invoiceRegistry: (import.meta.env.VITE_INVOICE_REGISTRY ?? "0x0Aef183AbBF6c8b4fb1761D0b1F49F6cAbF94f76") as string,
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
