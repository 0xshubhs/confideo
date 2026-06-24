import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CHAIN_ID, SEPOLIA_PARAMS } from "./config";
import { resetDecryptAuth } from "./lib/decrypt";

type WalletState = {
  address: string | null;
  chainId: number | null;
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  connecting: boolean;
  error: string | null;
  hasWallet: boolean;
  rightNetwork: boolean;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
};

const Ctx = createContext<WalletState | null>(null);

function getEth(): (Eip1193Provider & { on?: (e: string, cb: () => void) => void; removeListener?: (e: string, cb: () => void) => void }) | undefined {
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum as never;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const eth = getEth();
    if (!eth) return;
    const p = new BrowserProvider(eth);
    const net = await p.getNetwork();
    setProvider(p);
    setChainId(Number(net.chainId));
    const accounts = await p.listAccounts();
    if (accounts.length) {
      const s = await p.getSigner();
      setSigner(s);
      setAddress(await s.getAddress());
    } else {
      setSigner(null);
      setAddress(null);
    }
  }, []);

  const connect = useCallback(async () => {
    const eth = getEth();
    if (!eth) {
      setError("No wallet found. Install MetaMask to use Confideo.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await eth.request({ method: "eth_requestAccounts" });
      await refresh();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Failed to connect wallet.");
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const switchNetwork = useCallback(async () => {
    const eth = getEth();
    if (!eth) return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_PARAMS.chainId }] });
    } catch (e) {
      if ((e as { code?: number })?.code === 4902) {
        await eth.request({ method: "wallet_addEthereumChain", params: [SEPOLIA_PARAMS] });
      }
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const eth = getEth();
    if (!eth?.on) return;
    const onChange = () => {
      resetDecryptAuth();
      refresh();
    };
    eth.on("accountsChanged", onChange);
    eth.on("chainChanged", onChange);
    return () => {
      eth.removeListener?.("accountsChanged", onChange);
      eth.removeListener?.("chainChanged", onChange);
    };
  }, [refresh]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId,
      provider,
      signer,
      connecting,
      error,
      hasWallet: !!getEth(),
      rightNetwork: chainId === CHAIN_ID,
      connect,
      switchNetwork,
    }),
    [address, chainId, provider, signer, connecting, error, connect, switchNetwork],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used within WalletProvider");
  return c;
}
