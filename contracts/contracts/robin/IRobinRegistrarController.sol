//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {IETHRegistrarController, IPriceOracle} from "../ethregistrar/IETHRegistrarController.sol";

/// @notice Robin's controller interface: the upstream commit-reveal controller
///         interface plus the flat-USDG payment path.
///
///         Amount semantics: `NameRegistered`/`NameRenewed` events always carry
///         the amounts actually paid in the payment asset used — wei for the
///         payable functions, USDG base units for the *WithUSDG functions
///         (which additionally emit `USDGPayment` in the same transaction).
interface IRobinRegistrarController is IETHRegistrarController {
    /// @notice Registers a name, paying the flat USD price in USDG.
    ///         Requires a prior USDG approval for at least the total price.
    /// @param registration The registration to register (same commitment
    ///        struct as the ETH path; commitments are payment-agnostic).
    /// @param maxTotalUSDG Upper bound on the USDG charged (base + premium),
    ///        protecting against price movement between quote and inclusion.
    function registerWithUSDG(
        Registration calldata registration,
        uint256 maxTotalUSDG
    ) external;

    /// @notice Renews a name, paying the flat USD price in USDG.
    /// @param label The label of the name.
    /// @param duration The duration to extend the registration for.
    /// @param referrer The referrer of the renewal.
    /// @param maxTotalUSDG Upper bound on the USDG charged.
    function renewWithUSDG(
        string calldata label,
        uint256 duration,
        bytes32 referrer,
        uint256 maxTotalUSDG
    ) external;

    /// @notice Returns the price of a registration in USDG base units
    ///         (rounded up from the USD price).
    function rentPriceUSDG(
        string calldata label,
        uint256 duration
    ) external view returns (IPriceOracle.Price memory);
}
