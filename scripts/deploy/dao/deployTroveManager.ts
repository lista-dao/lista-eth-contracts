import { DEPLOYMENT_PARAMS } from "../../../constants";
import { Contract } from "ethers";
import hre, { ethers } from "hardhat";

const params = DEPLOYMENT_PARAMS[11155111];

export const deployTroveManager = async (
  listaCore: Contract,
  debtToken: Contract,
  borrowOperations: Contract,
  vault: Contract,
  liquidationManager: Contract
) => {
  console.log("Deploying TroveManager...");
  const troveManager = await ethers.deployContract("TroveManager", [
    listaCore.address,
    params.gasPool,
    debtToken.address,
    borrowOperations.address,
    vault.address,
    liquidationManager.address,
    params.gasCompensation,
  ]);
  await troveManager.deployed();
  console.log("TroveManager deployed to:", troveManager.address);

  while (true) {
    try {
      await hre.run("verify:verify", {
        address: troveManager.address,
        constructorArguments: [
          listaCore.address,
          params.gasPool,
          debtToken.address,
          borrowOperations.address,
          vault.address,
          liquidationManager.address,
          params.gasCompensation,
        ],
      });
      break;
    } catch (e) {
      console.log("retrying...");
    }
  }

  return troveManager;
};
