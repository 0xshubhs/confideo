// Human-readable ABI fragments (ethers v6). euint64/externalEuint64 handles are bytes32 on the wire.

const OWNABLE_ERRORS = ["error OwnableUnauthorizedAccount(address account)", "error ZeroAddress()"];

export const REGISTRY_ABI = [
  "function attest(address account, uint64 validUntil, uint16 countryCode)",
  "function revoke(address account)",
  "function isVerified(address account) view returns (bool)",
  "function isAttester(address attester) view returns (bool)",
  "function setAttester(address attester, bool allowed)",
  "function owner() view returns (address)",
  "error NotAttester(address caller)",
  ...OWNABLE_ERRORS,
];

export const TOKEN_ABI = [
  "function mint(address to, uint64 amount)",
  "function setFrozen(address account, bool frozen)",
  "function isFrozen(address account) view returns (bool)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function setOperator(address operator, uint48 until)",
  "function isOperator(address holder, address spender) view returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function owner() view returns (address)",
  "error UserRestricted(address account)",
  ...OWNABLE_ERRORS,
];

// InvoiceRegistry.sol — Confideo's confidential B2B invoicing engine.
// `createInvoice` takes an externalEuint64 handle (bytes32) + inputProof and returns the new id.
// `getInvoice` returns the full struct tuple; the euint64 fields (amount, disclosed) are bytes32 handles.
// `getAuditorView` returns the auditor-decryptable disclosure handle (bytes32).
export const INVOICE_ABI = [
  "function createInvoice(address buyer, bytes32 encryptedAmount, bytes inputProof) returns (uint256 id)",
  "function payInvoice(uint256 id)",
  "function setAuditPolicy(uint64 threshold, address auditor_)",
  "function flagCounterparty(address account, bool flagged)",
  "function disclosureThreshold() view returns (uint64)",
  "function auditor() view returns (address)",
  "function flaggedCounterparty(address account) view returns (bool)",
  "function invoiceCount() view returns (uint256)",
  "function getInvoice(uint256 id) view returns (address supplier, address buyer, bytes32 amount, bytes32 disclosed, bool paid, uint64 createdAt, uint64 paidAt)",
  "function getAuditorView(uint256 id) view returns (bytes32 disclosed)",
  "function invoicesOfSupplier(address supplier) view returns (uint256[])",
  "function invoicesOfBuyer(address buyer) view returns (uint256[])",
  "function owner() view returns (address)",
  "event InvoiceCreated(uint256 indexed id, address indexed supplier, address indexed buyer)",
  "event InvoicePaid(uint256 indexed id, address indexed supplier, address indexed buyer)",
  "event AuditPolicySet(uint64 disclosureThreshold, address indexed auditor)",
  "event CounterpartyFlagged(address indexed account, bool flagged)",
  "error SelfInvoice()",
  "error AlreadyPaid()",
  "error NotBuyer()",
  "error UnknownInvoice(uint256 id)",
  "error PolicyNotSet()",
  "error SupplierNotVerified(address supplier)",
  ...OWNABLE_ERRORS,
];
