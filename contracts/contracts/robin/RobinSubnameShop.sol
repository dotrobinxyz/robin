//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {RobinWrapper} from "./RobinWrapper.sol";
import {PARENT_CANNOT_CONTROL, CANNOT_UNWRAP, CAN_EXTEND_EXPIRY} from "../wrapper/INameWrapper.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title RobinSubnameShop
/// @notice Names that earn: any wrapped, locked .robin name can open a shop
///         where anyone self-serve mints subnames for a seller-set price.
///         90% of every sale goes to the name owner in-transaction, 10% to
///         the protocol treasury.
///
///         Sold subnames are EMANCIPATED (PARENT_CANNOT_CONTROL burned) so
///         buyers truly own them — the parent cannot revoke or reassign.
///         CAN_EXTEND_EXPIRY is also burned so a buyer can extend their
///         subname's expiry themselves as the parent renews. Because the
///         wrapper only allows emancipating children of locked parents,
///         opening a shop requires the parent to have burned CANNOT_UNWRAP:
///         the name stays a tradeable ERC-1155 forever, but can never
///         unwrap back to an ERC-721.
///
/// @dev Singleton with no owner and no admin surface. The treasury address,
///      wrapper, resolver, and USDG token are fixed at deployment. Sellers
///      grant this contract operator approval on the wrapper
///      (`setApprovalForAll`) — revocable by them at any time, which also
///      disables their shop. Listings pin the seller: if the parent name is
///      sold or transferred, the listing goes stale and the new owner must
///      relist (buys revert rather than paying the old owner).
contract RobinSubnameShop is ReentrancyGuard {
    using Address for address payable;

    RobinWrapper public immutable wrapper;
    IERC20Minimal public immutable usdg;
    address public immutable treasury;
    address public immutable defaultResolver;

    /// @dev Fee taken on every sale, in basis points.
    uint256 public constant FEE_BPS = 1000; // 10%

    struct Listing {
        address seller; // wrapper owner of the parent at listing time
        uint256 priceUSDG; // 6 decimals; 0 = USDG purchases disabled
        uint256 priceETH; // wei; 0 = ETH purchases disabled
    }

    mapping(bytes32 => Listing) public listings;

    event ShopOpened(
        bytes32 indexed parentNode,
        address indexed seller,
        uint256 priceUSDG,
        uint256 priceETH
    );
    event ShopClosed(bytes32 indexed parentNode, address indexed seller);
    event SubnameSold(
        bytes32 indexed parentNode,
        bytes32 indexed childNode,
        string label,
        address indexed buyer,
        address seller,
        bool paidInUSDG,
        uint256 price,
        uint256 fee
    );

    error NotParentOwner();
    error ParentNotLocked();
    error ShopNotApproved();
    error NoActiveShop();
    error StaleSeller();
    error CurrencyDisabled();
    error WrongPayment();
    error InvalidLabel();
    error SubnameTaken();
    error NoPricesSet();

    constructor(
        RobinWrapper _wrapper,
        IERC20Minimal _usdg,
        address _treasury,
        address _defaultResolver
    ) {
        wrapper = _wrapper;
        usdg = _usdg;
        treasury = _treasury;
        defaultResolver = _defaultResolver;
    }

    // ------------------------------------------------------------------
    // Seller side
    // ------------------------------------------------------------------

    /// @notice Open (or reprice) the shop for a name you own. Requires the
    ///         parent to be locked (CANNOT_UNWRAP burned) and this contract
    ///         approved as your wrapper operator.
    function openShop(
        bytes32 parentNode,
        uint256 priceUSDG,
        uint256 priceETH
    ) external {
        address owner = wrapper.ownerOf(uint256(parentNode));
        if (owner != msg.sender) revert NotParentOwner();
        if (priceUSDG == 0 && priceETH == 0) revert NoPricesSet();
        (, uint32 fuses, ) = wrapper.getData(uint256(parentNode));
        if (fuses & CANNOT_UNWRAP == 0) revert ParentNotLocked();
        if (!wrapper.isApprovedForAll(msg.sender, address(this))) {
            revert ShopNotApproved();
        }
        listings[parentNode] = Listing(msg.sender, priceUSDG, priceETH);
        emit ShopOpened(parentNode, msg.sender, priceUSDG, priceETH);
    }

    /// @notice Close your shop. (Revoking wrapper approval also disables it.)
    function closeShop(bytes32 parentNode) external {
        if (listings[parentNode].seller != msg.sender) revert NotParentOwner();
        delete listings[parentNode];
        emit ShopClosed(parentNode, msg.sender);
    }

    // ------------------------------------------------------------------
    // Buyer side
    // ------------------------------------------------------------------

    /// @notice Buy `label` under a listed parent, paying in ETH.
    function buyWithETH(
        bytes32 parentNode,
        string calldata label
    ) external payable nonReentrant returns (bytes32 childNode) {
        Listing memory l = _liveListing(parentNode);
        if (l.priceETH == 0) revert CurrencyDisabled();
        if (msg.value != l.priceETH) revert WrongPayment();

        childNode = _mint(parentNode, label);

        uint256 fee = (l.priceETH * FEE_BPS) / 10_000;
        payable(treasury).sendValue(fee);
        payable(l.seller).sendValue(l.priceETH - fee);

        emit SubnameSold(
            parentNode,
            childNode,
            label,
            msg.sender,
            l.seller,
            false,
            l.priceETH,
            fee
        );
    }

    /// @notice Buy `label` under a listed parent, paying in USDG.
    function buyWithUSDG(
        bytes32 parentNode,
        string calldata label
    ) external nonReentrant returns (bytes32 childNode) {
        Listing memory l = _liveListing(parentNode);
        if (l.priceUSDG == 0) revert CurrencyDisabled();

        childNode = _mint(parentNode, label);

        uint256 fee = (l.priceUSDG * FEE_BPS) / 10_000;
        require(usdg.transferFrom(msg.sender, treasury, fee), "usdg fee");
        require(
            usdg.transferFrom(msg.sender, l.seller, l.priceUSDG - fee),
            "usdg pay"
        );

        emit SubnameSold(
            parentNode,
            childNode,
            label,
            msg.sender,
            l.seller,
            true,
            l.priceUSDG,
            fee
        );
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _liveListing(
        bytes32 parentNode
    ) internal view returns (Listing memory l) {
        l = listings[parentNode];
        if (l.seller == address(0)) revert NoActiveShop();
        // If the name changed hands the listing is stale: never pay the old
        // seller for the new owner's namespace.
        if (wrapper.ownerOf(uint256(parentNode)) != l.seller) {
            revert StaleSeller();
        }
    }

    function _mint(
        bytes32 parentNode,
        string calldata label
    ) internal returns (bytes32 childNode) {
        _validateLabel(label);
        childNode = keccak256(
            abi.encodePacked(parentNode, keccak256(bytes(label)))
        );
        // Only truly unminted subnames are sold — never reassign an existing
        // token out from under its holder.
        if (wrapper.ownerOf(uint256(childNode)) != address(0)) {
            revert SubnameTaken();
        }
        // Child expiry rides the parent's wrapper expiry; the wrapper caps it.
        (, , uint64 parentExpiry) = wrapper.getData(uint256(parentNode));
        // Emancipated + self-extendable: the buyer owns it outright and can
        // keep it alive themselves whenever the parent renews.
        wrapper.setSubnodeRecord(
            parentNode,
            label,
            msg.sender,
            defaultResolver,
            0,
            uint32(PARENT_CANNOT_CONTROL | CAN_EXTEND_EXPIRY),
            parentExpiry
        );
    }

    function _validateLabel(string calldata label) internal pure {
        bytes calldata b = bytes(label);
        if (b.length == 0 || b.length > 255) revert InvalidLabel();
        for (uint256 i = 0; i < b.length; i++) {
            // No dots (would fake deeper hierarchy) and no whitespace/control.
            if (b[i] == 0x2E || uint8(b[i]) <= 0x20) revert InvalidLabel();
        }
    }
}
