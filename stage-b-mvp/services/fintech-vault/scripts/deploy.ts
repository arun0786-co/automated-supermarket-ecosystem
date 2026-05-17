import { ethers } from "hardhat";

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

  // seed some SPMT balances for testing — 1 SPMT = 1 unit (18 decimals)
  const usersAndBalances: [string, number][] = [
    [deployer.address, 1000],  // arun — 1000 SPMT
  ];
  for (const [addr, amount] of usersAndBalances) {
    await token.mint(addr, ethers.parseUnits(String(amount), 18));
    console.log(`minted ${amount} SPMT → ${addr}`);
  }

  // print addresses so the backend service can pick them up from env vars
  console.log("\n--- copy these into your .env ---");
  console.log(`SPMT_TOKEN_ADDRESS=${await token.getAddress()}`);
  console.log(`CHECKOUT_ADDRESS=${await checkout.getAddress()}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
