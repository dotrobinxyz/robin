// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {Test, Vm} from "forge-std/Test.sol";
import {RobinAccount} from "../../contracts/robin/wallet/RobinAccount.sol";
import {RobinAccountFactory} from "../../contracts/robin/wallet/RobinAccountFactory.sol";
import {Base64URL} from "../../contracts/robin/wallet/Base64URL.sol";

/// @dev Etched at the RIP-7212 precompile address. Validates a (hash,r,s,x,y)
///      tuple against the fixed test key using foundry's real P-256 signer —
///      so the account tests exercise genuine signatures end to end, and the
///      only thing mocked is WHERE verification runs, not WHETHER the
///      signature is real. Mirrors the live precompile's return behavior
///      (32-byte 1 on valid, empty on invalid), which we verified on mainnet.
contract P256CheatMock {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    uint256 constant PRIV = 1;
    // P-256 generator point = public key for private key 1.
    uint256 constant GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296;
    uint256 constant GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5;
    uint256 constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    fallback(bytes calldata input) external returns (bytes memory) {
        (bytes32 h, uint256 r, uint256 s, uint256 x, uint256 y) = abi.decode(
            input,
            (bytes32, uint256, uint256, uint256, uint256)
        );
        (bytes32 er, bytes32 es) = vm.signP256(PRIV, h);
        uint256 lowS = uint256(es) > N / 2 ? N - uint256(es) : uint256(es);
        bool ok = r == uint256(er) && s == lowS && x == GX && y == GY;
        if (!ok) return "";
        return abi.encode(uint256(1));
    }
}

contract RobinAccountWalletTest is Test {
    uint256 constant GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296;
    uint256 constant GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5;
    uint256 constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    address constant PRECOMPILE = address(0x0000000000000000000000000000000000000100);

    RobinAccountFactory factory;
    RobinAccount account;
    address bob = makeAddr("bob");
    address relayer = makeAddr("relayer");

    function setUp() public {
        vm.etch(PRECOMPILE, type(P256CheatMock).runtimeCode);
        factory = new RobinAccountFactory();
        account = RobinAccount(payable(factory.createAccount(GX, GY)));
        vm.deal(address(account), 10 ether);
        vm.deal(relayer, 1 ether);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _auth(
        bytes32 digest,
        bytes1 flags
    ) internal pure returns (RobinAccount.WebAuthnAuth memory auth) {
        string memory challengeB64 = Base64URL.encode(abi.encodePacked(digest));
        string memory clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            challengeB64,
            '","origin":"https://dotrobin.xyz"}'
        );
        bytes memory authenticatorData = abi.encodePacked(
            bytes32(0), // rpIdHash (not verified on-chain; RP binding is the authenticator's job)
            flags,
            uint32(0)
        );
        bytes32 messageHash = sha256(
            abi.encodePacked(authenticatorData, sha256(bytes(clientDataJSON)))
        );
        (bytes32 r, bytes32 s) = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D)
            .signP256(1, messageHash);
        uint256 lowS = uint256(s) > N / 2 ? N - uint256(s) : uint256(s);
        auth = RobinAccount.WebAuthnAuth({
            authenticatorData: authenticatorData,
            clientDataJSON: clientDataJSON,
            challengeLocation: 23,
            responseTypeLocation: 1,
            r: uint256(r),
            s: lowS
        });
    }

    function _digest(RobinAccount.Call[] memory calls) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    "robin-account-v1",
                    block.chainid,
                    address(account),
                    account.nonce(),
                    abi.encode(calls)
                )
            );
    }

    function _oneCall(
        address target,
        uint256 value,
        bytes memory data
    ) internal pure returns (RobinAccount.Call[] memory calls) {
        calls = new RobinAccount.Call[](1);
        calls[0] = RobinAccount.Call({target: target, value: value, data: data});
    }

    // ------------------------------------------------------------------
    // factory
    // ------------------------------------------------------------------

    function test_deterministic_and_idempotent() public {
        assertEq(factory.getAddress(GX, GY), address(account));
        assertEq(factory.createAccount(GX, GY), address(account));
        assertEq(account.pubKeyX(), GX);
        assertEq(account.pubKeyY(), GY);
    }

    function test_initialize_only_once() public {
        vm.expectRevert(RobinAccount.AlreadyInitialized.selector);
        account.initialize(1, 2);
    }

    // ------------------------------------------------------------------
    // execution
    // ------------------------------------------------------------------

    function test_execute_sends_eth_via_any_relayer() public {
        RobinAccount.Call[] memory calls = _oneCall(bob, 1 ether, "");
        RobinAccount.WebAuthnAuth memory auth = _auth(_digest(calls), 0x05);
        vm.prank(relayer);
        account.executeBatch(calls, auth);
        assertEq(bob.balance, 1 ether);
        assertEq(account.nonce(), 1);
    }

    function test_replay_rejected() public {
        RobinAccount.Call[] memory calls = _oneCall(bob, 1 ether, "");
        RobinAccount.WebAuthnAuth memory auth = _auth(_digest(calls), 0x05);
        account.executeBatch(calls, auth);
        vm.expectRevert(RobinAccount.BadSignature.selector);
        account.executeBatch(calls, auth);
    }

    function test_tampered_batch_rejected() public {
        RobinAccount.Call[] memory calls = _oneCall(bob, 1 ether, "");
        RobinAccount.WebAuthnAuth memory auth = _auth(_digest(calls), 0x05);
        calls[0].value = 2 ether; // tamper after signing
        vm.expectRevert(RobinAccount.BadSignature.selector);
        account.executeBatch(calls, auth);
    }

    function test_missing_user_verification_rejected() public {
        RobinAccount.Call[] memory calls = _oneCall(bob, 1 ether, "");
        // UP only, no UV — Face ID not enforced.
        RobinAccount.WebAuthnAuth memory auth = _auth(_digest(calls), 0x01);
        vm.expectRevert(RobinAccount.BadSignature.selector);
        account.executeBatch(calls, auth);
    }

    function test_garbage_signature_rejected() public {
        RobinAccount.Call[] memory calls = _oneCall(bob, 1 ether, "");
        RobinAccount.WebAuthnAuth memory auth = _auth(_digest(calls), 0x05);
        auth.r = auth.r ^ 1;
        vm.expectRevert(RobinAccount.BadSignature.selector);
        account.executeBatch(calls, auth);
    }

    function test_batch_of_two() public {
        RobinAccount.Call[] memory calls = new RobinAccount.Call[](2);
        calls[0] = RobinAccount.Call({target: bob, value: 0.5 ether, data: ""});
        calls[1] = RobinAccount.Call({target: bob, value: 0.25 ether, data: ""});
        account.executeBatch(calls, _auth(_digest(calls), 0x05));
        assertEq(bob.balance, 0.75 ether);
    }

    function test_inner_revert_bubbles_with_index() public {
        RobinAccount.Call[] memory calls = _oneCall(address(this), 0, abi.encodeWithSignature("boom()"));
        RobinAccount.WebAuthnAuth memory auth = _auth(_digest(calls), 0x05);
        vm.expectRevert();
        account.executeBatch(calls, auth);
        // nonce untouched on failure — the whole batch is atomic.
        assertEq(account.nonce(), 0);
    }

    function boom() external pure {
        revert("nope");
    }

    // ------------------------------------------------------------------
    // ERC-1271 + receivers
    // ------------------------------------------------------------------

    function test_erc1271_valid_and_invalid() public {
        bytes32 hash = keccak256("nest social session");
        RobinAccount.WebAuthnAuth memory auth = _auth(hash, 0x05);
        assertEq(
            account.isValidSignature(hash, abi.encode(auth)),
            bytes4(0x1626ba7e)
        );
        auth.r = auth.r ^ 1;
        assertEq(
            account.isValidSignature(hash, abi.encode(auth)),
            bytes4(0xffffffff)
        );
    }

    function test_receivers() public view {
        assertEq(
            account.onERC721Received(address(0), address(0), 0, ""),
            bytes4(0x150b7a02)
        );
        assertEq(
            account.onERC1155Received(address(0), address(0), 0, 0, ""),
            bytes4(0xf23a6e61)
        );
        assertTrue(account.supportsInterface(0x1626ba7e));
    }
}
