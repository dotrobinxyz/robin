//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {Test} from "forge-std/Test.sol";

import {RobinRegistry} from "../../contracts/robin/RobinRegistry.sol";
import {RobinBaseRegistrar} from "../../contracts/robin/RobinBaseRegistrar.sol";
import {RobinRegistrarController} from "../../contracts/robin/RobinRegistrarController.sol";
import {RobinPriceOracle, AggregatorV3Interface} from "../../contracts/robin/RobinPriceOracle.sol";
import {RobinReservedList} from "../../contracts/robin/RobinReservedList.sol";
import {RobinWrapper} from "../../contracts/robin/RobinWrapper.sol";
import {RobinMetadata} from "../../contracts/robin/RobinMetadata.sol";
import {IRobinPriceOracle} from "../../contracts/robin/IRobinPriceOracle.sol";
import {IETHRegistrarController, IPriceOracle} from "../../contracts/ethregistrar/IETHRegistrarController.sol";
import {ReverseRegistrar} from "../../contracts/reverseRegistrar/ReverseRegistrar.sol";
import {DefaultReverseRegistrar} from "../../contracts/reverseRegistrar/DefaultReverseRegistrar.sol";
import {PublicResolver} from "../../contracts/resolvers/PublicResolver.sol";
import {INameWrapper} from "../../contracts/wrapper/INameWrapper.sol";
import {IMetadataService} from "../../contracts/wrapper/IMetadataService.sol";
import {IBaseRegistrar} from "../../contracts/ethregistrar/IBaseRegistrar.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IReverseRegistrar} from "../../contracts/reverseRegistrar/IReverseRegistrar.sol";
import {IDefaultReverseRegistrar} from "../../contracts/reverseRegistrar/IDefaultReverseRegistrar.sol";
import {ENS} from "../../contracts/registry/ENS.sol";

import {MockAggregator} from "../../contracts/robin/mocks/MockAggregator.sol";
import {MockUSDG} from "../../contracts/robin/mocks/MockUSDG.sol";

/// @dev Deploys the full Robin stack with mainnet-shaped parameters against
///      mocks for the external dependencies (Chainlink feed, USDG).
abstract contract RobinFixture is Test {
    // namehash('robin') / keccak256('robin')
    bytes32 constant ROBIN_NODE =
        0x1a9af74db203c4017d8445942e9b64ce93d8bc2ae2eed5b8dcbbb0090690d2b3;
    bytes32 constant ROBIN_LABELHASH =
        0xaba61bbb4ca3fda6873bc27445c6837f002fc3bcaf5b38210d9a52c6484942c0;
    bytes32 constant ADDR_REVERSE_NODE =
        0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2;

    // attoUSD per second: $100 / $25 / $5 per 365-day year
    uint256 constant RATE3 = 3170979198376;
    uint256 constant RATE4 = 792744799594;
    uint256 constant RATE5 = 158548959918;

    uint256 constant GRACE = 90 days;
    uint256 constant PREMIUM_START = 1000e18; // $1,000 in attoUSD
    uint256 constant PREMIUM_DAYS = 21;
    uint256 constant MIN_COMMIT_AGE = 60;
    uint256 constant MAX_COMMIT_AGE = 86400;
    uint256 constant MAX_FEED_AGE = 36 hours;
    int256 constant ETH_PRICE = 2000e8; // $2,000, 8 decimals

    uint256 constant START_TIME = 1_700_000_000;

    RobinRegistry registry;
    RobinBaseRegistrar registrar;
    RobinRegistrarController controller;
    RobinPriceOracle oracle;
    RobinReservedList reserved;
    RobinWrapper wrapper;
    RobinMetadata metadata;
    ReverseRegistrar reverseRegistrar;
    DefaultReverseRegistrar defaultReverseRegistrar;
    PublicResolver resolver;
    MockAggregator feed;
    MockUSDG usdg;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public virtual {
        vm.warp(START_TIME);

        registry = new RobinRegistry();
        registrar = new RobinBaseRegistrar(registry, ROBIN_NODE, GRACE);
        registry.setSubnodeOwner(bytes32(0), ROBIN_LABELHASH, address(registrar));

        // reverse tree: reverse → us, addr.reverse → ReverseRegistrar
        reverseRegistrar = new ReverseRegistrar(registry);
        registry.setSubnodeOwner(bytes32(0), keccak256("reverse"), address(this));
        registry.setSubnodeOwner(
            _namehash(bytes32(0), keccak256("reverse")),
            keccak256("addr"),
            address(reverseRegistrar)
        );
        defaultReverseRegistrar = new DefaultReverseRegistrar();

        reserved = new RobinReservedList();
        feed = new MockAggregator(8, ETH_PRICE);
        oracle = _deployOracle(0); // no promo by default
        usdg = new MockUSDG();

        wrapper = new RobinWrapper(
            registry,
            IBaseRegistrar(address(registrar)),
            IMetadataService(address(0))
        );
        registrar.addController(address(wrapper));

        metadata = new RobinMetadata(registrar, wrapper);
        wrapper.setMetadataService(IMetadataService(address(metadata)));
        registrar.setMetadataProvider(metadata);

        controller = new RobinRegistrarController(
            registrar,
            IRobinPriceOracle(address(oracle)),
            28 days,
            MIN_COMMIT_AGE,
            MAX_COMMIT_AGE,
            IReverseRegistrar(address(reverseRegistrar)),
            IDefaultReverseRegistrar(address(defaultReverseRegistrar)),
            registry,
            IERC20Metadata(address(usdg)),
            reserved,
            INameWrapper(address(wrapper))
        );
        registrar.addController(address(controller));
        reverseRegistrar.setController(address(controller), true);
        defaultReverseRegistrar.setController(address(controller), true);
        wrapper.setController(address(controller), true);

        resolver = new PublicResolver(
            registry,
            INameWrapper(address(wrapper)),
            address(controller),
            address(reverseRegistrar)
        );
        reverseRegistrar.setDefaultResolver(address(resolver));

        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        usdg.mint(alice, 1_000_000e6);
        usdg.mint(bob, 1_000_000e6);
    }

    function _deployOracle(
        uint256 promoEnd
    ) internal returns (RobinPriceOracle) {
        uint256[] memory rates = new uint256[](5);
        rates[0] = RATE3; // 1-char: unregisterable; priced as 3-char defensively
        rates[1] = RATE3; // 2-char: unregisterable; priced as 3-char defensively
        rates[2] = RATE3;
        rates[3] = RATE4;
        rates[4] = RATE5;
        return
            new RobinPriceOracle(
                AggregatorV3Interface(address(feed)),
                MAX_FEED_AGE,
                rates,
                PREMIUM_START,
                PREMIUM_DAYS,
                GRACE,
                promoEnd
            );
    }

    function _namehash(
        bytes32 parent,
        bytes32 labelhash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parent, labelhash));
    }

    function _robinNode(string memory label) internal pure returns (bytes32) {
        return _namehash(ROBIN_NODE, keccak256(bytes(label)));
    }

    function _makeRegistration(
        string memory label,
        address owner,
        uint256 duration,
        bytes32 secret,
        address resolver_,
        uint8 reverseRecord
    )
        internal
        pure
        returns (IETHRegistrarController.Registration memory registration)
    {
        registration = IETHRegistrarController.Registration({
            label: label,
            owner: owner,
            duration: duration,
            secret: secret,
            resolver: resolver_,
            data: new bytes[](0),
            reverseRecord: reverseRecord,
            referrer: bytes32(0)
        });
    }

    /// @dev Full commit-reveal registration paying in ETH, as `who`.
    function _registerETH(
        address who,
        string memory label,
        uint256 duration
    ) internal returns (uint256 paid) {
        IETHRegistrarController.Registration memory registration = _makeRegistration(
            label,
            who,
            duration,
            keccak256("secret"),
            address(0),
            0
        );
        vm.prank(who);
        controller.commit(controller.makeCommitment(registration));
        vm.warp(block.timestamp + MIN_COMMIT_AGE);
        IPriceOracle.Price memory price = controller.rentPrice(label, duration);
        paid = price.base + price.premium;
        vm.prank(who);
        controller.register{value: paid}(registration);
    }

    /// @dev Full commit-reveal registration paying in USDG, as `who`.
    function _registerUSDG(
        address who,
        string memory label,
        uint256 duration
    ) internal returns (uint256 paid) {
        IETHRegistrarController.Registration memory registration = _makeRegistration(
            label,
            who,
            duration,
            keccak256("secret"),
            address(0),
            0
        );
        vm.prank(who);
        controller.commit(controller.makeCommitment(registration));
        vm.warp(block.timestamp + MIN_COMMIT_AGE);
        IPriceOracle.Price memory price = controller.rentPriceUSDG(
            label,
            duration
        );
        paid = price.base + price.premium;
        vm.startPrank(who);
        usdg.approve(address(controller), paid);
        controller.registerWithUSDG(registration, paid);
        vm.stopPrank();
    }
}
