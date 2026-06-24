# Confideo

**Confidential B2B invoice payments with automated, on-chain compliance — built on the
[Zama FHEVM](https://docs.zama.ai/fhevm).**

Confideo lets a **supplier** raise an encrypted invoice against a **buyer**, who settles it in a
confidential ERC-7984 stablecoin (`cUSD`). Every amount — the invoice's face value and the settled
amount — stays encrypted end-to-end on-chain. Compliance is **programmable and automatic**: an
**auditor** is granted decryption rights to a *selective-disclosure* handle that reveals the real
amount only when policy demands it, and otherwise reveals an encrypted `0`.

---

## The core idea: you cannot branch on an encrypted bool

The headline FHEVM constraint is that Solidity control flow **cannot** branch on an encrypted
boolean. So "reveal the amount to the auditor only when it exceeds the threshold" is **not** an
`if`. Instead:

- The auditor's ACL grant on the per-invoice `disclosed` handle is **unconditional** — it always
  runs.
- The *content* of that handle is **cryptographically conditional**, computed with `FHE.select`:

  ```solidity
  bool flagged = flaggedCounterparty[buyer];                 // PLAINTEXT bool -> legal ternary
  ebool over   = FHE.gt(sent, FHE.asEuint64(disclosureThreshold));
  euint64 disclosed = flagged ? sent : FHE.select(over, sent, FHE.asEuint64(0));
  FHE.allowThis(disclosed);
  FHE.allow(disclosed, auditor);                             // unconditional grant
  ```

What the auditor decrypts from `getAuditorView(id)`:

| Buyer flagged? | Settled amount vs threshold | Auditor sees     |
| -------------- | --------------------------- | ---------------- |
| no             | `<= threshold`              | `0`              |
| no             | `>  threshold`              | the real amount  |
| yes            | any                         | the real amount  |

The `flagged` branch is an ordinary Solidity ternary because `flaggedCounterparty[buyer]` is a
**plaintext** `bool` (an explicit owner-set list of EDD/sanctions subjects), not an `ebool`.

---

## Contracts

| Contract                        | Role                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AttestationRegistry.sol`       | Minimal on-chain KYC allowlist. A set of attesters mark plaintext addresses as verified.               |
| `CompliantConfidentialToken.sol`| ERC-7984 confidential `cUSD`. Balances/amounts are `euint64`; sender/recipient gating is on addresses. |
| `InvoiceRegistry.sol`           | The Confideo invoicing engine: create, settle, and selectively disclose confidential invoices.         |

### `InvoiceRegistry` flow

1. **Policy** — the owner calls `setAuditPolicy(threshold, auditor)` and optionally
   `flagCounterparty(account, true)` for EDD subjects.
2. **Create** — a **KYC-attested** supplier calls `createInvoice(buyer, encryptedAmount, inputProof)`
   (a non-attested supplier reverts `SupplierNotVerified`, preventing unsolicited-invoice spam). The
   amount is encrypted client-side against `(registryAddress, supplierAddress)`. The registry persists
   ACL on the handle (`allowThis`) and grants the supplier and buyer read access.
3. **Approve** — the buyer authorizes the registry as a token operator:
   `token.setOperator(registryAddress, until)`.
4. **Settle** — the buyer calls `payInvoice(id)`. The registry pulls funds via
   `confidentialTransferFrom(buyer, supplier, amount)` and records the gated `disclosed` handle for
   the auditor. `sent` is the *actual* amount moved (FHESafeMath sends `0` on insufficient balance).
5. **Audit** — the auditor decrypts `getAuditorView(id)` off-chain via the relayer SDK.

---

## What is and isn't private

- **Private (encrypted `euint64`):** invoice amounts, settled amounts, balances.
- **Public (plaintext):** counterparty addresses, who invoiced whom, and the fact that an invoice
  exists / was paid. Address-level KYC is deliberately public — only *amounts* are confidential,
  exactly as a regulator would expect.

> ⚠️ **Censorship note:** `CompliantConfidentialToken.setFrozen` lets a single owner key block an
> account. That is a deliberate compliance control but also a censorship vector. In production,
> transfer ownership to a multisig/timelock.

---

## Stack (pinned)

- `@fhevm/solidity` `^0.11.1`, `@fhevm/hardhat-plugin` `^0.4.2`, `@fhevm/mock-utils` `^0.4.2`
- `@zama-fhe/relayer-sdk` `^0.4.1` (peers to `@fhevm/mock-utils@0.4.2`)
- `@openzeppelin/confidential-contracts` `^0.5.1`, `@openzeppelin/contracts` `^5.6.1`
- Hardhat `^2.28.6`, Solidity `0.8.27` (cancun, optimizer runs 800)

---

## Quick start

```bash
npm install --no-audit --no-fund
npx hardhat compile
npx hardhat test
```

### Local end-to-end (standalone node, real coprocessor)

```bash
# terminal 1
npx hardhat node

# terminal 2
npx hardhat --network localhost deploy
npx hardhat --network localhost confideo:addresses
npx hardhat --network localhost confideo:attest  --account <supplier>
npx hardhat --network localhost confideo:attest  --account <buyer>
npx hardhat --network localhost confideo:mint     --to <buyer> --amount 1000000000
npx hardhat --network localhost confideo:set-policy --threshold 10000000 --auditor <auditor>
npx hardhat --network localhost confideo:create   --buyer <buyer> --amount 5000000
npx hardhat --network localhost confideo:approve  --buyer-index 3
npx hardhat --network localhost confideo:pay      --id 0 --buyer-index 3
npx hardhat --network localhost confideo:audit    --id 0        # auditor sees 0 (below threshold)
```

> FHE operations need a coprocessor, available on `--network localhost` (a standalone
> `hardhat node`) or `--network sepolia`. The in-process `hardhat` network used by the test suite
> runs the FHEVM **mock** directly.

---

## Tests

`test/Confideo.ts` (mock coprocessor) covers:

- supplier/buyer can decrypt the invoice amount; outsiders are rejected;
- settlement moves confidential funds to the supplier;
- **the compliance invariant**: below-threshold + unflagged ⇒ auditor sees `0`;
- above-threshold ⇒ auditor sees the real amount;
- flagged counterparty ⇒ full disclosure even below threshold;
- access control (`NotBuyer`, `AlreadyPaid`, `SelfInvoice`, `ZeroAddress`, `UnknownInvoice`,
  `PolicyNotSet`, `OwnableUnauthorizedAccount`);
- token KYC gating (`UserRestricted`) and supplier gating (`SupplierNotVerified`).

**15 passing.**

---

## Frontend

A React + Vite dApp (`frontend/`) using `@zama-fhe/relayer-sdk` (`/web`) for in-browser encryption and
user-decryption. Tabs: **Create Invoice** (supplier) · **My Invoices** (decrypt + buyer's four-state
Approve→Pay) · **Auditor** (decrypt the gated disclosure) · **Admin** (attest, mint, audit policy, flags).

```bash
cd frontend
npm install
cp .env.example .env        # paste the deployed addresses (VITE_INVOICE_REGISTRY, VITE_TOKEN, VITE_ATTESTATION_REGISTRY)
npm run dev
```

### Deploy to Sepolia

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY
npx hardhat deploy --network sepolia
npx hardhat verify --network sepolia <address>
```

FHEVM lives on **Sepolia** (chainId 11155111) — there is no FHEVM mainnet. cUSDC/cUSDT don't exist on
Sepolia, so Confideo deploys its own ERC-7984 `cUSD` with an owner faucet (`mint`).

---

## Demo script (~3 min)

1. **Admin** — owner attests a supplier and a buyer, mints cUSD to the buyer, sets the audit policy
   (threshold + auditor), optionally flags the buyer as a watched counterparty.
2. **Create Invoice** — the supplier raises an encrypted invoice; the amount never appears on-chain.
3. **My Invoices** — supplier and buyer each decrypt their own copy of the amount; the buyer approves
   the registry as operator, then pays. Etherscan shows the pair, not the amount.
4. **Auditor** — decrypts the auto-disclosed handle: a below-threshold, unflagged invoice returns `0`;
   an over-threshold (or flagged-counterparty) invoice returns the real amount. *(the "wow")*

---

## Security & known limitations

A fresh-context audit (general EVM checklist + FHEVM ACL/aliasing review against the library source)
found **no critical or high issues** and judged Confideo safe for a Sepolia demo. Demo-scope limitations:

- **Unbounded list views** (`invoicesOfSupplier`/`invoicesOfBuyer`) — paginate for production scale.
- **Policy rotation** does not retroactively grant/revoke access to past encrypted handles.
- **Single-owner controls** (`mint`, `setFrozen`, `setAuditPolicy`, `flagCounterparty`) — move to a
  multisig/timelock for production.

Confideo shares its `AttestationRegistry` and `CompliantConfidentialToken` (and the frontend FHE
plumbing) with its sibling project **Aegis** (confidential payroll + programmable compliance).

---

## License

BSD-3-Clause-Clear.
