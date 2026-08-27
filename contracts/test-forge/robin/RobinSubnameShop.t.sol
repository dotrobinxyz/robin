//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {RobinFixture} from "./RobinFixture.sol";
import {RobinSubnameShop, IERC20Minimal} from "../../contracts/robin/RobinSubnameShop.sol";
import {CANNOT_UNWRAP, PARENT_CANNOT_CONTROL, CAN_EXTEND_EXPIRY, CAN_DO_EVERYTHING} from "../../contracts/wrapper/INameWrapper.sol";

contract ReentrantSeller {
    RobinSubnameShop shop;
    bytes32 node;
    bool attacked;

    function arm(RobinSubnameShop _shop, bytes32 _node) external {
        shop = _shop;
        node = _node;
    }

    receive() external payable {
        if (!attacked && address(shop) != address(0)) {
            attacked = true;
            // Try to reenter the shop mid-payout.
            shop.buyWithETH{value: msg.value}(node, "reenter");
        }
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

contract RobinSubnameShopTest is RobinFixture {
    uint256 constant YEAR = 365 days;
    RobinSubnameShop shop;
    bytes32 parentNode;

    address treasurySafe = makeAddr("treasurySafe");
    address buyer = makeAddr("buyer");

    function setUp() public override {
        super.setUp();
        shop = new RobinSubnameShop(
            wrapper,
            IERC20Minimal(address(usdg)),
            treasurySafe,
            address(resolver)
        );

        // alice registers + wraps + locks "goldfinch"
        _registerETH(alice, "goldfinch", YEAR);
        parentNode = _robinNode("goldfinch");
        vm.startPrank(alice);
        registrar.setApprovalForAll(address(wrapper), true);
        wrapper.wrapETH2LD("goldfinch", alice, uint16(CAN_DO_EVERYTHING), address(0));
        wrapper.setFuses(parentNode, uint16(CANNOT_UNWRAP));
        wrapper.setApprovalForAll(address(shop), true);
        vm.stopPrank();

        vm.deal(buyer, 10 ether);
        usdg.mint(buyer, 1_000e6);
    }

    function _open(uint256 pUSDG, uint256 pETH) internal {
        vm.prank(alice);
        shop.openShop(parentNode, pUSDG, pETH);
    }

    // ------------------------------------------------------------------
    // listing
    // ------------------------------------------------------------------

    function test_openShop_happy() public {
        _open(10e6, 0.01 ether);
        (address seller, uint256 pU, uint256 pE) = shop.listings(parentNode);
        assertEq(seller, alice);
        assertEq(pU, 10e6);
        assertEq(pE, 0.01 ether);
    }

    function test_openShop_rejectsNonOwner() public {
        vm.prank(bob);
        vm.expectRevert(RobinSubnameShop.NotParentOwner.selector);
        shop.openShop(parentNode, 10e6, 0);
    }

    function test_openShop_rejectsUnlockedParent() public {
        _registerETH(bob, "unlockedname", YEAR);
        bytes32 node = _robinNode("unlockedname");
        vm.startPrank(bob);
        registrar.setApprovalForAll(address(wrapper), true);
        wrapper.wrapETH2LD("unlockedname", bob, uint16(CAN_DO_EVERYTHING), address(0));
        wrapper.setApprovalForAll(address(shop), true);
        vm.expectRevert(RobinSubnameShop.ParentNotLocked.selector);
        shop.openShop(node, 10e6, 0);
        vm.stopPrank();
    }

    function test_openShop_rejectsWithoutApproval() public {
        vm.prank(alice);
        wrapper.setApprovalForAll(address(shop), false);
        vm.prank(alice);
        vm.expectRevert(RobinSubnameShop.ShopNotApproved.selector);
        shop.openShop(parentNode, 10e6, 0);
    }

    function test_openShop_rejectsNoPrices() public {
        vm.prank(alice);
        vm.expectRevert(RobinSubnameShop.NoPricesSet.selector);
        shop.openShop(parentNode, 0, 0);
    }

    function test_closeShop() public {
        _open(10e6, 0);
        vm.prank(alice);
        shop.closeShop(parentNode);
        vm.prank(buyer);
        vm.expectRevert(RobinSubnameShop.NoActiveShop.selector);
        shop.buyWithUSDG(parentNode, "x");
    }

    // ------------------------------------------------------------------
    // buying — ETH
    // ------------------------------------------------------------------

    function test_buyETH_mintsEmancipatedToBuyer_andSplits() public {
        _open(0, 1 ether);
        uint256 aliceBefore = alice.balance;

        vm.prank(buyer);
        bytes32 child = shop.buyWithETH{value: 1 ether}(parentNode, "bot1");

        // ownership + fuses
        (address owner, uint32 fuses, uint64 expiry) = wrapper.getData(uint256(child));
        assertEq(owner, buyer);
        assertTrue(fuses & PARENT_CANNOT_CONTROL != 0);
        assertTrue(fuses & CAN_EXTEND_EXPIRY != 0);
        (, , uint64 parentExpiry) = wrapper.getData(uint256(parentNode));
        assertEq(expiry, parentExpiry);
        // resolver preset so the buyer can set records immediately
        assertEq(registry.resolver(child), address(resolver));

        // 90/10 split
        assertEq(treasurySafe.balance, 0.1 ether);
        assertEq(alice.balance, aliceBefore + 0.9 ether);
    }

    function test_buyETH_wrongValue() public {
        _open(0, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(RobinSubnameShop.WrongPayment.selector);
        shop.buyWithETH{value: 0.5 ether}(parentNode, "bot1");
    }

    function test_buyETH_currencyDisabled() public {
        _open(10e6, 0);
        vm.prank(buyer);
        vm.expectRevert(RobinSubnameShop.CurrencyDisabled.selector);
        shop.buyWithETH{value: 1 ether}(parentNode, "bot1");
    }

    function test_buy_staleSellerAfterTransfer() public {
        _open(0, 1 ether);
        vm.prank(alice);
        wrapper.safeTransferFrom(alice, bob, uint256(parentNode), 1, "");
        vm.prank(buyer);
        vm.expectRevert(RobinSubnameShop.StaleSeller.selector);
        shop.buyWithETH{value: 1 ether}(parentNode, "bot1");
    }

    function test_buy_subnameTaken() public {
        _open(0, 1 ether);
        // alice mints "bot1" herself first
        vm.prank(alice);
        wrapper.setSubnodeOwner(parentNode, "bot1", alice, 0, 0);
        vm.prank(buyer);
        vm.expectRevert(RobinSubnameShop.SubnameTaken.selector);
        shop.buyWithETH{value: 1 ether}(parentNode, "bot1");
    }

    function test_buy_invalidLabels() public {
        _open(0, 1 ether);
        vm.startPrank(buyer);
        vm.expectRevert(RobinSubnameShop.InvalidLabel.selector);
        shop.buyWithETH{value: 1 ether}(parentNode, "");
        vm.expectRevert(RobinSubnameShop.InvalidLabel.selector);
        shop.buyWithETH{value: 1 ether}(parentNode, "a.b");
        vm.expectRevert(RobinSubnameShop.InvalidLabel.selector);
        shop.buyWithETH{value: 1 ether}(parentNode, "a b");
        vm.stopPrank();
    }

    function test_buy_revokedApprovalReverts() public {
        _open(0, 1 ether);
        vm.prank(alice);
        wrapper.setApprovalForAll(address(shop), false);
        vm.prank(buyer);
        vm.expectRevert(); // wrapper: unauthorised
        shop.buyWithETH{value: 1 ether}(parentNode, "bot1");
    }

    function test_buyETH_reentrancyBlocked() public {
        // seller is a contract that tries to reenter on payout
        ReentrantSeller evil = new ReentrantSeller();
        vm.deal(address(evil), 1 ether);
        _registerETH(address(evil), "evilseller", YEAR);
        bytes32 node = _robinNode("evilseller");
        vm.startPrank(address(evil));
        registrar.setApprovalForAll(address(wrapper), true);
        wrapper.wrapETH2LD("evilseller", address(evil), uint16(CAN_DO_EVERYTHING), address(0));
        wrapper.setFuses(node, uint16(CANNOT_UNWRAP));
        wrapper.setApprovalForAll(address(shop), true);
        shop.openShop(node, 0, 1 ether);
        vm.stopPrank();
        evil.arm(shop, node);

        // The reentrant inner call reverts (nonReentrant), which bubbles up
        // through the seller's receive() and fails the whole purchase — no
        // partial state, no double mint.
        vm.prank(buyer);
        vm.expectRevert();
        shop.buyWithETH{value: 1 ether}(node, "bot1");
    }

    // ------------------------------------------------------------------
    // buying — USDG
    // ------------------------------------------------------------------

    function test_buyUSDG_happyAndSplit() public {
        _open(15e6, 0); // $15 → fee $1.50
        uint256 treasuryBefore = usdg.balanceOf(treasurySafe);
        uint256 aliceBefore = usdg.balanceOf(alice);

        vm.startPrank(buyer);
        usdg.approve(address(shop), 15e6);
        bytes32 child = shop.buyWithUSDG(parentNode, "team");
        vm.stopPrank();

        (address owner, , ) = wrapper.getData(uint256(child));
        assertEq(owner, buyer);
        assertEq(usdg.balanceOf(treasurySafe) - treasuryBefore, 15e5); // $1.50
        assertEq(usdg.balanceOf(alice) - aliceBefore, 135e5); // $13.50
    }

    function test_buyUSDG_withoutAllowanceReverts() public {
        _open(15e6, 0);
        vm.prank(buyer);
        vm.expectRevert();
        shop.buyWithUSDG(parentNode, "team");
    }

    // ------------------------------------------------------------------
    // buyer sovereignty
    // ------------------------------------------------------------------

    function test_parentCannotRevokeSoldSubname() public {
        _open(0, 1 ether);
        vm.prank(buyer);
        bytes32 child = shop.buyWithETH{value: 1 ether}(parentNode, "mine");

        vm.prank(alice);
        vm.expectRevert();
        wrapper.setSubnodeOwner(parentNode, "mine", alice, 0, 0);

        (address owner, , ) = wrapper.getData(uint256(child));
        assertEq(owner, buyer);
    }

    function test_buyerCanExtendAfterParentRenews() public {
        _open(0, 1 ether);
        vm.prank(buyer);
        bytes32 child = shop.buyWithETH{value: 1 ether}(parentNode, "mine");
        (, , uint64 expiryBefore) = wrapper.getData(uint256(child));

        // parent renews a year via the controller
        (uint256 base, ) = _rentPriceETH("goldfinch", YEAR);
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        controller.renew{value: base}("goldfinch", YEAR, bytes32(0));

        (, , uint64 parentExpiry) = wrapper.getData(uint256(parentNode));
        vm.prank(buyer);
        wrapper.extendExpiry(parentNode, keccak256("mine"), parentExpiry);
        (, , uint64 expiryAfter) = wrapper.getData(uint256(child));
        assertGt(expiryAfter, expiryBefore);
    }

    function _rentPriceETH(
        string memory label,
        uint256 duration
    ) internal view returns (uint256 base, uint256 premium) {
        (base, premium) = _price(label, duration);
    }

    function _price(
        string memory label,
        uint256 duration
    ) internal view returns (uint256, uint256) {
        // controller.rentPrice returns an IPriceOracle.Price struct
        (bool ok, bytes memory ret) = address(controller).staticcall(
            abi.encodeWithSignature("rentPrice(string,uint256)", label, duration)
        );
        require(ok, "rentPrice failed");
        (uint256 base, uint256 premium) = abi.decode(ret, (uint256, uint256));
        return (base, premium);
    }
}
