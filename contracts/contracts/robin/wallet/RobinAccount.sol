// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// New contract (no upstream counterpart). The nest passkey account:
// a minimal smart wallet owned by a single WebAuthn P-256 passkey.
//
// Design goals, in order: small enough to audit by reading, no admin, no
// upgradeability (funds are never subject to an upgrade bug — migration is
// "move funds to a new account"), relayer-agnostic (anyone may submit a
// correctly signed batch; the signature, not the sender, is the authority).
//
// The passkey signs the WebAuthn challenge digestFor(calls, nonce), which
// binds chain id + account address + nonce + the exact call batch — replay
// on another chain, account, or nonce is impossible. User verification
// (Face ID / fingerprint, UV flag) is required on every assertion.
//
// Deployed behind EIP-1167 clones by RobinAccountFactory; initialize is
// called by the factory in the same transaction as the clone.

import {WebAuthn} from "./WebAuthn.sol";

contract RobinAccount {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct WebAuthnAuth {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeLocation;
        uint256 responseTypeLocation;
        uint256 r;
        uint256 s;
    }

    /// @notice Passkey public key (P-256).
    uint256 public pubKeyX;
    uint256 public pubKeyY;
    /// @notice Anti-replay counter; one batch per nonce.
    uint256 public nonce;

    event Initialized(uint256 x, uint256 y);
    event Executed(uint256 indexed nonce, uint256 calls);

    error AlreadyInitialized();
    error BadSignature();
    error CallFailed(uint256 index, bytes reason);

    function initialize(uint256 x, uint256 y) external {
        if (pubKeyX != 0 || pubKeyY != 0) revert AlreadyInitialized();
        pubKeyX = x;
        pubKeyY = y;
        emit Initialized(x, y);
    }

    /// @notice The digest the passkey must sign (as the WebAuthn challenge)
    ///         to execute `calls` at `_nonce`.
    function digestFor(
        Call[] calldata calls,
        uint256 _nonce
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    "robin-account-v1",
                    block.chainid,
                    address(this),
                    _nonce,
                    abi.encode(calls)
                )
            );
    }

    /// @notice Execute a batch authorized by the passkey. Callable by anyone
    ///         (relayers are interchangeable); authority is the signature.
    function executeBatch(
        Call[] calldata calls,
        WebAuthnAuth calldata auth
    ) external payable {
        bytes32 digest = digestFor(calls, nonce);
        if (!_verify(digest, auth)) revert BadSignature();
        uint256 executedNonce = nonce;
        nonce = executedNonce + 1;
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = calls[i].target.call{
                value: calls[i].value
            }(calls[i].data);
            if (!ok) revert CallFailed(i, ret);
        }
        emit Executed(executedNonce, calls.length);
    }

    /// @notice ERC-1271: signatures are abi-encoded WebAuthnAuth over `hash`.
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view returns (bytes4) {
        WebAuthnAuth memory auth = abi.decode(signature, (WebAuthnAuth));
        if (_verifyMem(hash, auth)) return 0x1626ba7e;
        return 0xffffffff;
    }

    function _verify(
        bytes32 digest,
        WebAuthnAuth calldata auth
    ) internal view returns (bool) {
        return
            WebAuthn.verifySignature(
                abi.encodePacked(digest),
                auth.authenticatorData,
                true, // require user verification (Face ID / fingerprint)
                auth.clientDataJSON,
                auth.challengeLocation,
                auth.responseTypeLocation,
                auth.r,
                auth.s,
                pubKeyX,
                pubKeyY
            );
    }

    function _verifyMem(
        bytes32 digest,
        WebAuthnAuth memory auth
    ) internal view returns (bool) {
        return
            WebAuthn.verifySignature(
                abi.encodePacked(digest),
                auth.authenticatorData,
                true,
                auth.clientDataJSON,
                auth.challengeLocation,
                auth.responseTypeLocation,
                auth.r,
                auth.s,
                pubKeyX,
                pubKeyY
            );
    }

    // ------------------------------------------------------------------
    // Receiving: plain ETH, wrapped names (ERC-1155), name NFTs (ERC-721).
    // ------------------------------------------------------------------

    receive() external payable {}

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
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

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x1626ba7e || // ERC-1271
            interfaceId == 0x150b7a02 || // ERC-721 receiver
            interfaceId == 0x4e2312e0; // ERC-1155 receiver
    }
}
