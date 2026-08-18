//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {RobinFixture} from "./RobinFixture.sol";
import {RobinRegistrarController} from "../../contracts/robin/RobinRegistrarController.sol";
import {IETHRegistrarController, IPriceOracle} from "../../contracts/ethregistrar/IETHRegistrarController.sol";
import {Resolver} from "../../contracts/resolvers/Resolver.sol";

contract RobinControllerTest is RobinFixture {
    string constant NAME5 = "goldfinch";
    uint256 constant YEAR = 365 days;

    // ------------------------------------------------------------------
    // availability / validity
    // ------------------------------------------------------------------

    function test_valid_lengths() public view {
        assertFalse(controller.valid("ab"));
        assertTrue(controller.valid("abc"));
        assertTrue(controller.valid(unicode"🐦🐦🐦")); // 3 unicode chars
        assertFalse(controller.valid(unicode"🐦🐦")); // 2 unicode chars
    }

    function test_available_reflectsRegistrationAndReservation() public {
        assertTrue(controller.available(NAME5));
        _registerETH(alice, NAME5, YEAR);
        assertFalse(controller.available(NAME5));

        string[] memory labels = new string[](1);
        labels[0] = "nvda";
        reserved.setReserved(labels, true);
        assertFalse(controller.available("nvda"));
        reserved.setReserved(labels, false);
        assertTrue(controller.available("nvda"));
    }

    function test_reservedName_cannotRegister_untilReleased() public {
        string[] memory labels = new string[](1);
        labels[0] = "nvda";
        reserved.setReserved(labels, true);

        IETHRegistrarController.Registration memory registration = _makeRegistration(
            "nvda",
            alice,
            YEAR,
            keccak256("s"),
            address(0),
            0
        );
        vm.prank(alice);
        controller.commit(controller.makeCommitment(registration));
        vm.warp(block.timestamp + MIN_COMMIT_AGE);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.NameNotAvailable.selector,
                "nvda"
            )
        );
        controller.register{value: 1 ether}(registration);

        // released → registerable
        reserved.setReserved(labels, false);
        vm.prank(alice);
        controller.register{value: 1 ether}(registration);
        assertEq(registrar.ownerOf(uint256(keccak256("nvda"))), alice);
    }

    function test_reservation_doesNotBlockRenewal() public {
        _registerETH(alice, NAME5, YEAR);
        string[] memory labels = new string[](1);
        labels[0] = NAME5;
        reserved.setReserved(labels, true);

        uint256 before = registrar.nameExpires(uint256(keccak256(bytes(NAME5))));
        IPriceOracle.Price memory price = controller.rentPrice(NAME5, YEAR);
        vm.prank(alice);
        controller.renew{value: price.base}(NAME5, YEAR, bytes32(0));
        assertEq(
            registrar.nameExpires(uint256(keccak256(bytes(NAME5)))),
            before + YEAR
        );
    }

    // ------------------------------------------------------------------
    // durations
    // ------------------------------------------------------------------

    function test_durationBounds() public {
        assertEq(controller.MIN_REGISTRATION_DURATION(), 28 days);
        IETHRegistrarController.Registration memory registration = _makeRegistration(
            NAME5,
            alice,
            27 days,
            keccak256("s"),
            address(0),
            0
        );
        // bad durations fail at registration (before any commitment checks —
        // makeCommitment is pure and cannot read the immutable minimum)
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.DurationTooShort.selector,
                27 days
            )
        );
        controller.register{value: 1 ether}(registration);

        registration.duration = 3651 days;
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.DurationTooLong.selector,
                3651 days
            )
        );
        controller.register{value: 100 ether}(registration);

        // renew cap in both currencies
        _registerETH(alice, NAME5, YEAR);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.DurationTooLong.selector,
                3651 days
            )
        );
        controller.renew{value: 100 ether}(NAME5, 3651 days, bytes32(0));

        vm.startPrank(alice);
        usdg.approve(address(controller), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.DurationTooLong.selector,
                3651 days
            )
        );
        controller.renewWithUSDG(NAME5, 3651 days, bytes32(0), type(uint256).max);
        vm.stopPrank();

        // 10 years exactly is allowed
        vm.prank(alice);
        controller.renew{value: 1 ether}(NAME5, 3650 days, bytes32(0));
    }

    // ------------------------------------------------------------------
    // ETH payment path
    // ------------------------------------------------------------------

    function test_registerETH_exactPriceAndRefund() public {
        IETHRegistrarController.Registration memory registration = _makeRegistration(
            NAME5,
            alice,
            YEAR,
            keccak256("s"),
            address(0),
            0
        );
        vm.prank(alice);
        controller.commit(controller.makeCommitment(registration));
        vm.warp(block.timestamp + MIN_COMMIT_AGE);

        IPriceOracle.Price memory price = controller.rentPrice(NAME5, YEAR);
        // $5/yr at $2000/ETH = 0.0025 ETH
        assertApproxEqAbs(price.base, 0.0025 ether, 1e6);
        assertEq(price.premium, 0);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        controller.register{value: price.base + 1 ether}(registration); // overpay
        // overpayment refunded
        assertEq(balBefore - alice.balance, price.base);
        assertEq(address(controller).balance, price.base);
        assertEq(registrar.ownerOf(uint256(keccak256(bytes(NAME5)))), alice);
        // label recorded for metadata
        assertEq(registrar.labels(uint256(keccak256(bytes(NAME5)))), NAME5);
    }

    function test_registerETH_insufficientValueReverts() public {
        IETHRegistrarController.Registration memory registration = _makeRegistration(
            NAME5,
            alice,
            YEAR,
            keccak256("s"),
            address(0),
            0
        );
        vm.prank(alice);
        controller.commit(controller.makeCommitment(registration));
        vm.warp(block.timestamp + MIN_COMMIT_AGE);
        IPriceOracle.Price memory price = controller.rentPrice(NAME5, YEAR);
        vm.prank(alice);
        vm.expectRevert(RobinRegistrarController.InsufficientValue.selector);
        controller.register{value: price.base - 1}(registration);
    }

    function test_commitReveal_timingEnforced() public {
        IETHRegistrarController.Registration memory registration = _makeRegistration(
            NAME5,
            alice,
            YEAR,
            keccak256("s"),
            address(0),
            0
        );
        bytes32 commitment = controller.makeCommitment(registration);

        // no commitment
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.CommitmentNotFound.selector,
                commitment
            )
        );
        controller.register{value: 1 ether}(registration);

        // too new
        vm.prank(alice);
        controller.commit(commitment);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.CommitmentTooNew.selector,
                commitment,
                block.timestamp + MIN_COMMIT_AGE,
                block.timestamp
            )
        );
        controller.register{value: 1 ether}(registration);

        // too old
        vm.warp(block.timestamp + MAX_COMMIT_AGE + 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.CommitmentTooOld.selector,
                commitment,
                block.timestamp - 1,
                block.timestamp
            )
        );
        controller.register{value: 1 ether}(registration);
    }

    function test_registerETH_withResolverRecordsAndReverse() public {
        bytes32 node = _robinNode(NAME5);
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeWithSignature(
            "setAddr(bytes32,address)",
            node,
            alice
        );
        data[1] = abi.encodeWithSignature(
            "setText(bytes32,string,string)",
            node,
            "com.twitter",
            "goldfinch"
        );

        IETHRegistrarController.Registration memory registration = IETHRegistrarController.Registration({
            label: NAME5,
            owner: alice,
            duration: YEAR,
            secret: keccak256("s"),
            resolver: address(resolver),
            data: data,
            reverseRecord: 1, // ethereum reverse bit
            referrer: bytes32(0)
        });
        vm.prank(alice);
        controller.commit(controller.makeCommitment(registration));
        vm.warp(block.timestamp + MIN_COMMIT_AGE);
        IPriceOracle.Price memory price = controller.rentPrice(NAME5, YEAR);
        vm.prank(alice);
        controller.register{value: price.base}(registration);

        // registry + resolver records
        assertEq(registry.owner(node), alice);
        assertEq(registry.resolver(node), address(resolver));
        assertEq(resolver.addr(node), alice);
        assertEq(resolver.text(node, "com.twitter"), "goldfinch");

        // reverse record: addr.reverse node for alice resolves to name
        bytes32 reverseNode = keccak256(
            abi.encodePacked(ADDR_REVERSE_NODE, _sha3HexAddress(alice))
        );
        assertEq(resolver.name(reverseNode), string.concat(NAME5, ".robin"));
    }

    // ------------------------------------------------------------------
    // USDG payment path
    // ------------------------------------------------------------------

    function test_registerUSDG_flatPrice() public {
        IPriceOracle.Price memory quote = controller.rentPriceUSDG(NAME5, YEAR);
        // $5.00 exactly (rate rounds to 5000000 with ceil)
        assertEq(quote.base, 5_000_000);
        assertEq(quote.premium, 0);

        uint256 balBefore = usdg.balanceOf(alice);
        _registerUSDG(alice, NAME5, YEAR);
        assertEq(balBefore - usdg.balanceOf(alice), 5_000_000);
        assertEq(usdg.balanceOf(address(controller)), 5_000_000);
        assertEq(registrar.ownerOf(uint256(keccak256(bytes(NAME5)))), alice);
    }

    function test_registerUSDG_pricesByLength() public {
        assertEq(controller.rentPriceUSDG("abc", YEAR).base, 100_000_000); // $100
        assertEq(controller.rentPriceUSDG("abcd", YEAR).base, 25_000_000); // $25
        assertEq(controller.rentPriceUSDG("abcde", YEAR).base, 5_000_000); // $5
        // multi-year scales linearly
        assertEq(
            controller.rentPriceUSDG("abc", 3 * YEAR).base,
            300_000_000
        );
    }

    function test_registerUSDG_capEnforced() public {
        IETHRegistrarController.Registration memory registration = _makeRegistration(
            NAME5,
            alice,
            YEAR,
            keccak256("s"),
            address(0),
            0
        );
        vm.prank(alice);
        controller.commit(controller.makeCommitment(registration));
        vm.warp(block.timestamp + MIN_COMMIT_AGE);

        vm.startPrank(alice);
        usdg.approve(address(controller), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinRegistrarController.MaxPriceExceeded.selector,
                5_000_000,
                4_999_999
            )
        );
        controller.registerWithUSDG(registration, 4_999_999);
        // exact cap passes
        controller.registerWithUSDG(registration, 5_000_000);
        vm.stopPrank();
        assertEq(registrar.ownerOf(uint256(keccak256(bytes(NAME5)))), alice);
    }

    function test_registerUSDG_withoutApprovalReverts() public {
        IETHRegistrarController.Registration memory registration = _makeRegistration(
            NAME5,
            alice,
            YEAR,
            keccak256("s"),
            address(0),
            0
        );
        vm.prank(alice);
        controller.commit(controller.makeCommitment(registration));
        vm.warp(block.timestamp + MIN_COMMIT_AGE);
        vm.prank(alice);
        vm.expectRevert();
        controller.registerWithUSDG(registration, type(uint256).max);
    }

    function test_renewUSDG() public {
        _registerUSDG(alice, NAME5, YEAR);
        uint256 id = uint256(keccak256(bytes(NAME5)));
        uint256 before = registrar.nameExpires(id);

        vm.startPrank(bob); // anyone can renew for a name
        usdg.approve(address(controller), 5_000_000);
        controller.renewWithUSDG(NAME5, YEAR, bytes32(0), 5_000_000);
        vm.stopPrank();
        assertEq(registrar.nameExpires(id), before + YEAR);
        assertEq(usdg.balanceOf(address(controller)), 10_000_000);
    }

    // ------------------------------------------------------------------
    // treasury
    // ------------------------------------------------------------------

    function test_withdrawETHAndUSDG() public {
        _registerETH(alice, NAME5, YEAR);
        _registerUSDG(bob, "abcd", YEAR);

        uint256 ethBal = address(controller).balance;
        uint256 usdgBal = usdg.balanceOf(address(controller));
        assertGt(ethBal, 0);
        assertEq(usdgBal, 25_000_000);

        uint256 ownerEthBefore = address(this).balance;
        controller.withdraw();
        assertEq(address(this).balance - ownerEthBefore, ethBal);

        controller.recoverFunds(address(usdg), address(this), usdgBal);
        assertEq(usdg.balanceOf(address(this)), usdgBal);

        // non-owner cannot recover tokens
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        controller.recoverFunds(address(usdg), alice, 1);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    /// @dev Matches ReverseRegistrar's lowercase-hex labelhash of an address.
    function _sha3HexAddress(address addr) internal pure returns (bytes32) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory out = new bytes(40);
        uint256 value = uint256(uint160(addr));
        for (uint256 i = 40; i > 0; i--) {
            out[i - 1] = hexChars[value & 0xf];
            value >>= 4;
        }
        return keccak256(out);
    }

    receive() external payable {}
}
