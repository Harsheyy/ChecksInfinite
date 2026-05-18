// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface ITokenStrategy {
    function nftForSale(uint256 tokenId) external view returns (uint256);
    function sellTargetNFT(uint256 payableAmount, uint256 tokenId) external payable;
}

interface IChecks {
    function composite(uint256 tokenId, uint256 burnId, bool swap) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/// @title ChecksRecipeMinter
/// @notice Atomically buys 4 Checks tokens from the TokenStrategy contract and
///         composites them into a single ABCD output in one transaction.
contract ChecksRecipeMinter is Ownable, ReentrancyGuard, IERC721Receiver {
    ITokenStrategy public constant TOKEN_STRATEGY =
        ITokenStrategy(0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc);
    IChecks public constant CHECKS =
        IChecks(0x036721e5A769Cc48B3189EFbb9ccE4471E8A48B1);
    uint256 public constant MAX_FEE = 0.05 ether;

    uint256 public serviceFee = 0.005 ether;
    address public feeRecipient;

    error InsufficientPayment(uint256 required, uint256 sent);
    error FeeAboveMax(uint256 requested, uint256 max);
    error FeeTransferFailed();
    error RefundFailed();
    error ZeroAddress();

    constructor(address _feeRecipient) Ownable(msg.sender) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = _feeRecipient;
    }

    /// @notice Quote the total ETH required to mint a recipe.
    /// @return totalCost The total ETH the user must send (tokenCost + serviceFee)
    /// @return tokenCost The combined listing price of the 4 tokens
    /// @return fee The current service fee
    function quote(uint256 k1, uint256 b1, uint256 k2, uint256 b2)
        external view returns (uint256 totalCost, uint256 tokenCost, uint256 fee)
    {
        tokenCost = TOKEN_STRATEGY.nftForSale(k1)
                  + TOKEN_STRATEGY.nftForSale(b1)
                  + TOKEN_STRATEGY.nftForSale(k2)
                  + TOKEN_STRATEGY.nftForSale(b2);
        fee = serviceFee;
        totalCost = tokenCost + fee;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
