import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { AttestationRegistry, CompliantConfidentialToken, InvoiceRegistry } from "../types";

const US = 840; // ISO-3166 numeric country code, just for flavor
const THRESHOLD = 10_000_000; // 10 cUSD disclosure threshold (6-decimal base units)
const FUND = 1_000_000_000; // 1,000 cUSD funded to the buyer

describe("Confideo", function () {
  let owner: HardhatEthersSigner; // deployer / registry owner
  let auditor: HardhatEthersSigner;
  let supplier: HardhatEthersSigner;
  let buyer: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  let registry: AttestationRegistry;
  let token: CompliantConfidentialToken;
  let invoiceRegistry: InvoiceRegistry;
  let tokenAddr: string;
  let invoiceRegistryAddr: string;

  before(async function () {
    [owner, auditor, supplier, buyer, outsider] = await ethers.getSigners();
  });

  beforeEach(async function () {
    // These suites exercise FHE decryption and only run on the in-process mock coprocessor.
    if (!fhevm.isMock) {
      console.warn("Confideo tests require the FHEVM mock; skipping on a live network.");
      this.skip();
    }

    const Registry = await ethers.getContractFactory("AttestationRegistry");
    registry = (await Registry.deploy(owner.address)) as AttestationRegistry;

    const Token = await ethers.getContractFactory("CompliantConfidentialToken");
    token = (await Token.deploy(
      "Confideo USD",
      "cUSD",
      "https://confideo.example/cusd.json",
      await registry.getAddress(),
      owner.address,
    )) as CompliantConfidentialToken;
    tokenAddr = await token.getAddress();

    const InvoiceRegistryFactory = await ethers.getContractFactory("InvoiceRegistry");
    invoiceRegistry = (await InvoiceRegistryFactory.deploy(tokenAddr, owner.address)) as InvoiceRegistry;
    invoiceRegistryAddr = await invoiceRegistry.getAddress();

    // KYC the token holders (supplier & buyer transact; auditor/outsider do not).
    await (await registry.attest(supplier.address, 0, US)).wait();
    await (await registry.attest(buyer.address, 0, US)).wait();

    // Fund the buyer so they can settle invoices.
    await (await token.mint(buyer.address, FUND)).wait();

    // Buyer authorizes the registry as a token operator (required for confidentialTransferFrom).
    const until = (await ethers.provider.getBlock("latest"))!.timestamp + 3600 * 24 * 365;
    await (await token.connect(buyer).setOperator(invoiceRegistryAddr, until)).wait();

    // Set the audit policy.
    await (await invoiceRegistry.setAuditPolicy(THRESHOLD, auditor.address)).wait();
  });

  async function createInvoice(from: HardhatEthersSigner, buyerAddr: string, amount: number) {
    const enc = await fhevm.createEncryptedInput(invoiceRegistryAddr, from.address).add64(amount).encrypt();
    await (await invoiceRegistry.connect(from).createInvoice(buyerAddr, enc.handles[0], enc.inputProof)).wait();
    return Number(await invoiceRegistry.invoiceCount()) - 1;
  }

  it("supplier raises an invoice both counterparties can decrypt, outsiders cannot", async function () {
    const id = await createInvoice(supplier, buyer.address, 5_000_000);
    const inv = await invoiceRegistry.getInvoice(id);

    expect(inv.supplier).to.eq(supplier.address);
    expect(inv.buyer).to.eq(buyer.address);
    expect(inv.paid).to.eq(false);

    // Both counterparties can decrypt the intended amount.
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, inv.amount, invoiceRegistryAddr, buyer)).to.eq(5_000_000);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, inv.amount, invoiceRegistryAddr, supplier)).to.eq(5_000_000);

    // An outsider is NOT allowed to decrypt the amount.
    await expect(fhevm.userDecryptEuint(FhevmType.euint64, inv.amount, invoiceRegistryAddr, outsider)).to.be.rejected;
  });

  it("buyer settles an invoice and funds move to the supplier", async function () {
    const id = await createInvoice(supplier, buyer.address, 5_000_000);
    await (await invoiceRegistry.connect(buyer).payInvoice(id)).wait();

    const inv = await invoiceRegistry.getInvoice(id);
    expect(inv.paid).to.eq(true);
    expect(inv.paidAt).to.be.greaterThan(0n);

    // Supplier can still decrypt the (unchanged) intended invoice amount.
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, inv.amount, invoiceRegistryAddr, supplier)).to.eq(5_000_000);

    // Supplier received the funds (they can decrypt their own confidential balance).
    const supplierBal = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await token.confidentialBalanceOf(supplier.address),
      tokenAddr,
      supplier,
    );
    expect(supplierBal).to.eq(5_000_000);
  });

  it("THE compliance invariant: below-threshold, unflagged disclosure decrypts to 0", async function () {
    // 5,000,000 is below the 10,000,000 threshold; buyer is not flagged.
    const id = await createInvoice(supplier, buyer.address, 5_000_000);
    await (await invoiceRegistry.connect(buyer).payInvoice(id)).wait();

    const disclosed = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await invoiceRegistry.getAuditorView(id),
      invoiceRegistryAddr,
      auditor,
    );
    expect(disclosed).to.eq(0); // ← the "wow" moment: auditor sees 0 for a sub-threshold settlement
  });

  it("above-threshold disclosure reveals the real settled amount to the auditor", async function () {
    const id = await createInvoice(supplier, buyer.address, 250_000_000);
    await (await invoiceRegistry.connect(buyer).payInvoice(id)).wait();

    const disclosed = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await invoiceRegistry.getAuditorView(id),
      invoiceRegistryAddr,
      auditor,
    );
    expect(disclosed).to.eq(250_000_000);
  });

  it("a flagged counterparty is fully disclosed to the auditor even below threshold", async function () {
    await (await invoiceRegistry.flagCounterparty(buyer.address, true)).wait();

    const id = await createInvoice(supplier, buyer.address, 1_000_000); // below threshold
    await (await invoiceRegistry.connect(buyer).payInvoice(id)).wait();

    const disclosed = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await invoiceRegistry.getAuditorView(id),
      invoiceRegistryAddr,
      auditor,
    );
    expect(disclosed).to.eq(1_000_000); // ← full disclosure because the buyer is flagged
  });

  it("invoicesOfSupplier / invoicesOfBuyer track history", async function () {
    const id0 = await createInvoice(supplier, buyer.address, 1_000_000);
    const id1 = await createInvoice(supplier, buyer.address, 2_000_000);

    const supplierInvoices = await invoiceRegistry.invoicesOfSupplier(supplier.address);
    const buyerInvoices = await invoiceRegistry.invoicesOfBuyer(buyer.address);
    expect(supplierInvoices.map((x) => Number(x))).to.deep.eq([id0, id1]);
    expect(buyerInvoices.map((x) => Number(x))).to.deep.eq([id0, id1]);
  });

  describe("access control & validation", function () {
    it("only the buyer can pay an invoice", async function () {
      const id = await createInvoice(supplier, buyer.address, 5_000_000);
      await expect(invoiceRegistry.connect(outsider).payInvoice(id)).to.be.revertedWithCustomError(
        invoiceRegistry,
        "NotBuyer",
      );
      await expect(invoiceRegistry.connect(supplier).payInvoice(id)).to.be.revertedWithCustomError(
        invoiceRegistry,
        "NotBuyer",
      );
    });

    it("an invoice cannot be paid twice", async function () {
      const id = await createInvoice(supplier, buyer.address, 5_000_000);
      await (await invoiceRegistry.connect(buyer).payInvoice(id)).wait();
      await expect(invoiceRegistry.connect(buyer).payInvoice(id)).to.be.revertedWithCustomError(
        invoiceRegistry,
        "AlreadyPaid",
      );
    });

    it("a supplier cannot invoice themselves", async function () {
      const enc = await fhevm.createEncryptedInput(invoiceRegistryAddr, supplier.address).add64(1_000_000).encrypt();
      await expect(
        invoiceRegistry.connect(supplier).createInvoice(supplier.address, enc.handles[0], enc.inputProof),
      ).to.be.revertedWithCustomError(invoiceRegistry, "SelfInvoice");
    });

    it("createInvoice rejects the zero address buyer", async function () {
      const enc = await fhevm.createEncryptedInput(invoiceRegistryAddr, supplier.address).add64(1_000_000).encrypt();
      await expect(
        invoiceRegistry.connect(supplier).createInvoice(ethers.ZeroAddress, enc.handles[0], enc.inputProof),
      ).to.be.revertedWithCustomError(invoiceRegistry, "ZeroAddress");
    });

    it("payInvoice reverts on an unknown id", async function () {
      await expect(invoiceRegistry.connect(buyer).payInvoice(999)).to.be.revertedWithCustomError(
        invoiceRegistry,
        "UnknownInvoice",
      );
    });

    it("payInvoice reverts when the policy is not set", async function () {
      const InvoiceRegistryFactory = await ethers.getContractFactory("InvoiceRegistry");
      const fresh = (await InvoiceRegistryFactory.deploy(tokenAddr, owner.address)) as InvoiceRegistry;
      const freshAddr = await fresh.getAddress();

      // Buyer authorizes the fresh registry and the supplier raises an invoice (no policy set).
      const until = (await ethers.provider.getBlock("latest"))!.timestamp + 3600 * 24 * 365;
      await (await token.connect(buyer).setOperator(freshAddr, until)).wait();
      const enc = await fhevm.createEncryptedInput(freshAddr, supplier.address).add64(1_000_000).encrypt();
      await (await fresh.connect(supplier).createInvoice(buyer.address, enc.handles[0], enc.inputProof)).wait();

      await expect(fresh.connect(buyer).payInvoice(0)).to.be.revertedWithCustomError(fresh, "PolicyNotSet");
    });

    it("only the owner can set the audit policy and flag counterparties", async function () {
      await expect(
        invoiceRegistry.connect(supplier).setAuditPolicy(1, auditor.address),
      ).to.be.revertedWithCustomError(invoiceRegistry, "OwnableUnauthorizedAccount");
      await expect(
        invoiceRegistry.connect(supplier).flagCounterparty(buyer.address, true),
      ).to.be.revertedWithCustomError(invoiceRegistry, "OwnableUnauthorizedAccount");
    });
  });

  describe("token compliance gating", function () {
    it("a non-attested buyer cannot receive minted cUSD (UserRestricted)", async function () {
      await expect(token.mint(outsider.address, 100)).to.be.revertedWithCustomError(token, "UserRestricted");
    });

    it("a non-attested supplier cannot raise an invoice (SupplierNotVerified)", async function () {
      // The outsider is not KYC-attested, so creating an invoice is blocked up front — this keeps both
      // counterparties within the attested set and prevents unsolicited-invoice spam.
      const enc = await fhevm.createEncryptedInput(invoiceRegistryAddr, outsider.address).add64(5_000_000).encrypt();
      await expect(
        invoiceRegistry.connect(outsider).createInvoice(buyer.address, enc.handles[0], enc.inputProof),
      ).to.be.revertedWithCustomError(invoiceRegistry, "SupplierNotVerified");
    });
  });
});
