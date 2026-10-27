import { expect } from "chai";
import { ethers } from "hardhat";

const spmt = (n: number) => ethers.parseUnits(String(n), 18);

async function deploy() {
  const [owner, store, alice, bob] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("SPMTToken")).deploy(store.address);
  const checkout = await (await ethers.getContractFactory("Checkout")).deploy(await token.getAddress());
  await token.setCheckout(await checkout.getAddress());
  return { owner, store, alice, bob, token, checkout };
}

describe("Checkout", () => {
  it("charges a customer with enough balance", async () => {
    const { store, alice, token, checkout } = await deploy();
    await token.mint(alice.address, spmt(100));

    await expect(checkout.processCheckout(alice.address, spmt(30), ethers.ZeroHash))
      .to.emit(checkout, "Purchase");
    expect(await token.balanceOf(alice.address)).to.equal(spmt(70));
    expect(await token.balanceOf(store.address)).to.equal(spmt(30));
  });
});
