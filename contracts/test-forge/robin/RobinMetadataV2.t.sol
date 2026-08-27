//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {RobinFixture} from "./RobinFixture.sol";
import {RobinMetadataV2} from "../../contracts/robin/RobinMetadataV2.sol";
import {RobinBaseRegistrar} from "../../contracts/robin/RobinBaseRegistrar.sol";
import {RobinWrapper} from "../../contracts/robin/RobinWrapper.sol";
import {IMetadataService} from "../../contracts/wrapper/IMetadataService.sol";
import {CAN_DO_EVERYTHING} from "../../contracts/wrapper/INameWrapper.sol";

contract MetadataV2Harness is RobinMetadataV2 {
    constructor(
        RobinBaseRegistrar _registrar,
        RobinWrapper _wrapper,
        address _owner,
        string[] memory legendaryLabels
    ) RobinMetadataV2(_registrar, _wrapper, _owner, legendaryLabels) {}

    function plumageName(string memory head) external pure returns (string memory) {
        return _plumageName(_plumageIndex(head));
    }

    function plumageHex(string memory head) external pure returns (string memory) {
        return _plumageHex(_plumageIndex(head));
    }
}

contract RobinMetadataV2Test is RobinFixture {
    uint256 constant YEAR = 365 days;
    MetadataV2Harness v2;

    function setUp() public override {
        super.setUp();
        string[] memory legends = new string[](2);
        legends[0] = "vlad";
        legends[1] = "cashcat";
        v2 = new MetadataV2Harness(registrar, wrapper, address(this), legends);
        registrar.setMetadataProvider(v2);
        wrapper.setMetadataService(IMetadataService(address(v2)));
    }

    // ------------------------------------------------------------------
    // tiers + plumage
    // ------------------------------------------------------------------

    function _jsonFor(string memory label) internal returns (string memory) {
        _registerETH(alice, label, YEAR);
        return
            _decodeDataURI(
                registrar.tokenURI(uint256(keccak256(bytes(label)))),
                "data:application/json;base64,"
            );
    }

    function test_tier_common() public {
        string memory json = _jsonFor("goldfinch");
        assertTrue(_contains(json, '"trait_type":"Tier","value":"5+ letters"'));
        assertTrue(
            _contains(
                json,
                string.concat(
                    '"trait_type":"Plumage","value":"',
                    v2.plumageName("goldfinch"),
                    '"'
                )
            )
        );
        string memory svg = _svgOf(json);
        assertTrue(_contains(svg, 'fill="#1A1714"')); // night ground
        assertTrue(_contains(svg, "9 LETTERS"));
        assertTrue(_contains(svg, v2.plumageHex("goldfinch"))); // the bird
        assertTrue(_contains(svg, ">goldfinch</tspan>"));
        assertTrue(_contains(svg, ">.robin</tspan>"));
    }

    function test_tier_rare4() public {
        string memory json = _jsonFor("leet");
        assertTrue(_contains(json, '"trait_type":"Tier","value":"4 letters"'));
        assertTrue(_contains(_svgOf(json), "4 LETTERS"));
    }

    function test_tier_ultra3() public {
        string memory json = _jsonFor("gcr");
        assertTrue(_contains(json, '"trait_type":"Tier","value":"3 letters"'));
        string memory svg = _svgOf(json);
        assertTrue(_contains(svg, "3 LETTERS"));
        // ultra chip is green-filled with charcoal text
        assertTrue(_contains(svg, string.concat('fill="', "#CCFF00", '"/><text')));
    }

    function test_tier_legendary() public {
        string memory json = _jsonFor("vlad");
        assertTrue(_contains(json, '"trait_type":"Tier","value":"Legendary"'));
        string memory svg = _svgOf(json);
        // inverted ground: the card itself is green
        assertTrue(
            _contains(
                svg,
                '<rect width="1000" height="1000" fill="#CCFF00"/>'
            )
        );
        assertTrue(_contains(svg, "LEGENDARY"));
        // name band is night-filled on the legendary card
        assertTrue(_contains(svg, 'height="120" fill="#1A1714"'));
    }

    function test_legendary_beats_length() public {
        // cashcat is 7 letters but curated → Legendary, not 5+.
        string memory json = _jsonFor("cashcat");
        assertTrue(_contains(json, '"trait_type":"Tier","value":"Legendary"'));
        assertFalse(_contains(json, '"value":"5+ letters"'));
    }

    function test_setLegendary_onlyOwner_and_effect() public {
        string[] memory labels = new string[](1);
        labels[0] = "leet";

        vm.prank(alice);
        vm.expectRevert("not owner");
        v2.setLegendary(labels, true);

        _registerETH(alice, "leet", YEAR);
        uint256 id = uint256(keccak256("leet"));
        assertTrue(
            _contains(
                _decodeDataURI(
                    registrar.tokenURI(id),
                    "data:application/json;base64,"
                ),
                '"value":"4 letters"'
            )
        );

        v2.setLegendary(labels, true);
        assertTrue(
            _contains(
                _decodeDataURI(
                    registrar.tokenURI(id),
                    "data:application/json;base64,"
                ),
                '"value":"Legendary"'
            )
        );

        v2.setLegendary(labels, false);
        assertTrue(
            _contains(
                _decodeDataURI(
                    registrar.tokenURI(id),
                    "data:application/json;base64,"
                ),
                '"value":"4 letters"'
            )
        );
    }

    function test_plumage_deterministic_and_varied() public view {
        // Same name → same plumage, forever.
        assertEq(v2.plumageName("dallas"), v2.plumageName("dallas"));
        // Across a small set at least two plumages appear (sanity, not proof).
        string[6] memory names = ["dallas", "spigen", "jordan", "trump", "general", "goldfinch"];
        bool varied = false;
        for (uint256 i = 1; i < names.length; i++) {
            if (
                keccak256(bytes(v2.plumageName(names[i]))) !=
                keccak256(bytes(v2.plumageName(names[0])))
            ) {
                varied = true;
                break;
            }
        }
        assertTrue(varied);
    }

    // ------------------------------------------------------------------
    // wrapper paths
    // ------------------------------------------------------------------

    function test_uri_wrapped2LD_and_subname() public {
        _registerETH(alice, "goldfinch", YEAR);
        vm.startPrank(alice);
        registrar.setApprovalForAll(address(wrapper), true);
        wrapper.wrapETH2LD("goldfinch", alice, uint16(CAN_DO_EVERYTHING), address(0));
        bytes32 parentNode = _robinNode("goldfinch");
        bytes32 subNode = wrapper.setSubnodeOwner(parentNode, "bot1", bob, 0, type(uint64).max);
        vm.stopPrank();

        string memory json = _decodeDataURI(
            wrapper.uri(uint256(parentNode)),
            "data:application/json;base64,"
        );
        assertTrue(_contains(json, '"name":"goldfinch.robin"'));
        assertTrue(_contains(json, '"trait_type":"Kind","value":"Wrapped Name"'));
        assertTrue(_contains(json, '"trait_type":"Tier","value":"5+ letters"'));
        // a wrapped 2LD is emancipated by construction — badge wins the chip
        assertTrue(_contains(_svgOf(json), "EMANCIPATED"));

        json = _decodeDataURI(
            wrapper.uri(uint256(subNode)),
            "data:application/json;base64,"
        );
        assertTrue(_contains(json, '"name":"bot1.goldfinch.robin"'));
        assertTrue(_contains(json, '"trait_type":"Kind","value":"Subname"'));
        // subnames don't ride the ladder — no Tier trait, but plumage renders
        assertFalse(_contains(json, '"trait_type":"Tier"'));
        assertTrue(_contains(json, '"trait_type":"Plumage"'));
    }

    function test_grace_badge_overrides_tier_chip() public {
        _registerETH(alice, "goldfinch", YEAR);
        uint256 id = uint256(keccak256("goldfinch"));
        vm.warp(registrar.nameExpires(id) + 1);
        string memory svg = _svgOf(
            _decodeDataURI(
                registrar.tokenURI(id),
                "data:application/json;base64,"
            )
        );
        assertTrue(_contains(svg, "IN GRACE PERIOD"));
        assertFalse(_contains(svg, "9 LETTERS"));
    }

    // ------------------------------------------------------------------
    // hardening carried over from v1
    // ------------------------------------------------------------------

    function test_hostileLabel_escaped() public {
        string memory hostile = 'a"b<c>&d';
        vm.prank(address(controller));
        registrar.registerWithLabel(hostile, alice, YEAR);
        uint256 id = uint256(keccak256(bytes(hostile)));

        string memory json = _decodeDataURI(
            registrar.tokenURI(id),
            "data:application/json;base64,"
        );
        assertTrue(_contains(json, '"name":"a\\"b<c>&d.robin"'));
        assertTrue(_contains(_svgOf(json), ">a&quot;b&lt;c&gt;&amp;d</tspan>"));
    }

    function test_emojiName() public {
        string memory emoji = unicode"🐦🐦🐦";
        _registerETH(alice, emoji, YEAR);
        string memory json = _decodeDataURI(
            registrar.tokenURI(uint256(keccak256(bytes(emoji)))),
            "data:application/json;base64,"
        );
        assertTrue(_contains(json, string.concat('"name":"', emoji, '.robin"')));
        assertTrue(_contains(json, '"trait_type":"Tier","value":"3 letters"'));
    }

    function test_unknownNodeFallback() public {
        string memory json = _decodeDataURI(
            wrapper.uri(uint256(keccak256("no-such-node"))),
            "data:application/json;base64,"
        );
        assertTrue(_contains(json, '"name":"[0x'));
    }

    function test_contractURI() public view {
        string memory json = _decodeDataURI(
            registrar.contractURI(),
            "data:application/json;base64,"
        );
        assertTrue(_contains(json, '"name":"Robin Names"'));
    }

    // ------------------------------------------------------------------
    // utilities (as in RobinMetadata.t.sol)
    // ------------------------------------------------------------------

    function _svgOf(string memory json) internal pure returns (string memory) {
        return
            _decodeDataURI(_extractImage(json), "data:image/svg+xml;base64,");
    }

    function _extractImage(
        string memory json
    ) internal pure returns (string memory) {
        bytes memory b = bytes(json);
        bytes memory key = bytes('"image":"');
        uint256 start = _indexOf(b, key, 0);
        require(start != type(uint256).max, "image not found");
        start += key.length;
        uint256 end = start;
        while (end < b.length && b[end] != '"') {
            end++;
        }
        bytes memory out = new bytes(end - start);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = b[start + i];
        }
        return string(out);
    }

    function _decodeDataURI(
        string memory uri_,
        string memory expectedPrefix
    ) internal pure returns (string memory) {
        bytes memory b = bytes(uri_);
        bytes memory prefix = bytes(expectedPrefix);
        require(b.length > prefix.length, "uri too short");
        for (uint256 i = 0; i < prefix.length; i++) {
            require(b[i] == prefix[i], "prefix mismatch");
        }
        bytes memory payload = new bytes(b.length - prefix.length);
        for (uint256 i = 0; i < payload.length; i++) {
            payload[i] = b[prefix.length + i];
        }
        return string(_base64Decode(payload));
    }

    function _base64Decode(
        bytes memory input
    ) internal pure returns (bytes memory) {
        bytes memory table = new bytes(256);
        bytes memory alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (uint256 i = 0; i < 64; i++) {
            table[uint8(alphabet[i])] = bytes1(uint8(i));
        }
        uint256 len = input.length;
        uint256 padding = 0;
        while (padding < len && input[len - 1 - padding] == "=") {
            padding++;
        }
        uint256 outLen = (len / 4) * 3 - padding;
        bytes memory out = new bytes(outLen);
        uint256 j = 0;
        for (uint256 i = 0; i < len; i += 4) {
            uint256 chunk = (uint256(uint8(table[uint8(input[i])])) << 18) |
                (uint256(uint8(table[uint8(input[i + 1])])) << 12) |
                (uint256(uint8(table[uint8(input[i + 2])])) << 6) |
                uint256(uint8(table[uint8(input[i + 3])]));
            if (j < outLen) out[j++] = bytes1(uint8(chunk >> 16));
            if (j < outLen) out[j++] = bytes1(uint8(chunk >> 8));
            if (j < outLen) out[j++] = bytes1(uint8(chunk));
        }
        return out;
    }

    function _indexOf(
        bytes memory haystack,
        bytes memory needle,
        uint256 from
    ) internal pure returns (uint256) {
        if (needle.length == 0 || haystack.length < needle.length) {
            return type(uint256).max;
        }
        for (uint256 i = from; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        return type(uint256).max;
    }

    function _contains(
        string memory haystack,
        string memory needle
    ) internal pure returns (bool) {
        return
            _indexOf(bytes(haystack), bytes(needle), 0) != type(uint256).max;
    }
}
