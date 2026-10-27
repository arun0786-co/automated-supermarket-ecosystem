// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SPMTToken.sol";

// checkout contract, called by the backend API after verifying the cart total
// keeps the payment logic on-chain so the store can't tamper with it after deployment
// in production this would be called via a relayer (meta-transactions) so customers
// don't need ETH for gas
contract Checkout {
    SPMTToken public token;
    address public owner;

    // one event per successful purchase, indexed by customer for easy filtering
    event Purchase(
        address indexed customer,
        uint256 amount,
        uint256 blockNumber,
        bytes32 cartHash   // keccak256 of the cart item list for audit trail
    );

    event CheckoutFailed(address indexed customer, uint256 amount, string reason);

    constructor(address tokenAddress) {
        token = SPMTToken(tokenAddress);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    // cartHash is keccak256(abi.encodePacked(itemSkus, quantities)), computed off-chain by backend
    // storing it on-chain gives us an immutable audit trail matching receipt to on-chain tx
    function processCheckout(
        address customer,
        uint256 amount,
        bytes32 cartHash
    ) external onlyOwner returns (bool) {
        bool success = token.pay(customer, amount);
        if (success) {
            emit Purchase(customer, amount, block.number, cartHash);
        } else {
            emit CheckoutFailed(customer, amount, "insufficient funds or overdraft limit reached");
        }
        return success;
    }
}
