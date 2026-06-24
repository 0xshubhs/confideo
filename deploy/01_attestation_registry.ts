import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const registry = await deploy("AttestationRegistry", {
    from: deployer,
    args: [deployer],
    log: true,
  });

  console.log(`AttestationRegistry: ${registry.address}`);
};

export default func;
func.id = "deploy_attestation_registry";
func.tags = ["AttestationRegistry", "Confideo"];
