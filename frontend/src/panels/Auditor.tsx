import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../wallet";
import { AddressTag, Banner, Card, Pill, Reveal } from "../components/ui";
import { ADDRESSES } from "../config";
import { getContracts, parseError } from "../lib/contracts";
import { decryptHandle, isUninitialized } from "../lib/decrypt";
import { formatCusd } from "../lib/format";

type Entry = {
  id: number;
  supplier: string;
  buyer: string;
  paid: boolean;
  disclosed: string; // bytes32 handle from getAuditorView
};

export default function AuditorPanel() {
  const { signer, address } = useWallet();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [auditor, setAuditor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!signer) return;
    setErr(null);
    try {
      const { invoiceRegistry } = getContracts(signer);
      const [count, aud] = await Promise.all([
        invoiceRegistry.invoiceCount() as Promise<bigint>,
        invoiceRegistry.auditor() as Promise<string>,
      ]);
      setAuditor(aud);
      const total = Number(count);
      const out: Entry[] = [];
      for (let i = total - 1; i >= 0; i--) {
        const inv = await invoiceRegistry.getInvoice(i);
        const disclosed: string = await invoiceRegistry.getAuditorView(i);
        out.push({ id: i, supplier: inv.supplier, buyer: inv.buyer, paid: inv.paid, disclosed });
      }
      setEntries(out);
    } catch (e) {
      setErr(parseError(e));
    }
  }, [signer]);

  useEffect(() => {
    load();
  }, [load]);

  const isAuditor = !!auditor && !!address && auditor.toLowerCase() === address.toLowerCase();
  const auditorSet = !!auditor && auditor !== "0x0000000000000000000000000000000000000000";

  return (
    <Card
      title="Auditor dashboard"
      subtitle="Selective, policy-gated disclosure. A settled invoice decrypts to its real amount only when it exceeded the threshold or the buyer was flagged — otherwise to 0."
    >
      {auditorSet ? (
        <div className="row">
          <span className="muted">Auditor of record</span>
          <AddressTag value={auditor!} />
        </div>
      ) : (
        <Banner kind="info">No audit policy is set yet. The owner sets it from the Admin tab.</Banner>
      )}
      {auditorSet && !isAuditor && (
        <Banner kind="info">
          Disclosure access is granted to the auditor account <AddressTag value={auditor!} />. Connect as that account —
          decryption will only work for the auditor.
        </Banner>
      )}
      {err && <Banner kind="error">{err}</Banner>}
      {!entries && <p className="muted">Loading invoices…</p>}
      {entries && entries.length === 0 && <p className="muted">No invoices recorded yet.</p>}

      {entries?.map((e) => (
        <div className="row" key={e.id}>
          <div className="row-main">
            <span>
              Invoice #{e.id} {e.paid ? <Pill tone="good">Paid</Pill> : <Pill tone="warn">Unpaid</Pill>}
            </span>
            <span className="muted">
              supplier <AddressTag value={e.supplier} /> → buyer <AddressTag value={e.buyer} />
            </span>
          </div>
          {isUninitialized(e.disclosed) ? (
            <Pill tone="muted">0 cUSD · not disclosed</Pill>
          ) : (
            <Reveal
              hiddenLabel="•••••• cUSD"
              load={async () => {
                const v = await decryptHandle(e.disclosed, ADDRESSES.invoiceRegistry, signer!, [
                  ADDRESSES.invoiceRegistry,
                  ADDRESSES.token,
                ]);
                return v === 0n ? "0 cUSD · not disclosed" : formatCusd(v);
              }}
              render={(v) => (v.startsWith("0 cUSD") ? <Pill tone="muted">{v}</Pill> : <strong>{v}</strong>)}
            />
          )}
        </div>
      ))}

      <p className="help" style={{ marginTop: 12 }}>
        A disclosure handle decrypting to exactly <code>0</code> is the proof that disclosure is cryptographically
        conditional — the auditor is granted access unconditionally, but the ciphertext only holds the real amount when
        the threshold/flag policy triggered at settlement.
      </p>
    </Card>
  );
}
