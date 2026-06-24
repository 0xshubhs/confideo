import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const token = await get("CompliantConfidentialToken");

  const invoiceRegistry = await deploy("InvoiceRegistry", {
    from: deployer,
    args: [token.address, deployer],
    log: true,
  });

  console.log(`InvoiceRegistry: ${invoiceRegistry.address}`);
};

export default func;
func.id = "deploy_invoice_registry";
func.tags = ["InvoiceRegistry", "Confideo"];
func.dependencies = ["CompliantConfidentialToken"];
