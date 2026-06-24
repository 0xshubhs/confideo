import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const registry = await get("AttestationRegistry");

  const token = await deploy("CompliantConfidentialToken", {
    from: deployer,
    args: ["Confideo USD", "cUSD", "https://confideo.example/cusd.json", registry.address, deployer],
    log: true,
  });

  console.log(`CompliantConfidentialToken (cUSD): ${token.address}`);
};

export default func;
func.id = "deploy_token";
func.tags = ["CompliantConfidentialToken", "Confideo"];
func.dependencies = ["AttestationRegistry"];
