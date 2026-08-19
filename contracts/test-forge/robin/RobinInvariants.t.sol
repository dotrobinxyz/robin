//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {Vm} from "forge-std/Vm.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {RobinFixture} from "./RobinFixture.sol";
import {RobinRegistrarController} from "../../contracts/robin/RobinRegistrarController.sol";
import {RobinBaseRegistrar} from "../../contracts/robin/RobinBaseRegistrar.sol";
import {RobinReservedList} from "../../contracts/robin/RobinReservedList.sol";
import {IETHRegistrarController, IPriceOracle} from "../../contracts/ethregistrar/IETHRegistrarController.sol";
import {MockUSDG} from "../../contracts/robin/mocks/MockUSDG.sol";

contract RobinHandler is StdUtils {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    RobinRegistrarController immutable controller;
    RobinBaseRegistrar immutable registrar;
    MockUSDG immutable usdg;

    string[] labels = ["alpha", "beta", "gamma", "abc", "abcd"];
    address[] actors = [address(0xA11), address(0xB22), address(0xC33)];

    uint256 public ghostEthPaid;
    uint256 public ghostUsdgPaid;
    bool public reservedEverRegistered;
    mapping(uint256 => uint256) public ghostExpiry; // id → expected expiry
    uint256[] public trackedIds;
    mapping(uint256 => bool) tracked;

    constructor(
        RobinRegistrarController _controller,
        RobinBaseRegistrar _registrar,
        MockUSDG _usdg
    ) {
        controller = _controller;
        registrar = _registrar;
        usdg = _usdg;
        vm.deal(address(this), 1_000_000 ether);
        usdg.mint(address(this), 1e15); // $1B
        usdg.approve(address(controller), type(uint256).max);
    }

    function trackedCount() external view returns (uint256) {
        return trackedIds.length;
    }

    function _label(uint256 seed) internal view returns (string memory) {
        return labels[seed % labels.length];
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _track(string memory label, uint256 expiry) internal {
        uint256 id = uint256(keccak256(bytes(label)));
        ghostExpiry[id] = expiry;
        if (!tracked[id]) {
            tracked[id] = true;
            trackedIds.push(id);
        }
    }

    function _commitAndPrice(
        string memory label,
        uint256 durationSeed,
        address owner
    )
        internal
        returns (
            IETHRegistrarController.Registration memory registration,
            bool available
        )
    {
        uint256 duration = bound(durationSeed, 28 days, 3650 days);
        registration = IETHRegistrarController.Registration({
            label: label,
            owner: owner,
            duration: duration,
            secret: keccak256(abi.encode(label, owner, duration)),
            resolver: address(0),
            data: new bytes[](0),
            reverseRecord: 0,
            referrer: bytes32(0)
        });
        available = controller.available(label);
        if (available) {
            bytes32 commitment = controller.makeCommitment(registration);
            // fresh commitment only if none pending
            if (controller.commitments(commitment) == 0) {
                controller.commit(commitment);
            }
            vm.warp(block.timestamp + 61);
        }
    }

    function registerETH(uint256 labelSeed, uint256 durationSeed) external {
        string memory label = _label(labelSeed);
        (
            IETHRegistrarController.Registration memory registration,
            bool available
        ) = _commitAndPrice(label, durationSeed, _actor(labelSeed));
        if (!available) return;

        IPriceOracle.Price memory price = controller.rentPrice(
            label,
            registration.duration
        );
        uint256 total = price.base + price.premium;
        controller.register{value: total}(registration);
        ghostEthPaid += total;
        _track(label, block.timestamp + registration.duration);
    }

    function registerUSDG(uint256 labelSeed, uint256 durationSeed) external {
        string memory label = _label(labelSeed);
        (
            IETHRegistrarController.Registration memory registration,
            bool available
        ) = _commitAndPrice(label, durationSeed, _actor(labelSeed));
        if (!available) return;

        IPriceOracle.Price memory price = controller.rentPriceUSDG(
            label,
            registration.duration
        );
        uint256 total = price.base + price.premium;
        controller.registerWithUSDG(registration, total);
        ghostUsdgPaid += total;
        _track(label, block.timestamp + registration.duration);
    }

    function renewETH(uint256 labelSeed, uint256 durationSeed) external {
        string memory label = _label(labelSeed);
        uint256 id = uint256(keccak256(bytes(label)));
        uint256 duration = bound(durationSeed, 1 days, 3650 days);
        // only renewable while registered or in grace
        if (registrar.nameExpires(id) + registrar.GRACE_PERIOD() < block.timestamp) return;
        if (registrar.nameExpires(id) == 0) return;

        IPriceOracle.Price memory price = controller.rentPrice(label, duration);
        controller.renew{value: price.base}(label, duration, bytes32(0));
        ghostEthPaid += price.base;
        ghostExpiry[id] += duration;
    }

    function renewUSDG(uint256 labelSeed, uint256 durationSeed) external {
        string memory label = _label(labelSeed);
        uint256 id = uint256(keccak256(bytes(label)));
        uint256 duration = bound(durationSeed, 1 days, 3650 days);
        if (registrar.nameExpires(id) + registrar.GRACE_PERIOD() < block.timestamp) return;
        if (registrar.nameExpires(id) == 0) return;

        IPriceOracle.Price memory price = controller.rentPriceUSDG(
            label,
            duration
        );
        controller.renewWithUSDG(label, duration, bytes32(0), price.base);
        ghostUsdgPaid += price.base;
        ghostExpiry[id] += duration;
    }

    function warpForward(uint256 seed) external {
        vm.warp(block.timestamp + bound(seed, 1 hours, 120 days));
    }

    function tryRegisterReserved(uint256 durationSeed) external {
        (
            IETHRegistrarController.Registration memory registration,
            bool available
        ) = _commitAndPrice("nvda", durationSeed, actors[0]);
        // reserved: must never be available, and register must revert
        if (available) {
            reservedEverRegistered = true;
            return;
        }
        registration.duration = bound(durationSeed, 28 days, 3650 days);
        try controller.register{value: 100 ether}(registration) {
            reservedEverRegistered = true;
        } catch {}
    }

    receive() external payable {}
}

contract RobinInvariantsTest is RobinFixture {
    RobinHandler handler;

    function setUp() public override {
        super.setUp();
        string[] memory reservedLabels = new string[](1);
        reservedLabels[0] = "nvda";
        reserved.setReserved(reservedLabels, true);

        handler = new RobinHandler(controller, registrar, usdg);
        targetContract(address(handler));
    }

    /// @dev Every wei the controller holds is accounted for by tracked
    ///      payments (register + renew, minus refunds which the handler
    ///      never triggers because it pays exact quotes).
    function invariant_ethBalanceMatchesPayments() public view {
        assertEq(address(controller).balance, handler.ghostEthPaid());
    }

    /// @dev Every USDG unit the controller holds is accounted for.
    function invariant_usdgBalanceMatchesPayments() public view {
        assertEq(
            usdg.balanceOf(address(controller)),
            handler.ghostUsdgPaid()
        );
    }

    /// @dev Reserved labels can never be registered through the controller.
    function invariant_reservedNeverRegistered() public view {
        assertFalse(handler.reservedEverRegistered());
        assertEq(registrar.nameExpires(uint256(keccak256("nvda"))), 0);
    }

    /// @dev The registrar's expiry bookkeeping matches the handler's mirror
    ///      for every name it has touched.
    function invariant_expiryMatchesGhost() public view {
        uint256 n = handler.trackedCount();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.trackedIds(i);
            assertEq(registrar.nameExpires(id), handler.ghostExpiry(id));
        }
    }
}
