// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ChecksRecipeMinter} from "../src/ChecksRecipeMinter.sol";

contract ChecksRecipeMinterTest is Test {
    ChecksRecipeMinter minter;
    address owner = address(0x0FFE);
    address feeRecipient = address(0xFEE);

    function setUp() public {
        vm.createSelectFork(vm.envString("MAINNET_RPC_URL"));
        vm.prank(owner);
        minter = new ChecksRecipeMinter(feeRecipient);
    }

    function test_constructor_setsFeeRecipient() public view {
        assertEq(minter.feeRecipient(), feeRecipient);
    }

    function test_constructor_setsOwnerToDeployer() public view {
        assertEq(minter.owner(), owner);
    }

    function test_constructor_initialServiceFeeIs005Eth() public view {
        assertEq(minter.serviceFee(), 0.005 ether);
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(ChecksRecipeMinter.ZeroAddress.selector);
        new ChecksRecipeMinter(address(0));
    }

    // 4 currently-listed 80-check tokens on mainnet (verified 2026-05-17)
    uint256 constant K1 = 3960;
    uint256 constant B1 = 2243;
    uint256 constant K2 = 15081;
    uint256 constant B2 = 3637;

    function test_quote_returnsTokenCostPlusFee() public view {
        (uint256 total, uint256 tokenCost, uint256 fee) = minter.quote(K1, B1, K2, B2);
        assertEq(fee, 0.005 ether);
        assertGt(tokenCost, 0);
        assertEq(total, tokenCost + fee);
    }

    // Minimal interface for the Checks ERC-721 read calls used in tests.
    function _checksOwnerOf(uint256 tokenId) internal view returns (address) {
        (bool ok, bytes memory data) = address(minter.CHECKS()).staticcall(
            abi.encodeWithSignature("ownerOf(uint256)", tokenId)
        );
        require(ok, "ownerOf failed");
        return abi.decode(data, (address));
    }

    function test_mintRecipe_happyPath_userReceivesAbcdAndFeeIsForwarded() public {
        address user = address(0xA11CE);
        (uint256 total,, uint256 fee) = minter.quote(K1, B1, K2, B2);
        vm.deal(user, total);
        uint256 feeBalanceBefore = feeRecipient.balance;

        vm.prank(user);
        minter.mintRecipe{value: total}(K1, B1, K2, B2);

        // User owns the final ABCD token (which is k1 after 3 composites)
        assertEq(_checksOwnerOf(K1), user);
        // Fee recipient received the service fee
        assertEq(feeRecipient.balance - feeBalanceBefore, fee);
    }
}
