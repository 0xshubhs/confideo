import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * Demo wiring so a fresh deployment is immediately usable:
 *  - attest the deployer and any CONFIDEO_PARTIES (suppliers/buyers must be verified to hold cUSD),
 *  - set the audit policy (disclosure threshold + auditor),
 *  - mint an initial cUSD balance to the deployer so it can act as a demo buyer.
 *
 * NOTE: FHE operations (mint) inside a deploy script require a coprocessor, which is only available
 * on `--network localhost` (a standalone `hardhat node`) or `--network sepolia`. On the in-process
 * `hardhat` network the contracts still deploy and the non-FHE wiring runs; mint is skipped (use the
 * `confideo:mint` task, or the test suite, which run the mock directly).
 *
 * Tunable via env:
 *  - CONFIDEO_THRESHOLD  (cUSD base units, 6 decimals; default 10_000_000 == 10 cUSD)
 *  - CONFIDEO_FUND       (cUSD base units; default 1_000_000_000 == 1,000 cUSD)
 *  - CONFIDEO_PARTIES    (comma-separated addresses to KYC-attest for the demo)
 */
const ISO_US = 840;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { ethers, fhevm, getNamedAccounts, deployments } = hre;
  const { deployer, auditor } = await getNamedAccounts();

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

  const threshold = BigInt(process.env.CONFIDEO_THRESHOLD ?? "10000000"); // 10 cUSD
  const fund = BigInt(process.env.CONFIDEO_FUND ?? "1000000000"); // 1,000 cUSD

  // 1. Attest the deployer so it can hold/settle cUSD as a demo buyer.
  if (!(await registry.isVerified(deployer))) {
    await (await registry.attest(deployer, 0, ISO_US)).wait();
    console.log(`Attested deployer ${deployer}`);
  }

  // 2. Attest any demo parties passed via CONFIDEO_PARTIES.
  const parties = (process.env.CONFIDEO_PARTIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ethers.isAddress(s));
  for (const p of parties) {
    if (!(await registry.isVerified(p))) {
      await (await registry.attest(p, 0, ISO_US)).wait();
      console.log(`Attested party ${p}`);
    }
  }

  // 3. Set the audit policy.
  await (await invoiceRegistry.setAuditPolicy(threshold, auditor)).wait();
  console.log(`Audit policy set: threshold=${threshold} auditor=${auditor}`);

  // 4. Mint an initial cUSD balance to the deployer (FHE op — coprocessor required).
  const coprocessorAvailable = hre.network.name === "localhost" || hre.network.name === "sepolia";
  if (coprocessorAvailable) {
    await fhevm.initializeCLIApi();
    await (await token.mint(deployer, fund)).wait();
    console.log(`Minted ${fund} cUSD base units to the deployer`);
  } else {
    console.log(
      `Skipped demo mint on the in-process 'hardhat' network. ` +
        `Deploy with --network localhost or --network sepolia, or run: npx hardhat confideo:mint --to ${deployer} --amount ${fund}`,
    );
  }

  console.log(`\nConfideo is wired. deployer=${deployer}`);
};

export default func;
func.id = "confideo_demo_setup";
func.tags = ["Setup", "Confideo"];
func.dependencies = ["InvoiceRegistry"];
