import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { ethers, network } from "hardhat";

// deploy script for local hardhat node
// run: npx hardhat run scripts/deploy.ts --network localhost

async function alreadyDeployed(): Promise<boolean> {
  const file = `deployments/${network.name}.json`;
  if (!existsSync(file)) return false;
  try {
    const { CHECKOUT_ADDRESS } = JSON.parse(readFileSync(file, "utf8"));
    // the hardhat node forgets everything on restart, so the file alone proves nothing
    return (await ethers.provider.getCode(CHECKOUT_ADDRESS)) !== "0x";
  } catch {
    return false;
  }
}

async function main() {
  // on a chain that persists, deploying again would replace the token and wipe every balance
  if (await alreadyDeployed()) {
    console.log("contracts already on this chain, keeping them");
    return;
  }

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

  // same three demo customers as the stage A simulator, on hardhat accounts #2-#4
  const customers: [string, string, number][] = [
    ["USR-001", "105.50", 20], // subscriber, can overdraw 20
    ["USR-002", "62.00", 0],   // not a subscriber
    ["USR-003", "210.75", 50], // subscriber, can overdraw 50
  ];
  const signers = await ethers.getSigners();
  for (const [i, [userId, balance, limit]] of customers.entries()) {
    const addr = signers[i + 2].address;
    await (await token.mint(addr, ethers.parseUnits(balance, 18))).wait();
    if (limit > 0) await (await token.addSubscriber(addr, limit)).wait();
    console.log(`${userId} ${addr} balance ${balance}${limit ? `, overdraft ${limit}` : ""}`);
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
