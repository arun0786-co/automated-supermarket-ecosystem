// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// $SPMT token, pegged 1:1 to local fiat (chapter 6 of the spec)
// store keeps a reserve fund that backs every token in circulation
// using openzeppelin ERC20 as the base since i don't want to rewrite transfer logic from scratch
contract SPMTToken is ERC20, Ownable {
    // store wallet address that receives payment during checkout
    address public storeWallet;
    // track which wallets are subscribers (enables overdraft)
    mapping(address => bool) public isSubscriber;
    // subscriber overdraft limit in SPMT (18 decimals)
    mapping(address => uint256) public overdraftLimit;
    // current overdraft balances, how much each subscriber owes
    mapping(address => uint256) public overdraftOwed;

    // the only contract allowed to call pay(). set once Checkout is deployed
    address public checkoutContract;

    event SubscriberAdded(address indexed user, uint256 limit);
    event CheckoutContractSet(address checkout);
    event OverdraftUsed(address indexed user, uint256 amount, uint256 totalOwed);

    constructor(address _storeWallet) ERC20("SupermarketToken", "SPMT") Ownable(msg.sender) {
        storeWallet = _storeWallet;
    }

    modifier onlyCheckout() {
        require(msg.sender == checkoutContract, "only checkout contract");
        _;
    }

    function setCheckout(address checkout) external onlyOwner {
        checkoutContract = checkout;
        emit CheckoutContractSet(checkout);
    }

    // mint is only called by the owner (store admin) when a customer tops up via fiat
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // register a customer as a subscriber with a personal overdraft limit
    function addSubscriber(address user, uint256 limitInSPMT) external onlyOwner {
        isSubscriber[user] = true;
        // store limit in token units (18 decimals)
        overdraftLimit[user] = limitInSPMT * 10 ** decimals();
        emit SubscriberAdded(user, limitInSPMT);
    }

    // checkout is called by the Checkout contract, not directly by customers
    // this function handles both normal payment and subscriber overdraft
    function pay(address from, uint256 amount) external onlyCheckout returns (bool) {
        uint256 balance = balanceOf(from);
        if (balance >= amount) {
            // normal case, enough tokens in wallet
            _transfer(from, storeWallet, amount);
            return true;
        }
        if (isSubscriber[from]) {
            // subscriber overdraft, check how much headroom they have left
            uint256 shortfall = amount - balance;
            uint256 remainingLimit = overdraftLimit[from] - overdraftOwed[from];
            if (shortfall <= remainingLimit) {
                if (balance > 0) {
                    _transfer(from, storeWallet, balance);
                }
                // mint the shortfall directly to the store, fiat recovery handles this later
                _mint(storeWallet, shortfall);
                overdraftOwed[from] += shortfall;
                emit OverdraftUsed(from, shortfall, overdraftOwed[from]);
                return true;
            }
        }
        return false;
    }

    // called when a subscriber pays off their overdraft via fiat top-up
    function repayOverdraft(address user, uint256 amount) external onlyOwner {
        require(overdraftOwed[user] >= amount, "amount exceeds owed");
        overdraftOwed[user] -= amount;
        // burn the tokens we minted during the overdraft since they're now backed by real fiat
        _burn(storeWallet, amount);
    }
}
