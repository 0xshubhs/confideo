import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

/**
 * Confideo CLI — exercises the full confidential B2B invoice flow against --network localhost or --network sepolia.
 *
 *   npx hardhat --network localhost deploy
 *   npx hardhat --network localhost confideo:addresses
 *   npx hardhat --network localhost confideo:attest --account 0x...
 *   npx hardhat --network localhost confideo:mint --to <buyer> --amount 1000000000
 *   npx hardhat --network localhost confideo:set-policy --threshold 10000000 --auditor 0x...
 *   npx hardhat --network localhost confideo:create --buyer 0xBBB --amount 5000000      # supplier = signer 0
 *   npx hardhat --network localhost confideo:approve --buyer-index 3                    # buyer authorizes the registry
 *   npx hardhat --network localhost confideo:pay --id 0 --buyer-index 3                 # buyer settles
 *   npx hardhat --network localhost confideo:audit --id 0                               # auditor view
 */

async function getContracts(hre: any) {
  const { ethers, deployments } = hre;
  const registry = await ethers.getContractAt(
    "AttestationRegistry",
    (await deployments.get("AttestationRegistry")).address,
  );
  const token = await ethers.getContractAt(
    "CompliantConfidentialToken",
    (await deployments.get("CompliantConfidentialToken")).address,
  );
  const invoiceRegistry = await ethers.getContractAt(
    "InvoiceRegistry",
    (await deployments.get("InvoiceRegistry")).address,
  );
  return { registry, token, invoiceRegistry };
}

task("confideo:addresses", "Prints the deployed Confideo contract addresses").setAction(async function (_args, hre) {
  for (const name of ["AttestationRegistry", "CompliantConfidentialToken", "InvoiceRegistry"]) {
    try {
      const d = await hre.deployments.get(name);
      console.log(`${name}: ${d.address}`);
    } catch {
      console.log(`${name}: <not deployed>`);
    }
  }
});

task("confideo:attest", "KYC-attest an account in the registry")
  .addParam("account", "Address to attest")
  .setAction(async function (args: TaskArguments, hre) {
    const { registry } = await getContracts(hre);
    await (await registry.attest(args.account, 0, 840)).wait();
    console.log(`Attested ${args.account}`);
  });

task("confideo:mint", "Mint cUSD (6-decimal base units) to an address")
  .addParam("to", "Recipient address")
  .addParam("amount", "Amount in base units")
  .setAction(async function (args: TaskArguments, hre) {
    await hre.fhevm.initializeCLIApi();
    const { token } = await getContracts(hre);
    await (await token.mint(args.to, BigInt(args.amount))).wait();
    console.log(`Minted ${args.amount} cUSD base units to ${args.to}`);
  });

task("confideo:set-policy", "Set the invoice registry audit policy")
  .addParam("threshold", "Disclosure threshold (base units)")
  .addParam("auditor", "Auditor address")
  .setAction(async function (args: TaskArguments, hre) {
    const { invoiceRegistry } = await getContracts(hre);
    await (await invoiceRegistry.setAuditPolicy(BigInt(args.threshold), args.auditor)).wait();
    console.log(`Audit policy set.`);
  });

task("confideo:create", "Supplier (signer 0) raises a confidential invoice against a buyer")
  .addParam("buyer", "Buyer address")
  .addParam("amount", "Invoice amount (base units)")
  .setAction(async function (args: TaskArguments, hre) {
    const { ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();
    const { invoiceRegistry } = await getContracts(hre);
    const invoiceRegistryAddr = await invoiceRegistry.getAddress();
    const supplier = (await ethers.getSigners())[0];

    const enc = await fhevm
      .createEncryptedInput(invoiceRegistryAddr, supplier.address)
      .add64(BigInt(args.amount))
      .encrypt();

    const tx = await invoiceRegistry.connect(supplier).createInvoice(args.buyer, enc.handles[0], enc.inputProof);
    console.log(`createInvoice tx: ${tx.hash}`);
    await tx.wait();
    const count = await invoiceRegistry.invoiceCount();
    console.log(`Invoice #${Number(count) - 1} created (supplier=${supplier.address}, buyer=${args.buyer}).`);
  });

task("confideo:approve", "Buyer authorizes the invoice registry as a token operator")
  .addOptionalParam("buyerIndex", "Signer index of the buyer (default 3)")
  .setAction(async function (args: TaskArguments, hre) {
    const { ethers } = hre;
    const { token, invoiceRegistry } = await getContracts(hre);
    const invoiceRegistryAddr = await invoiceRegistry.getAddress();
    const buyer = (await ethers.getSigners())[args.buyerIndex ? parseInt(args.buyerIndex) : 3];

    const until = (await ethers.provider.getBlock("latest"))!.timestamp + 365 * 24 * 3600;
    await (await token.connect(buyer).setOperator(invoiceRegistryAddr, until)).wait();
    console.log(`Buyer ${buyer.address} authorized the registry as operator until ${until}.`);
  });

task("confideo:pay", "Buyer settles an invoice")
  .addParam("id", "Invoice id")
  .addOptionalParam("buyerIndex", "Signer index of the buyer (default 3)")
  .setAction(async function (args: TaskArguments, hre) {
    const { ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();
    const { invoiceRegistry } = await getContracts(hre);
    const buyer = (await ethers.getSigners())[args.buyerIndex ? parseInt(args.buyerIndex) : 3];

    const tx = await invoiceRegistry.connect(buyer).payInvoice(BigInt(args.id));
    console.log(`payInvoice tx: ${tx.hash}`);
    await tx.wait();
    console.log(`Invoice #${args.id} settled by ${buyer.address}.`);
  });

task("confideo:audit", "Auditor: decrypt the threshold/flag-gated disclosure for an invoice")
  .addParam("id", "Invoice id")
  .addOptionalParam("signer", "Signer index (default 2 = auditor)")
  .setAction(async function (args: TaskArguments, hre) {
    const { ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();
    const { invoiceRegistry } = await getContracts(hre);
    const invoiceRegistryAddr = await invoiceRegistry.getAddress();
    const auditor = (await ethers.getSigners())[args.signer ? parseInt(args.signer) : 2];

    const handle = await invoiceRegistry.getAuditorView(BigInt(args.id));
    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, invoiceRegistryAddr, auditor);
    console.log(`Auditor disclosure for invoice ${args.id}: ${clear} (0 means below threshold & unflagged)`);
  });
