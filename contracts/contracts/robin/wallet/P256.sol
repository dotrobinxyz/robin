// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// Adapted from daimo-eth/p256-verifier (MIT). Their library routes to a
// deployed Solidity verifier contract; Robinhood Chain runs ArbOS 61 which
// ships the RIP-7212 native precompile at 0x…0100, so this version calls the
// precompile directly (verified live 2026-08-29: valid sig → 32-byte 1,
// invalid → empty). The malleability check is kept verbatim.

library P256 {
    /// @dev RIP-7212 P256VERIFY precompile.
    address constant VERIFIER = address(0x0000000000000000000000000000000000000100);

    /// P256 curve order n/2 for malleability check
    uint256 constant P256_N_DIV_2 =
        57896044605178124381348723474703786764998477612067880171211129530534256022184;

    function verifySignatureAllowMalleability(
        bytes32 message_hash,
        uint256 r,
        uint256 s,
        uint256 x,
        uint256 y
    ) internal view returns (bool) {
        bytes memory args = abi.encode(message_hash, r, s, x, y);
        (bool success, bytes memory ret) = VERIFIER.staticcall(args);
        // Precompile returns 32-byte 1 on valid, empty on invalid.
        return success && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }

    function verifySignature(
        bytes32 message_hash,
        uint256 r,
        uint256 s,
        uint256 x,
        uint256 y
    ) internal view returns (bool) {
        // check for signature malleability
        if (s > P256_N_DIV_2) {
            return false;
        }

        return verifySignatureAllowMalleability(message_hash, r, s, x, y);
    }
}
