import { useState } from "react";
import { useWallet } from "../wallet";
import { ActionButton, Banner, Card, Field, TxLink } from "../components/ui";
import { ADDRESSES } from "../config";
import { getContracts, parseError } from "../lib/contracts";
import { encryptAmounts } from "../lib/encrypt";
import { CUSD_DECIMALS, isAddressLike, parseCusd } from "../lib/format";

export default function CreateInvoicePanel() {
  const { signer, address } = useWallet();
  const [buyer, setBuyer] = useState("");
  const [amount, setAmount] = useState("");
  const [tx, setTx] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const valid =
    isAddressLike(buyer) &&
    !!address &&
    buyer.trim().toLowerCase() !== address.toLowerCase() &&
    amount.trim() !== "" &&
    Number(amount) > 0;

  async function create() {
    if (!signer || !address) return;
    setMsg(null);
    setTx(null);
    setNewId(null);
    try {
      const { invoiceRegistry } = getContracts(signer);
      // Encrypt the intended amount client-side, bound to the registry + the calling supplier.
      const enc = await encryptAmounts(ADDRESSES.invoiceRegistry, address, [parseCusd(amount)]);
      const t = await invoiceRegistry.createInvoice(buyer.trim(), enc.handles[0], enc.inputProof);
      setTx(t.hash);
      const receipt = await t.wait();

      // Recover the new invoice id from the InvoiceCreated event, falling back to a count read.
      let id: string | null = null;
      try {
        for (const log of receipt?.logs ?? []) {
          const parsed = invoiceRegistry.interface.parseLog(log);
          if (parsed?.name === "InvoiceCreated") {
            id = parsed.args[0].toString();
            break;
          }
        }
      } catch {
        /* ignore parse failures, fall back below */
      }
      if (id === null) {
        const count: bigint = await invoiceRegistry.invoiceCount();
        id = (count - 1n).toString();
      }
      setNewId(id);
      setMsg({ kind: "success", text: `Invoice #${id} raised confidentially. The amount never appeared on-chain.` });
    } catch (e) {
      setMsg({ kind: "error", text: parseError(e) });
    }
  }

  return (
    <Card
      title="Raise a confidential invoice"
      subtitle="As a supplier, bill a buyer in cUSD. The amount is encrypted in your browser before it ever touches the chain — only you and the buyer can decrypt it."
    >
      <Field label="Buyer address" hint="The party that will settle this invoice. Must be KYC-attested to pay.">
        <input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="0x…" />
      </Field>
      <Field label="Amount (cUSD)" hint={`6 decimals · ${CUSD_DECIMALS}`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" />
      </Field>

      <div className="inline-actions">
        <ActionButton onClick={create} disabled={!valid} pendingLabel="Encrypting & creating…">
          Create invoice
        </ActionButton>
        {tx && <TxLink hash={tx} />}
        {newId && <span className="pill pill-good">Invoice #{newId}</span>}
      </div>

      {msg && (
        <div style={{ marginTop: 12 }}>
          <Banner kind={msg.kind} onClose={() => setMsg(null)}>
            {msg.text}
          </Banner>
        </div>
      )}

      <p className="help" style={{ marginTop: 14 }}>
        The buyer settles from the “My Invoices” tab. If the settled amount exceeds the disclosure threshold — or the
        buyer is a flagged counterparty — the auditor can decrypt it; otherwise the auditor sees only an encrypted 0.
      </p>
    </Card>
  );
}
