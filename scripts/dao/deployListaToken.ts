import { DEPLOYMENT_PARAMS } from "../../constants";
import { Contract } from "ethers";
import { ethers } from "hardhat";

const params = DEPLOYMENT_PARAMS[11155111];

export const deployListaToken = async (
  vault: Contract,
  tokenLocker: Contract
) => {
  console.log("Deploying ListaToken...");
  const listaToken = await ethers.deployContract("ListaToken", [
    vault.address,
    params.lzEndpoint,
    tokenLocker.address,
  ]);
  await listaToken.deployed();
  console.log("ListaToken deployed to:", await listaToken.address);

  return listaToken;
};