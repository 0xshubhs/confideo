import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../wallet";
import { ActionButton, AddressTag, Banner, Card, Pill, Reveal } from "../components/ui";
import { ADDRESSES } from "../config";
import { getContracts, parseError } from "../lib/contracts";
import { decryptHandle } from "../lib/decrypt";
import { formatCusd } from "../lib/format";

type Invoice = {
  id: bigint;
  supplier: string;
  buyer: string;
  amount: string; // bytes32 handle
  paid: boolean;
  createdAt: number;
  paidAt: number;
};

// A far-future operator deadline (one year out) for the ERC-7984 operator grant.
const FAR_FUTURE = () => Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

export default function MyInvoicesPanel() {
  const { signer, address } = useWallet();
  const [items, setItems] = useState<Invoice[] | null>(null);
  const [isOperator, setIsOperator] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!signer || !address) return;
    setErr(null);
    try {
      const { invoiceRegistry, token } = getContracts(signer);
      const [asSupplier, asBuyer, op] = await Promise.all([
        invoiceRegistry.invoicesOfSupplier(address) as Promise<bigint[]>,
        invoiceRegistry.invoicesOfBuyer(address) as Promise<bigint[]>,
        token.isOperator(address, ADDRESSES.invoiceRegistry) as Promise<boolean>,
      ]);
      setIsOperator(op);

      // Dedupe ids across supplier + buyer roles.
      const seen = new Set<string>();
      const ids: bigint[] = [];
      for (const id of [...asSupplier, ...asBuyer]) {
        const k = id.toString();
        if (!seen.has(k)) {
          seen.add(k);
          ids.push(id);
        }
      }
      ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      const out: Invoice[] = [];
      for (const id of ids) {
        const inv = await invoiceRegistry.getInvoice(id);
        out.push({
          id,
          supplier: inv.supplier,
          buyer: inv.buyer,
          amount: inv.amount,
          paid: inv.paid,
          createdAt: Number(inv.createdAt),
          paidAt: Number(inv.paidAt),
        });
      }
      setItems(out);
    } catch (e) {
      setErr(parseError(e));
    }
  }, [signer, address]);

  useEffect(() => {
    load();
  }, [load]);

  const me = address?.toLowerCase() ?? "";

  return (
    <Card
      title="My invoices"
      subtitle="Invoices you raised as a supplier or owe as a buyer. Decrypt any amount — only the supplier and buyer can. Settle the ones you owe right here."
    >
      {err && <Banner kind="error">{err}</Banner>}
      {msg && (
        <Banner kind={msg.kind} onClose={() => setMsg(null)}>
          {msg.text}
        </Banner>
      )}
      {!items && <p className="muted">Loading…</p>}
      {items && items.length === 0 && <p className="muted">No invoices involving your address yet.</p>}

      {items?.map((inv) => {
        const iAmBuyer = inv.buyer.toLowerCase() === me;
        const iAmSupplier = inv.supplier.toLowerCase() === me;
        return (
          <div className="row" key={inv.id.toString()}>
            <div className="row-main">
              <span>
                Invoice #{inv.id.toString()} {iAmSupplier ? <Pill>you supply</Pill> : <Pill>you buy</Pill>}{" "}
                {inv.paid ? <Pill tone="good">Paid</Pill> : <Pill tone="warn">Unpaid</Pill>}
              </span>
              <span className="muted">
                supplier <AddressTag value={inv.supplier} /> → buyer <AddressTag value={inv.buyer} />
              </span>
              <span className="muted">
                created {new Date(inv.createdAt * 1000).toLocaleString()}
                {inv.paid && inv.paidAt ? ` · paid ${new Date(inv.paidAt * 1000).toLocaleString()}` : ""}
              </span>
            </div>

            <div className="inline-actions" style={{ flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <Reveal
                hiddenLabel="•••••• cUSD"
                load={async () =>
                  formatCusd(
                    await decryptHandle(inv.amount, ADDRESSES.invoiceRegistry, signer!, [
                      ADDRESSES.invoiceRegistry,
                      ADDRESSES.token,
                    ]),
                  )
                }
              />

              {/* Four-state pay flow — only for the buyer of an unpaid invoice, in the same slot. */}
              {!inv.paid && iAmBuyer && (
                isOperator ? (
                  <ActionButton
                    pendingLabel="Settling…"
                    onClick={async () => {
                      if (!signer) return;
                      setMsg(null);
                      try {
                        const { invoiceRegistry } = getContracts(signer);
                        await (await invoiceRegistry.payInvoice(inv.id)).wait();
                        setMsg({ kind: "success", text: `Invoice #${inv.id.toString()} settled confidentially.` });
                        await load();
                      } catch (e) {
                        setMsg({ kind: "error", text: parseError(e) });
                      }
                    }}
                  >
                    Pay invoice
                  </ActionButton>
                ) : (
                  <ActionButton
                    variant="ghost"
                    pendingLabel="Approving…"
                    onClick={async () => {
                      if (!signer) return;
                      setMsg(null);
                      try {
                        const { token } = getContracts(signer);
                        await (await token.setOperator(ADDRESSES.invoiceRegistry, FAR_FUTURE())).wait();
                        setIsOperator(true);
                        setMsg({ kind: "success", text: "Registry approved as operator. You can now pay." });
                      } catch (e) {
                        setMsg({ kind: "error", text: parseError(e) });
                      }
                    }}
                  >
                    Approve registry to settle
                  </ActionButton>
                )
              )}
            </div>
          </div>
        );
      })}

      <p className="help" style={{ marginTop: 12 }}>
        Connected as <AddressTag value={address ?? ""} />. Paying first authorizes this registry as a token operator (a
        one-time approval), then pulls confidential cUSD from you to the supplier. Decryption requires a one-time EIP-712
        signature authorizing the relayer for this session.
      </p>
    </Card>
  );
}
