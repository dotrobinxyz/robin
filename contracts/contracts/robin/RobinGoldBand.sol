// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// New contract (no upstream counterpart). Gold Band — the paid supporter
// badge for .robin names.
//
// $6.99 per 30-day month or $50 per year, paid in USDG (6 decimals, exact,
// ceil-rounded from attoUSD) or ETH (Chainlink-priced with the same
// staleness bound as the premium shop). Every payment splits inside the
// transaction: the burn half to the public RobinBurnVault that funds
// scheduled ROBIN buy-and-burns, the rest to the treasury Safe — the
// contract never custodies funds and has no admin.
//
// Status is a plain timestamp per ENS node: goldUntil[node]. Anyone may
// gild any node (gifting is allowed), subnames included — the badge is
// display-layer, so no registry checks are needed. Extending stacks from
// the later of now / current expiry.

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IAggregatorMinimal {
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80);
}

contract RobinGoldBand {
    uint256 public constant MONTH = 30 days;
    uint256 public constant YEAR = 365 days;
    /// @notice Prices in attoUSD (1e18 = $1).
    uint256 public constant MONTH_PRICE_ATTOUSD = 6.99e18;
    uint256 public constant YEAR_PRICE_ATTOUSD = 50e18;
    uint256 public constant MAX_PERIODS = 10;

    address public immutable treasury;
    address public immutable burnVault;
    IERC20Minimal public immutable usdg;
    IAggregatorMinimal public immutable feed;
    uint256 public immutable maxFeedAge;

    /// @notice Gold status expiry (unix seconds) by ENS node; 0 = never gilded.
    mapping(bytes32 => uint256) public goldUntil;

    uint256 private _entered = 1;

    event GoldExtended(
        bytes32 indexed node,
        uint256 until,
        address indexed payer,
        uint256 periods,
        bool yearly,
        bool paidInUSDG,
        uint256 amountPaid
    );

    error BadPeriods();
    error InsufficientPayment();
    error StaleFeed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_entered != 1) revert Reentrancy();
        _entered = 2;
        _;
        _entered = 1;
    }

    constructor(
        address _treasury,
        address _burnVault,
        IERC20Minimal _usdg,
        IAggregatorMinimal _feed,
        uint256 _maxFeedAge
    ) {
        treasury = _treasury;
        burnVault = _burnVault;
        usdg = _usdg;
        feed = _feed;
        maxFeedAge = _maxFeedAge;
    }

    function isGold(bytes32 node) external view returns (bool) {
        return goldUntil[node] >= block.timestamp;
    }

    /// @notice USDG amount (6 decimals) for `periods` months or years.
    function priceInUSDG(uint256 periods, bool yearly) public pure returns (uint256) {
        uint256 atto = _priceAttoUSD(periods, yearly);
        return (atto + 1e12 - 1) / 1e12;
    }

    /// @notice Wei amount for `periods` months or years at the current feed price.
    function priceInWei(uint256 periods, bool yearly) public view returns (uint256) {
        uint256 atto = _priceAttoUSD(periods, yearly);
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0 || block.timestamp - updatedAt > maxFeedAge) {
            revert StaleFeed();
        }
        // answer is USD/ETH with 8 decimals → wei = attoUSD * 1e8 / answer.
        return (atto * 1e8 + uint256(answer) - 1) / uint256(answer);
    }

    function extendWithUSDG(bytes32 node, uint256 periods, bool yearly) external {
        uint256 amount = priceInUSDG(periods, yearly);
        uint256 burnHalf = amount / 2;
        uint256 until = _extend(node, periods, yearly);
        require(usdg.transferFrom(msg.sender, treasury, amount - burnHalf), "usdg transfer");
        require(usdg.transferFrom(msg.sender, burnVault, burnHalf), "usdg transfer");
        emit GoldExtended(node, until, msg.sender, periods, yearly, true, amount);
    }

    function extendWithETH(
        bytes32 node,
        uint256 periods,
        bool yearly
    ) external payable nonReentrant {
        uint256 amount = priceInWei(periods, yearly);
        if (msg.value < amount) revert InsufficientPayment();
        uint256 burnHalf = amount / 2;
        uint256 until = _extend(node, periods, yearly);
        _send(treasury, amount - burnHalf);
        _send(burnVault, burnHalf);
        if (msg.value > amount) _send(msg.sender, msg.value - amount);
        emit GoldExtended(node, until, msg.sender, periods, yearly, false, amount);
    }

    function _priceAttoUSD(uint256 periods, bool yearly) internal pure returns (uint256) {
        if (periods == 0 || periods > MAX_PERIODS) revert BadPeriods();
        return (yearly ? YEAR_PRICE_ATTOUSD : MONTH_PRICE_ATTOUSD) * periods;
    }

    function _extend(
        bytes32 node,
        uint256 periods,
        bool yearly
    ) internal returns (uint256 until) {
        uint256 current = goldUntil[node];
        uint256 base = current > block.timestamp ? current : block.timestamp;
        until = base + (yearly ? YEAR : MONTH) * periods;
        goldUntil[node] = until;
    }

    function _send(address to, uint256 value) internal {
        (bool ok, ) = to.call{value: value}("");
        require(ok, "eth send");
    }
}
