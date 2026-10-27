import { writeFileSync, mkdirSync } from "fs";
import { ethers, network } from "hardhat";

// deploy script for local hardhat node
// run: npx hardhat run scripts/deploy.ts --network localhost

async function main() {
  const [deployer, storeWallet] = await ethers.getSigners();
  console.log(`deploying from: ${deployer.address}`);
  console.log(`store wallet:   ${storeWallet.address}`);

  // deploy SPMT token
  const SPMT = await ethers.getContractFactory("SPMTToken");
  const token = await SPMT.deploy(storeWallet.address);
  await token.waitForDeployment();
  console.log(`SPMTToken deployed: ${await token.getAddress()}`);

  // deploy checkout contract
  const CheckoutFactory = await ethers.getContractFactory("Checkout");
  const checkout = await CheckoutFactory.deploy(await token.getAddress());
  await checkout.waitForDeployment();
  console.log(`Checkout deployed:  ${await checkout.getAddress()}`);

  // let the checkout contract move tokens, nothing else can call pay()
  await (await token.setCheckout(await checkout.getAddress())).wait();

  // seed some SPMT balances for testing — 1 SPMT = 1 unit (18 decimals)
  const usersAndBalances: [string, number][] = [
    [deployer.address, 1000],  // arun — 1000 SPMT
  ];
  for (const [addr, amount] of usersAndBalances) {
    await token.mint(addr, ethers.parseUnits(String(amount), 18));
    console.log(`minted ${amount} SPMT → ${addr}`);
  }

  // the server reads this file, so there's nothing to copy by hand
  const addresses = {
    SPMT_TOKEN_ADDRESS: await token.getAddress(),
    CHECKOUT_ADDRESS: await checkout.getAddress(),
  };
  mkdirSync("deployments", { recursive: true });
  writeFileSync(`deployments/${network.name}.json`, JSON.stringify(addresses, null, 2) + "\n");
  console.log(`addresses written to deployments/${network.name}.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });
