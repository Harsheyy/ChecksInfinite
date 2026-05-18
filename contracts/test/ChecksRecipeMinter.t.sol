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
}
