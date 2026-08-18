//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {RobinFixture} from "./RobinFixture.sol";
import {RobinBaseRegistrar} from "../../contracts/robin/RobinBaseRegistrar.sol";
import {IRobinTokenURIProvider} from "../../contracts/robin/IRobinTokenURIProvider.sol";
import {BaseRegistrarImplementation} from "../../contracts/ethregistrar/BaseRegistrarImplementation.sol";
import {ENSRegistry} from "../../contracts/registry/ENSRegistry.sol";
import {ENS} from "../../contracts/registry/ENS.sol";

contract RobinBaseRegistrarTest is RobinFixture {
    uint256 constant YEAR = 365 days;
    string constant LABEL = "goldfinch";

    function _id(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }

    function test_erc721Identity() public view {
        assertEq(registrar.name(), "Robin Names");
        assertEq(registrar.symbol(), "ROBIN");
        assertEq(registrar.GRACE_PERIOD(), 90 days);
        // ERC721Metadata interface reported
        assertTrue(registrar.supportsInterface(0x5b5e139f));
    }

    function test_lifecycle_expiryGracePremiumReregistration() public {
        _registerETH(alice, LABEL, YEAR);
        uint256 id = _id(LABEL);
        uint256 expiry = registrar.nameExpires(id);
        assertEq(expiry, block.timestamp + YEAR);
        assertEq(registrar.ownerOf(id), alice);

        // expired, in grace: not available, ownerOf reverts, renewal works
        vm.warp(expiry + 1);
        assertFalse(registrar.available(id));
        vm.expectRevert();
        registrar.ownerOf(id);
        assertFalse(controller.available(LABEL));

        // grace over: available again
        vm.warp(expiry + GRACE + 1);
        assertTrue(registrar.available(id));
        assertTrue(controller.available(LABEL));

        // re-registration by bob burns and remints
        _registerETH(bob, LABEL, YEAR);
        assertEq(registrar.ownerOf(id), bob);
        // label survives re-registration
        assertEq(registrar.labels(id), LABEL);
    }

    function test_renewDuringGraceOnly() public {
        _registerETH(alice, LABEL, YEAR);
        uint256 id = _id(LABEL);
        uint256 expiry = registrar.nameExpires(id);

        // renewal inside grace extends from expiry (not from now)
        vm.warp(expiry + GRACE - 1);
        uint256 renewPrice = controller.rentPrice(LABEL, YEAR).base;
        vm.prank(alice);
        controller.renew{value: renewPrice}(LABEL, YEAR, bytes32(0));
        assertEq(registrar.nameExpires(id), expiry + YEAR);

        // after grace, renewal reverts
        vm.warp(expiry + YEAR + GRACE + 1);
        uint256 p = controller.rentPriceUSDG(LABEL, YEAR).base;
        vm.startPrank(alice);
        usdg.approve(address(controller), p);
        vm.expectRevert();
        controller.renewWithUSDG(LABEL, YEAR, bytes32(0), p);
        vm.stopPrank();
    }

    function test_registerWithLabel_onlyController() public {
        vm.prank(alice);
        vm.expectRevert();
        registrar.registerWithLabel(LABEL, alice, YEAR);
    }

    function test_labelWrittenOnce() public {
        _registerETH(alice, LABEL, YEAR);
        uint256 id = _id(LABEL);
        assertEq(registrar.labels(id), LABEL);

        // expire past grace, re-register: stored label unchanged (same value)
        vm.warp(registrar.nameExpires(id) + GRACE + 1);
        _registerETH(bob, LABEL, YEAR);
        assertEq(registrar.labels(id), LABEL);
    }

    function test_transferAndReclaim() public {
        _registerETH(alice, LABEL, YEAR);
        uint256 id = _id(LABEL);
        bytes32 node = _robinNode(LABEL);

        vm.prank(alice);
        registrar.transferFrom(alice, bob, id);
        assertEq(registrar.ownerOf(id), bob);
        // registry owner unchanged until reclaim
        assertEq(registry.owner(node), alice);
        vm.prank(bob);
        registrar.reclaim(id, bob);
        assertEq(registry.owner(node), bob);
    }

    function test_tokenURI_presentAndEmptyWithoutProvider() public {
        _registerETH(alice, LABEL, YEAR);
        uint256 id = _id(LABEL);
        string memory uri = registrar.tokenURI(id);
        assertGt(bytes(uri).length, 100);

        registrar.setMetadataProvider(IRobinTokenURIProvider(address(0)));
        assertEq(registrar.tokenURI(id), "");

        // unminted id reverts
        vm.expectRevert();
        registrar.tokenURI(_id("neverregistered"));
    }

    /// @dev Differential fuzz: registration/renewal/availability semantics
    ///      must match upstream BaseRegistrarImplementation exactly under an
    ///      identical operation sequence.
    function testFuzz_registrarMatchesUpstream(
        uint64 dur1,
        uint64 dur2,
        uint32 gap
    ) public {
        uint256 duration1 = bound(dur1, 1 days, 3650 days);
        uint256 duration2 = bound(dur2, 1 days, 3650 days);
        uint256 waitGap = bound(gap, 0, 600 days);

        // isolated upstream deployment mirroring ours
        ENSRegistry upstreamRegistry = new ENSRegistry();
        BaseRegistrarImplementation upstreamRegistrar = new BaseRegistrarImplementation(
                ENS(address(upstreamRegistry)),
                ROBIN_NODE
            );
        upstreamRegistry.setSubnodeOwner(
            bytes32(0),
            ROBIN_LABELHASH,
            address(upstreamRegistrar)
        );
        upstreamRegistrar.addController(address(this));

        // isolated robin deployment (this test as controller)
        ENSRegistry freshRegistry = new ENSRegistry();
        RobinBaseRegistrar freshRegistrar = new RobinBaseRegistrar(
            ENS(address(freshRegistry)),
            ROBIN_NODE,
            90 days
        );
        freshRegistry.setSubnodeOwner(
            bytes32(0),
            ROBIN_LABELHASH,
            address(freshRegistrar)
        );
        freshRegistrar.addController(address(this));

        uint256 id = _id(LABEL);
        uint256 expiryUpstream = upstreamRegistrar.register(id, alice, duration1);
        uint256 expiryRobin = freshRegistrar.registerWithLabel(
            LABEL,
            alice,
            duration1
        );
        assertEq(expiryRobin, expiryUpstream);

        vm.warp(block.timestamp + waitGap);
        assertEq(
            freshRegistrar.available(id),
            upstreamRegistrar.available(id)
        );

        // renewal comparison (both revert or both succeed with same expiry)
        bool upstreamOk;
        uint256 upstreamExpiry2;
        try upstreamRegistrar.renew(id, duration2) returns (uint256 e) {
            upstreamOk = true;
            upstreamExpiry2 = e;
        } catch {}
        bool robinOk;
        uint256 robinExpiry2;
        try freshRegistrar.renew(id, duration2) returns (uint256 e) {
            robinOk = true;
            robinExpiry2 = e;
        } catch {}
        assertEq(robinOk, upstreamOk);
        if (robinOk) {
            assertEq(robinExpiry2, upstreamExpiry2);
        }
    }
}

