import { useState } from "react";
import { useWallet } from "./wallet";
import { ActionButton, AddressTag, Banner, Card, Pill } from "./components/ui";
import { ADDRESSES, addressesConfigured } from "./config";
import { shortAddr } from "./lib/format";
import CreateInvoicePanel from "./panels/CreateInvoice";
import MyInvoicesPanel from "./panels/MyInvoices";
import AuditorPanel from "./panels/Auditor";
import AdminPanel from "./panels/Admin";

const TABS = [
  { id: "create", label: "Create Invoice", el: <CreateInvoicePanel /> },
  { id: "mine", label: "My Invoices", el: <MyInvoicesPanel /> },
  { id: "auditor", label: "Auditor", el: <AuditorPanel /> },
  { id: "admin", label: "Admin", el: <AdminPanel /> },
];

function Brand() {
  return (
    <div className="brand">
      <img className="brand-logo" src="/favicon.svg" alt="Confideo" />
      <div>
        <div className="brand-name">Confideo</div>
        <div className="brand-tag">Confidential B2B invoices · settle privately, disclose by policy</div>
      </div>
    </div>
  );
}

export default function App() {
  const { address, hasWallet, rightNetwork, connecting, error, connect, switchNetwork } = useWallet();
  const [tab, setTab] = useState(TABS[0].id);

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          {address ? (
            <>
              <Pill tone={rightNetwork ? "good" : "warn"}>{rightNetwork ? "Sepolia" : "Wrong network"}</Pill>
              <Pill>{shortAddr(address)}</Pill>
            </>
          ) : (
            hasWallet && (
              <ActionButton onClick={connect} pendingLabel="Connecting…">
                Connect Wallet
              </ActionButton>
            )
          )}
        </div>
      </header>

      {!addressesConfigured() && (
        <Banner kind="info">
          Contract addresses are not configured. Copy <code>.env.example</code> → <code>.env</code> and set the deployed
          addresses (printed by <code>npx hardhat deploy --network sepolia</code>).
        </Banner>
      )}
      {error && <Banner kind="error">{error}</Banner>}

      {!address ? (
        <Disconnected hasWallet={hasWallet} connecting={connecting} connect={connect} />
      ) : !rightNetwork ? (
        <Card title="Wrong network" subtitle="Confideo runs on Sepolia, where Zama's FHEVM coprocessor lives.">
          <ActionButton onClick={switchNetwork} pendingLabel="Switching…">
            Switch to Sepolia
          </ActionButton>
        </Card>
      ) : (
        <>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={"tab" + (tab === t.id ? " tab-active" : "")} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <ContractBar />
          {TABS.find((t) => t.id === tab)?.el}
        </>
      )}

      <footer className="help" style={{ marginTop: 40, textAlign: "center" }}>
        Invoice amounts are encrypted with Zama FHEVM. Counterparty addresses, the transaction graph, and timing remain
        public on-chain — only the values are private. Built for the Zama confidential-payments track.
      </footer>
    </div>
  );
}

function Disconnected({
  hasWallet,
  connecting,
  connect,
}: {
  hasWallet: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
}) {
  return (
    <div className="hero">
      <h1>
        Invoice confidentially.
        <br />
        Settle privately.
      </h1>
      <p>
        Confideo lets suppliers raise B2B invoices where the amount is encrypted end-to-end. Buyers settle in
        confidential cUSD; an auditor sees the real figure only when policy says so — above a threshold, or for flagged
        counterparties.
      </p>
      {hasWallet ? (
        <ActionButton onClick={connect} pendingLabel="Connecting…">
          <span className="btn-lg">Connect Wallet</span>
        </ActionButton>
      ) : (
        <Banner kind="error">No Ethereum wallet detected. Install MetaMask to continue.</Banner>
      )}
      <div className="hero-points">
        <Card title="Encrypted invoice amounts">
          Amounts are euint64 ciphertexts. Etherscan shows the invoice exists, never what it's worth.
        </Card>
        <Card title="Buyers settle confidentially">
          The buyer approves the registry once, then pays — confidential cUSD moves from buyer to supplier privately.
        </Card>
        <Card title="Auditor auto-disclosure">
          A settled invoice is disclosed to the auditor only above the threshold or for a flagged counterparty —
          otherwise an encrypted 0.
        </Card>
      </div>
    </div>
  );
}

function ContractBar() {
  return (
    <div className="inline-actions" style={{ marginBottom: 16 }}>
      <span className="muted">Contracts:</span>
      <AddressTag value={ADDRESSES.invoiceRegistry} label="Invoices" />
      <AddressTag value={ADDRESSES.token} label="cUSD" />
      <AddressTag value={ADDRESSES.registry} label="Registry" />
    </div>
  );
}
