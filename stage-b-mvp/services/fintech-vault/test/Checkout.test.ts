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

  it("fails without moving funds when a non-subscriber is short", async () => {
    const { alice, token, checkout } = await deploy();
    await token.mint(alice.address, spmt(10));

    await expect(checkout.processCheckout(alice.address, spmt(30), ethers.ZeroHash))
      .to.emit(checkout, "CheckoutFailed");
    expect(await token.balanceOf(alice.address)).to.equal(spmt(10));
  });

  it("lets a subscriber overdraw up to their limit", async () => {
    const { store, alice, token, checkout } = await deploy();
    await token.mint(alice.address, spmt(10));
    await token.addSubscriber(alice.address, 20);

    await expect(checkout.processCheckout(alice.address, spmt(25), ethers.ZeroHash))
      .to.emit(token, "OverdraftUsed").withArgs(alice.address, spmt(15), spmt(15));
    expect(await token.balanceOf(alice.address)).to.equal(0);
    expect(await token.overdraftOwed(alice.address)).to.equal(spmt(15));
    expect(await token.balanceOf(store.address)).to.equal(spmt(25));
  });

  it("rejects a subscriber past their remaining overdraft", async () => {
    const { alice, token, checkout } = await deploy();
    await token.addSubscriber(alice.address, 20);
    await checkout.processCheckout(alice.address, spmt(15), ethers.ZeroHash);

    // 5 left of the 20 limit
    await expect(checkout.processCheckout(alice.address, spmt(6), ethers.ZeroHash))
      .to.emit(checkout, "CheckoutFailed");
    expect(await token.overdraftOwed(alice.address)).to.equal(spmt(15));
  });

  it("repaying an overdraft burns the store's minted tokens", async () => {
    const { store, alice, token, checkout } = await deploy();
    await token.addSubscriber(alice.address, 20);
    await checkout.processCheckout(alice.address, spmt(15), ethers.ZeroHash);

    await token.repayOverdraft(alice.address, spmt(15));
    expect(await token.overdraftOwed(alice.address)).to.equal(0);
    expect(await token.balanceOf(store.address)).to.equal(0);
  });

  it("only the checkout contract can call pay", async () => {
    const { owner, alice, token } = await deploy();
    await expect((token.connect(owner) as typeof token).pay(alice.address, 1)).to.be.revertedWith("only checkout contract");
  });

  it("only the owner can run checkouts", async () => {
    const { alice, checkout } = await deploy();
    await expect((checkout.connect(alice) as typeof checkout).processCheckout(alice.address, 1, ethers.ZeroHash))
      .to.be.revertedWith("not owner");
  });
});
