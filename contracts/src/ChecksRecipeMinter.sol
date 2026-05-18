// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface ITokenStrategy {
    function nftForSale(uint256 tokenId) external view returns (uint256);
    function sellTargetNFT(uint256 tokenId) external payable;
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

    event RecipeMinted(
        address indexed minter,
        uint256 indexed abcdTokenId,
        uint256 b1,
        uint256 k2,
        uint256 b2,
        uint256 tokenCost,
        uint256 fee
    );
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event ServiceFeeUpdated(uint256 oldFee, uint256 newFee);

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

    /// @notice Buy 4 Checks tokens and composite them into a single ABCD output.
    /// @dev The token surviving all 3 composites is `k1` — that is the token transferred to the caller.
    function mintRecipe(uint256 k1, uint256 b1, uint256 k2, uint256 b2)
        external payable nonReentrant
    {
        uint256 p1 = TOKEN_STRATEGY.nftForSale(k1);
        uint256 p2 = TOKEN_STRATEGY.nftForSale(b1);
        uint256 p3 = TOKEN_STRATEGY.nftForSale(k2);
        uint256 p4 = TOKEN_STRATEGY.nftForSale(b2);
        uint256 tokenCost = p1 + p2 + p3 + p4;
        uint256 required = tokenCost + serviceFee;

        if (msg.value < required) revert InsufficientPayment(required, msg.value);

        TOKEN_STRATEGY.sellTargetNFT{value: p1}(k1);
        TOKEN_STRATEGY.sellTargetNFT{value: p2}(b1);
        TOKEN_STRATEGY.sellTargetNFT{value: p3}(k2);
        TOKEN_STRATEGY.sellTargetNFT{value: p4}(b2);

        CHECKS.composite(k1, b1, false);
        CHECKS.composite(k2, b2, false);
        CHECKS.composite(k1, k2, false);

        CHECKS.safeTransferFrom(address(this), msg.sender, k1);

        (bool feeOk,) = feeRecipient.call{value: serviceFee}("");
        if (!feeOk) revert FeeTransferFailed();

        uint256 excess = msg.value - required;
        if (excess > 0) {
            (bool refundOk,) = msg.sender.call{value: excess}("");
            if (!refundOk) revert RefundFailed();
        }

        emit RecipeMinted(msg.sender, k1, b1, k2, b2, tokenCost, serviceFee);
    }

    /// @notice Update the address that receives the service fee.
    function setFeeRecipient(address _newRecipient) external onlyOwner {
        if (_newRecipient == address(0)) revert ZeroAddress();
        address old = feeRecipient;
        feeRecipient = _newRecipient;
        emit FeeRecipientUpdated(old, _newRecipient);
    }

    /// @notice Update the service fee. Cannot exceed `MAX_FEE`.
    function setServiceFee(uint256 _newFee) external onlyOwner {
        if (_newFee > MAX_FEE) revert FeeAboveMax(_newFee, MAX_FEE);
        uint256 old = serviceFee;
        serviceFee = _newFee;
        emit ServiceFeeUpdated(old, _newFee);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
