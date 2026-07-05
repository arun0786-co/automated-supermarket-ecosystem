import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { signer, tokenAddress } from '../chain';
import { isAddress, parseAmount } from '../validate';
import SPMTTokenABI from '../../artifacts/contracts/SPMTToken.sol/SPMTToken.json';

const router = Router();

function getToken() {
  return new ethers.Contract(tokenAddress, SPMTTokenABI.abi, signer);
}

// GET /api/wallet/:address — returns SPMT balance for an address
router.get('/:address', async (req: Request, res: Response) => {
  if (!isAddress(req.params.address)) return res.status(400).json({ error: 'invalid address' });
  try {
    const token = getToken();
    const balance = await token.balanceOf(req.params.address);
    const overdraftOwed = await token.overdraftOwed(req.params.address);
    const isSubscriber = await token.isSubscriber(req.params.address);
    const overdraftLimit = await token.overdraftLimit(req.params.address);
    res.json({
      address: req.params.address,
      balance: ethers.formatUnits(balance, 18),
      overdraftOwed: ethers.formatUnits(overdraftOwed, 18),
      isSubscriber,
      overdraftLimit: ethers.formatUnits(overdraftLimit, 18),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wallet/mint — admin only, adds SPMT when customer tops up via fiat
router.post('/mint', async (req: Request, res: Response) => {
  // stop-gap until the gateway does JWT: a shared admin token, mint is off without one
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.headers.authorization !== `Bearer ${adminToken}`) {
    return res.status(403).json({ error: 'admin token required' });
  }
  const { to, amount } = req.body;
  const wei = parseAmount(amount);
  if (!isAddress(to) || wei === null) return res.status(400).json({ error: 'to address and a positive amount required' });
  try {
    const token = getToken();
    const tx = await token.mint(to, wei);
    await tx.wait();
    res.json({ ok: true, hash: tx.hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
