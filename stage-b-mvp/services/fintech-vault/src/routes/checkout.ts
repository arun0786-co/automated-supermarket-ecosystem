import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { signer, checkoutAddress } from '../chain';
import CheckoutABI from '../../artifacts/contracts/Checkout.sol/Checkout.json';

const router = Router();

function getCheckout() {
  return new ethers.Contract(checkoutAddress, CheckoutABI.abi, signer);
}

// POST /api/checkout
// body: { customer: "0x...", amount: "12.50", cartItems: [...] }
// cartItems is used to compute the cart hash stored on-chain for the audit trail
router.post('/', async (req: Request, res: Response) => {
  const { customer, amount, cartItems } = req.body;
  if (!customer || !amount) {
    return res.status(400).json({ error: 'customer and amount required' });
  }

  try {
    // build the cart hash — keccak256 of sorted SKUs so order doesn't matter
    const skus = (cartItems ?? []).map((i: any) => i.sku).sort().join(',');
    const cartHash = ethers.keccak256(ethers.toUtf8Bytes(skus));

    const checkout = getCheckout();
    const amountInWei = ethers.parseUnits(String(amount), 18);

    const tx = await checkout.processCheckout(customer, amountInWei, cartHash);
    const receipt = await tx.wait();

    // find the Purchase event in the receipt to confirm success
    const purchaseEvent = receipt.logs
      .map((log: any) => { try { return checkout.interface.parseLog(log); } catch { return null; } })
      .find((e: any) => e?.name === 'Purchase');

    if (purchaseEvent) {
      res.json({ ok: true, hash: tx.hash, blockNumber: receipt.blockNumber, cartHash });
    } else {
      // transaction mined but Purchase event not emitted — means CheckoutFailed was emitted
      res.json({ ok: false, hash: tx.hash, reason: 'insufficient funds or overdraft limit reached' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
