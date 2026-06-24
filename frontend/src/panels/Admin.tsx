import { useEffect, useState } from "react";
import { useWallet } from "../wallet";
import { ActionButton, AddressTag, Banner, Card, Field } from "../components/ui";
import { getContracts, parseError } from "../lib/contracts";
import { CUSD_DECIMALS, formatCusd, isAddressLike, parseCusd } from "../lib/format";

export default function AdminPanel() {
  const { signer, address } = useWallet();
  const [registryOwner, setRegistryOwner] = useState<string | null>(null);
  const [tokenOwner, setTokenOwner] = useState<string | null>(null);
  const [policy, setPolicy] = useState<{ threshold: bigint; auditor: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);

  // form state
  const [mintTo, setMintTo] = useState("");
  const [mintAmt, setMintAmt] = useState("");
  const [attestAddr, setAttestAddr] = useState("");
  const [thr, setThr] = useState("");
  const [auditorAddr, setAuditorAddr] = useState("");
  const [flagAddr, setFlagAddr] = useState("");

  const me = address?.toLowerCase() ?? "";
  const isRegistryOwner = !!registryOwner && registryOwner.toLowerCase() === me;
  const isTokenOwner = !!tokenOwner && tokenOwner.toLowerCase() === me;

  useEffect(() => {
    if (!signer) return;
    (async () => {
      try {
        const { invoiceRegistry, token } = getContracts(signer);
        const [ro, to, thrV, aud] = await Promise.all([
          invoiceRegistry.owner(),
          token.owner(),
          invoiceRegistry.disclosureThreshold(),
          invoiceRegistry.auditor(),
        ]);
        setRegistryOwner(ro);
        setTokenOwner(to);
        setPolicy({ threshold: thrV, auditor: aud });
      } catch (e) {
        setMsg({ kind: "error", text: parseError(e) });
      }
    })();
  }, [signer]);

  return (
    <div className="grid">
      <Card title="Audit policy" subtitle="Current disclosure policy on the invoice registry">
        {policy ? (
          <>
            <div className="row">
              <span className="muted">Disclosure threshold</span>
              <span className="value">{formatCusd(policy.threshold)}</span>
            </div>
            <div className="row">
              <span className="muted">Auditor</span>
              <AddressTag value={policy.auditor} />
            </div>
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Card>

      <Card title="Owners" subtitle="Admin actions are gated on these accounts.">
        <div className="row">
          <span className="muted">Invoice registry owner</span>
          {registryOwner ? <AddressTag value={registryOwner} /> : <span className="muted">…</span>}
        </div>
        <div className="row">
          <span className="muted">Token owner</span>
          {tokenOwner ? <AddressTag value={tokenOwner} /> : <span className="muted">…</span>}
        </div>
      </Card>

      {msg && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Banner kind={msg.kind} onClose={() => setMsg(null)}>
            {msg.text}
          </Banner>
        </div>
      )}

      {!isRegistryOwner && !isTokenOwner && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Banner kind="info">
            Admin actions below require the registry or token owner account. Connect as an owner to enable them.
          </Banner>
        </div>
      )}

      <Card title="Mint cUSD (faucet)" subtitle="Token owner-only. Recipient must be KYC-attested.">
        <Field label="To address">
          <input value={mintTo} onChange={(e) => setMintTo(e.target.value)} placeholder="0x… (e.g. a buyer)" />
        </Field>
        <Field label="Amount (cUSD)" hint={`6 decimals · ${CUSD_DECIMALS}`}>
          <input value={mintAmt} onChange={(e) => setMintAmt(e.target.value)} placeholder="1000" />
        </Field>
        <ActionButton
          disabled={!isTokenOwner || !isAddressLike(mintTo) || !mintAmt}
          pendingLabel="Minting…"
          onClick={async () => {
            if (!signer) return;
            setMsg(null);
            try {
              const { token } = getContracts(signer);
              await (await token.mint(mintTo, parseCusd(mintAmt))).wait();
              setMsg({ kind: "success", text: `Minted ${mintAmt} cUSD to ${mintTo}` });
            } catch (e) {
              setMsg({ kind: "error", text: parseError(e) });
            }
          }}
        >
          Mint
        </ActionButton>
      </Card>

      <Card title="KYC attestation" subtitle="Owner/attester adds an address to the allowlist (country 840 / US).">
        <Field label="Account to attest">
          <input value={attestAddr} onChange={(e) => setAttestAddr(e.target.value)} placeholder="0x…" />
        </Field>
        <ActionButton
          disabled={!isAddressLike(attestAddr)}
          pendingLabel="Attesting…"
          onClick={async () => {
            if (!signer) return;
            setMsg(null);
            try {
              const { registry } = getContracts(signer);
              await (await registry.attest(attestAddr, 0, 840)).wait();
              setMsg({ kind: "success", text: `Attested ${attestAddr}` });
            } catch (e) {
              setMsg({ kind: "error", text: parseError(e) });
            }
          }}
        >
          Attest (KYC)
        </ActionButton>
      </Card>

      <Card title="Set audit policy" subtitle="Registry owner sets the disclosure threshold and the auditor.">
        <Field label="Disclosure threshold (cUSD)" hint="Settled amounts strictly above this are disclosed to the auditor.">
          <input value={thr} onChange={(e) => setThr(e.target.value)} placeholder="10" />
        </Field>
        <Field label="Auditor">
          <input value={auditorAddr} onChange={(e) => setAuditorAddr(e.target.value)} placeholder="0x…" />
        </Field>
        <ActionButton
          disabled={!isRegistryOwner || !thr || !isAddressLike(auditorAddr)}
          pendingLabel="Saving…"
          onClick={async () => {
            if (!signer) return;
            setMsg(null);
            try {
              const { invoiceRegistry } = getContracts(signer);
              await (await invoiceRegistry.setAuditPolicy(parseCusd(thr), auditorAddr)).wait();
              setPolicy({ threshold: parseCusd(thr), auditor: auditorAddr });
              setMsg({ kind: "success", text: "Audit policy updated." });
            } catch (e) {
              setMsg({ kind: "error", text: parseError(e) });
            }
          }}
        >
          Save policy
        </ActionButton>
      </Card>

      <Card
        title="Flag / unflag counterparty"
        subtitle="Registry owner-only. A flagged buyer's settled invoices are ALWAYS disclosed to the auditor, regardless of the threshold."
      >
        <Field label="Account">
          <input value={flagAddr} onChange={(e) => setFlagAddr(e.target.value)} placeholder="0x…" />
        </Field>
        <div className="inline-actions">
          <ActionButton
            variant="danger"
            disabled={!isRegistryOwner || !isAddressLike(flagAddr)}
            pendingLabel="Flagging…"
            onClick={async () => {
              if (!signer) return;
              setMsg(null);
              try {
                const { invoiceRegistry } = getContracts(signer);
                await (await invoiceRegistry.flagCounterparty(flagAddr, true)).wait();
                setMsg({ kind: "success", text: `Flagged ${flagAddr}` });
              } catch (e) {
                setMsg({ kind: "error", text: parseError(e) });
              }
            }}
          >
            Flag
          </ActionButton>
          <ActionButton
            variant="ghost"
            disabled={!isRegistryOwner || !isAddressLike(flagAddr)}
            pendingLabel="Unflagging…"
            onClick={async () => {
              if (!signer) return;
              setMsg(null);
              try {
                const { invoiceRegistry } = getContracts(signer);
                await (await invoiceRegistry.flagCounterparty(flagAddr, false)).wait();
                setMsg({ kind: "success", text: `Unflagged ${flagAddr}` });
              } catch (e) {
                setMsg({ kind: "error", text: parseError(e) });
              }
            }}
          >
            Unflag
          </ActionButton>
        </div>
      </Card>
    </div>
  );
}
