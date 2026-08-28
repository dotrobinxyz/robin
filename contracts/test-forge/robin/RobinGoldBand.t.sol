// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {RobinFixture} from "./RobinFixture.sol";
import {RobinGoldBand, IERC20Minimal, IAggregatorMinimal} from "../../contracts/robin/RobinGoldBand.sol";
import {RobinBurnVault} from "../../contracts/robin/RobinBurnVault.sol";

contract RobinGoldBandTest is RobinFixture {
    RobinGoldBand gold;
    RobinBurnVault vault;
    address treasury = makeAddr("goldTreasury");
    address vaultSafe = makeAddr("vaultSafe");

    bytes32 constant NODE = keccak256("some-node");

    function setUp() public override {
        super.setUp();
        vault = new RobinBurnVault(vaultSafe);
        gold = new RobinGoldBand(
            treasury,
            address(vault),
            IERC20Minimal(address(usdg)),
            IAggregatorMinimal(address(feed)),
            MAX_FEED_AGE
        );
        vm.prank(alice);
        usdg.approve(address(gold), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // pricing
    // ------------------------------------------------------------------

    function test_priceInUSDG_month_exact() public view {
        assertEq(gold.priceInUSDG(1, false), 6_990_000); // $6.99
        assertEq(gold.priceInUSDG(3, false), 20_970_000);
    }

    function test_priceInUSDG_year_exact() public view {
        assertEq(gold.priceInUSDG(1, true), 50_000_000); // $50
        assertEq(gold.priceInUSDG(2, true), 100_000_000);
    }

    function test_priceInWei_tracks_feed() public {
        // wei = attoUSD * 1e8 / answer, ceil.
        (, int256 answer, , , ) = feed.latestRoundData();
        uint256 expected = (6.99e18 * 1e8 + uint256(answer) - 1) / uint256(answer);
        assertEq(gold.priceInWei(1, false), expected);
    }

    function test_priceInWei_reverts_on_stale_feed() public {
        feed.setUpdatedAt(block.timestamp - MAX_FEED_AGE - 1);
        vm.expectRevert(RobinGoldBand.StaleFeed.selector);
        gold.priceInWei(1, false);
    }

    function test_price_reverts_on_bad_periods() public {
        vm.expectRevert(RobinGoldBand.BadPeriods.selector);
        gold.priceInUSDG(0, false);
        vm.expectRevert(RobinGoldBand.BadPeriods.selector);
        gold.priceInUSDG(11, true);
    }

    // ------------------------------------------------------------------
    // USDG path
    // ------------------------------------------------------------------

    function test_extendWithUSDG_splits_and_activates() public {
        vm.prank(alice);
        gold.extendWithUSDG(NODE, 1, false);

        assertTrue(gold.isGold(NODE));
        assertEq(gold.goldUntil(NODE), block.timestamp + 30 days);
        // $6.99 → 3.495000 burn half, 3.495000 treasury half.
        assertEq(usdg.balanceOf(address(vault)), 3_495_000);
        assertEq(usdg.balanceOf(treasury), 3_495_000);
    }

    function test_extendWithUSDG_year() public {
        vm.prank(alice);
        gold.extendWithUSDG(NODE, 1, true);
        assertEq(gold.goldUntil(NODE), block.timestamp + 365 days);
        assertEq(usdg.balanceOf(address(vault)), 25_000_000);
        assertEq(usdg.balanceOf(treasury), 25_000_000);
    }

    function test_extend_stacks_from_current_expiry() public {
        vm.startPrank(alice);
        gold.extendWithUSDG(NODE, 1, false);
        uint256 first = gold.goldUntil(NODE);
        gold.extendWithUSDG(NODE, 2, false);
        vm.stopPrank();
        assertEq(gold.goldUntil(NODE), first + 60 days);
    }

    function test_extend_restarts_from_now_after_lapse() public {
        vm.prank(alice);
        gold.extendWithUSDG(NODE, 1, false);
        vm.warp(block.timestamp + 90 days);
        assertFalse(gold.isGold(NODE));
        vm.prank(alice);
        gold.extendWithUSDG(NODE, 1, false);
        assertEq(gold.goldUntil(NODE), block.timestamp + 30 days);
    }

    function test_gifting_any_payer_any_node() public {
        bytes32 other = keccak256("someone-elses-name");
        vm.prank(alice);
        gold.extendWithUSDG(other, 1, false);
        assertTrue(gold.isGold(other));
    }

    // ------------------------------------------------------------------
    // ETH path
    // ------------------------------------------------------------------

    function test_extendWithETH_splits_and_refunds_excess() public {
        uint256 amount = gold.priceInWei(1, false);
        uint256 burnHalf = amount / 2;
        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        gold.extendWithETH{value: amount + 0.5 ether}(NODE, 1, false);

        assertTrue(gold.isGold(NODE));
        assertEq(address(vault).balance, burnHalf);
        assertEq(treasury.balance, amount - burnHalf);
        // Overpayment refunded: alice only spent `amount`.
        assertEq(aliceBefore - alice.balance, amount);
        // Nothing stranded on the contract.
        assertEq(address(gold).balance, 0);
    }

    function test_extendWithETH_reverts_underpayment() public {
        uint256 amount = gold.priceInWei(1, true);
        vm.prank(alice);
        vm.expectRevert(RobinGoldBand.InsufficientPayment.selector);
        gold.extendWithETH{value: amount - 1}(NODE, 1, true);
    }

    function test_event_emitted() public {
        uint256 amount = gold.priceInUSDG(1, true);
        vm.expectEmit(true, true, false, true);
        emit RobinGoldBand.GoldExtended(
            NODE,
            block.timestamp + 365 days,
            alice,
            1,
            true,
            true,
            amount
        );
        vm.prank(alice);
        gold.extendWithUSDG(NODE, 1, true);
    }

    // ------------------------------------------------------------------
    // burn vault
    // ------------------------------------------------------------------

    function test_vault_receives_and_only_safe_executes() public {
        vm.prank(alice);
        gold.extendWithETH{value: gold.priceInWei(1, false)}(NODE, 1, false);
        uint256 pot = address(vault).balance;
        assertGt(pot, 0);

        address dead = 0x000000000000000000000000000000000000dEaD;
        vm.prank(alice);
        vm.expectRevert(RobinBurnVault.NotSafe.selector);
        vault.execute(dead, pot, "");

        vm.prank(vaultSafe);
        vault.execute(dead, pot, "");
        assertEq(address(vault).balance, 0);
        assertEq(dead.balance, pot);
    }

    function test_vault_executes_erc20_calls() public {
        vm.prank(alice);
        gold.extendWithUSDG(NODE, 1, false);
        uint256 pot = usdg.balanceOf(address(vault));

        vm.prank(vaultSafe);
        vault.execute(
            address(usdg),
            0,
            abi.encodeWithSignature("transfer(address,uint256)", vaultSafe, pot)
        );
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(vaultSafe), pot);
    }
}
