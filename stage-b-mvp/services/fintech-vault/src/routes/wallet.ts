import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { signer } from '../chain';
import SPMTTokenABI from '../../artifacts/contracts/SPMTToken.sol/SPMTToken.json';

const router = Router();

// load contract address from env — set by deploy script output
const tokenAddress = process.env.SPMT_TOKEN_ADDRESS!;

function getToken() {
  return new ethers.Contract(tokenAddress, SPMTTokenABI.abi, signer);
}

// GET /api/wallet/:address — returns SPMT balance for an address
router.get('/:address', async (req: Request, res: Response) => {
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
  const { to, amount } = req.body;
  if (!to || !amount) return res.status(400).json({ error: 'to and amount required' });
  try {
    const token = getToken();
    const tx = await token.mint(to, ethers.parseUnits(String(amount), 18));
    await tx.wait();
    res.json({ ok: true, hash: tx.hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
