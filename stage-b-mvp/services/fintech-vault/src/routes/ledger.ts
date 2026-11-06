import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { provider, checkoutAddress, latestBlock } from '../chain';
import CheckoutABI from '../../artifacts/contracts/Checkout.sol/Checkout.json';

const router = Router();

// besu refuses a log query wider than this. hardhat only mines on demand, but a chain with a
// steady block time would lose its purchase history in minutes with a much smaller window
const BLOCK_WINDOW = 5000;

// GET /api/ledger?limit=20&page=0
// reads Purchase events directly from the chain, no off-chain DB needed
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const blockNumber = await latestBlock();

    // scan recent blocks for purchase events
    // in production this would use an indexer like The Graph instead of scanning
    const fromBlock = Math.max(0, blockNumber - BLOCK_WINDOW);
    const checkout = new ethers.Contract(checkoutAddress, CheckoutABI.abi, provider);

    const filter = checkout.filters.Purchase();
    const events = await checkout.queryFilter(filter, fromBlock, 'latest');

    // most recent first
    const reversed = [...events].reverse().slice(0, limit);

    const txs = await Promise.all(
      reversed.map(async (e: any) => {
        const block = await provider.getBlock(e.blockNumber);
        return {
          hash: e.transactionHash,
          blockNumber: e.blockNumber,
          customer: e.args.customer,
          amount: ethers.formatUnits(e.args.amount, 18),
          cartHash: e.args.cartHash,
          timestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
        };
      }),
    );

    res.json({ blockNumber, transactions: txs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
