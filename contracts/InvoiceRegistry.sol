// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AttestationRegistry} from "./AttestationRegistry.sol";
import {CompliantConfidentialToken} from "./CompliantConfidentialToken.sol";

/// @title InvoiceRegistry
/// @notice Confideo's confidential B2B invoicing engine. A supplier raises an encrypted invoice
///         against a buyer; the buyer settles it in confidential cUSD; every amount stays encrypted
///         end-to-end. Selective decryption is granted by policy:
///           • supplier & buyer → can decrypt the invoice's own intended amount;
///           • auditor          → can decrypt a THRESHOLD/FLAG-GATED disclosure handle (the real
///                                settled amount only when the payment exceeds `disclosureThreshold`
///                                OR the buyer is flagged, otherwise an encrypted 0).
///
/// @dev THE core FHEVM constraint: you CANNOT branch Solidity control flow on an encrypted bool, so
///      "reveal to the auditor only when amount > threshold" is NOT an `if`. Instead the auditor is
///      granted ACL UNCONDITIONALLY over `disclosed`; the *content* is cryptographically conditional
///      via {FHE.select}. The grant always runs. The `flagged` branch IS a plain Solidity ternary —
///      that is legal because `flaggedCounterparty[buyer]` is a PLAINTEXT bool, not an `ebool`.
///
///      Settlement uses the ERC-7984 operator flow: the buyer must first authorize this registry as
///      an operator on the token (`token.setOperator(address(this), until)`); `payInvoice` then pulls
///      funds via `confidentialTransferFrom(buyer, supplier, amount)`.
contract InvoiceRegistry is ZamaEthereumConfig, Ownable2Step, ReentrancyGuard {
    /// @notice The confidential stablecoin used to settle invoices.
    CompliantConfidentialToken public immutable token;

    /// @dev A single confidential invoice.
    struct Invoice {
        address supplier; // creator; gets paid (public counterparty)
        address buyer; // payer (public counterparty)
        euint64 amount; // intended invoice amount — supplier & buyer decryptable
        euint64 disclosed; // threshold/flag-gated handle — auditor decryptable (real amount or 0)
        bool paid; // settlement flag
        uint64 createdAt; // block time of creation
        uint64 paidAt; // block time of settlement (0 until paid)
    }

    Invoice[] private _invoices;
    mapping(address supplier => uint256[]) private _supplierInvoices;
    mapping(address buyer => uint256[]) private _buyerInvoices;

    // ---- Compliance policy ----
    uint64 public disclosureThreshold; // amounts strictly greater than this are disclosed to the auditor
    address public auditor;
    mapping(address account => bool) public flaggedCounterparty; // plaintext flag -> always disclose to auditor

    event InvoiceCreated(uint256 indexed id, address indexed supplier, address indexed buyer);
    event InvoicePaid(uint256 indexed id, address indexed supplier, address indexed buyer);
    event AuditPolicySet(uint64 disclosureThreshold, address indexed auditor);
    event CounterpartyFlagged(address indexed account, bool flagged);

    error ZeroAddress();
    error SelfInvoice();
    error AlreadyPaid();
    error NotBuyer();
    error UnknownInvoice(uint256 id);
    error PolicyNotSet();
    error SupplierNotVerified(address supplier);

    /// @param token_ The deployed CompliantConfidentialToken used for settlement.
    /// @param initialOwner The registry operator/owner (sets policy, manages flags).
    constructor(CompliantConfidentialToken token_, address initialOwner) Ownable(initialOwner) {
        if (address(token_) == address(0) || initialOwner == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ---------------------------------------------------------------------
    //  Policy administration
    // ---------------------------------------------------------------------

    /// @notice Set the audit policy: disclosure threshold (cUSD base units, 6 decimals) and the auditor.
    function setAuditPolicy(uint64 threshold, address auditor_) external onlyOwner {
        if (auditor_ == address(0)) revert ZeroAddress();
        disclosureThreshold = threshold;
        auditor = auditor_;
        emit AuditPolicySet(threshold, auditor_);
    }

    /// @notice Flag (or unflag) a counterparty so any invoice it settles is ALWAYS disclosed to the
    ///         auditor in full, regardless of the threshold (e.g. sanctions/EDD subject).
    function flagCounterparty(address account, bool flagged) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        flaggedCounterparty[account] = flagged;
        emit CounterpartyFlagged(account, flagged);
    }

    // ---------------------------------------------------------------------
    //  Invoicing
    // ---------------------------------------------------------------------

    /// @notice Supplier (msg.sender) raises a confidential invoice against `buyer`.
    /// @param buyer The party that will settle the invoice (must be KYC-attested in the token to pay).
    /// @param encryptedAmount Encrypted intended amount (handle from a client-side encryption).
    /// @param inputProof The input proof covering `encryptedAmount`.
    /// @return id The new invoice id.
    /// @dev Encrypt client-side against THIS registry and the calling supplier:
    ///      `createEncryptedInput(registryAddress, supplierAddress).add64(amount).encrypt()`.
    function createInvoice(
        address buyer,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (uint256 id) {
        if (buyer == address(0)) revert ZeroAddress();
        if (buyer == msg.sender) revert SelfInvoice();
        // Compliance: only a KYC-attested supplier may raise an invoice (prevents unsolicited-invoice
        // spam and keeps both counterparties within the attested set).
        if (!token.registry().isVerified(msg.sender)) revert SupplierNotVerified(msg.sender);

        // Import the encrypted amount (bound to this registry + supplier) and persist ACL so the
        // registry can later spend it via the token, and grant both counterparties read access.
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);
        FHE.allow(amount, buyer);

        id = _invoices.length;
        // `disclosed` is left as the default (uninitialized) euint64 until settlement sets it.
        _invoices.push(
            Invoice({
                supplier: msg.sender,
                buyer: buyer,
                amount: amount,
                disclosed: euint64.wrap(0),
                paid: false,
                createdAt: uint64(block.timestamp),
                paidAt: 0
            })
        );
        _supplierInvoices[msg.sender].push(id);
        _buyerInvoices[buyer].push(id);

        emit InvoiceCreated(id, msg.sender, buyer);
    }

    /// @notice Buyer settles invoice `id`, moving confidential cUSD from buyer to supplier and
    ///         recording a threshold/flag-gated disclosure handle for the auditor.
    /// @dev The buyer MUST have authorized this registry as a token operator beforehand:
    ///      `token.setOperator(address(this), until)`.
    function payInvoice(uint256 id) external nonReentrant {
        if (id >= _invoices.length) revert UnknownInvoice(id);
        Invoice storage inv = _invoices[id];
        if (inv.paid) revert AlreadyPaid();
        if (msg.sender != inv.buyer) revert NotBuyer();
        if (auditor == address(0)) revert PolicyNotSet();

        // The registry holds persistent ACL on `amount` from createInvoice's allowThis. Grant the
        // token transient permission to use it for this settlement.
        euint64 amount = inv.amount;
        FHE.allowTransient(amount, address(token));

        // Pull funds as the buyer's operator; `sent` is the ACTUAL amount moved (FHESafeMath sends 0
        // on insufficient balance — we record what truly moved).
        euint64 sent = token.confidentialTransferFrom(inv.buyer, inv.supplier, amount);
        FHE.allowThis(sent);

        inv.paid = true;
        inv.paidAt = uint64(block.timestamp);

        // AUTOMATED COMPLIANCE — selective disclosure. `flagged` is a PLAINTEXT bool so a normal
        // ternary is legal; the threshold comparison is encrypted and resolved with FHE.select.
        // Auditor decrypts: flagged buyer -> full amount; unflagged & amount>threshold -> full amount;
        // unflagged & amount<=threshold -> 0. The auditor ACL grant below is UNCONDITIONAL.
        bool flagged = flaggedCounterparty[inv.buyer];
        ebool over = FHE.gt(sent, FHE.asEuint64(disclosureThreshold));
        euint64 disclosed = flagged ? sent : FHE.select(over, sent, FHE.asEuint64(0));
        FHE.allowThis(disclosed);
        FHE.allow(disclosed, auditor);
        inv.disclosed = disclosed;

        emit InvoicePaid(id, inv.supplier, inv.buyer);
    }

    // ---------------------------------------------------------------------
    //  Views — return encrypted handles. Only ACL-authorized parties can
    //  actually decrypt them off-chain via the relayer SDK (userDecrypt).
    // ---------------------------------------------------------------------

    /// @notice Number of recorded invoices.
    function invoiceCount() external view returns (uint256) {
        return _invoices.length;
    }

    /// @notice Full invoice by id. `amount` is supplier/buyer-decryptable; `disclosed` is auditor-decryptable.
    function getInvoice(
        uint256 id
    )
        external
        view
        returns (
            address supplier,
            address buyer,
            euint64 amount,
            euint64 disclosed,
            bool paid,
            uint64 createdAt,
            uint64 paidAt
        )
    {
        if (id >= _invoices.length) revert UnknownInvoice(id);
        Invoice storage inv = _invoices[id];
        return (inv.supplier, inv.buyer, inv.amount, inv.disclosed, inv.paid, inv.createdAt, inv.paidAt);
    }

    /// @notice The auditor-decryptable disclosure handle for an invoice (0 until settled).
    function getAuditorView(uint256 id) external view returns (euint64 disclosed) {
        if (id >= _invoices.length) revert UnknownInvoice(id);
        return _invoices[id].disclosed;
    }

    /// @notice Invoice ids raised by a given supplier.
    function invoicesOfSupplier(address supplier) external view returns (uint256[] memory) {
        return _supplierInvoices[supplier];
    }

    /// @notice Invoice ids addressed to a given buyer.
    function invoicesOfBuyer(address buyer) external view returns (uint256[] memory) {
        return _buyerInvoices[buyer];
    }
}
