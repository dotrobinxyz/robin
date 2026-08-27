//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IMetadataService} from "../wrapper/IMetadataService.sol";
import {PARENT_CANNOT_CONTROL, CANNOT_UNWRAP} from "../wrapper/INameWrapper.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {IRobinTokenURIProvider} from "./IRobinTokenURIProvider.sol";
import {RobinBaseRegistrar} from "./RobinBaseRegistrar.sol";
import {RobinWrapper} from "./RobinWrapper.sol";

/// @title RobinMetadataV2
/// @notice Fully on-chain metadata for Robin names, second edition: the main
///         brand (night ground, robin green, buff), a pixel robin whose
///         plumage is derived from the name itself, and a rarity ladder —
///         Legendary (curated), 3 letters, 4 letters, 5+ letters. JSON + SVG
///         rendered from contract state, served as data: URIs. No metadata
///         server, no external dependency.
///
///         Serves both collections:
///         - `tokenURI721(id)` for the ERC-721 base registrar
///           (id = uint256(labelhash); label read from the registrar).
///         - `uri(id)` (IMetadataService) for the ERC-1155 wrapper
///           (id = uint256(namehash); name read from the wrapper's DNS-encoded
///           `names` mapping).
///
/// @dev View-only renderer over registrar/wrapper state; swappable by their
///      owner without touching registration state. The only storage here is
///      the curated legendary set, extendable by `owner` (the treasury Safe).
contract RobinMetadataV2 is IMetadataService, IRobinTokenURIProvider {
    using StringUtils for *;

    RobinBaseRegistrar public immutable registrar;
    RobinWrapper public immutable wrapper;

    // Brand tokens (web app §5): night ground, one loud green, buff ink.
    string private constant NIGHT = "#1A1714";
    string private constant GREEN = "#CCFF00";
    string private constant BUFF = "#F1EADF";
    string private constant GREY = "#8C8578";
    string private constant CHAR = "#2A2622";
    string private constant DIM = "#26221D";

    // 16x16 pixel robins as (x, y, width, palette-index) runs.
    // palette: 0 plumage, 1 green, 2 charcoal, 3 grey, 4 buff.
    bytes internal constant SPRITE_COMMON =
        hex"0601040005020600050301000603010207030400050406000b04010302050100050506000b050103020602000506060002070500070702010907020003080400070803010a08010003090300060904010a090100040a0200060a04010a0a0100050b0100060b0301090b0100060c0300050d0103080d0103040e0603";
    bytes internal constant SPRITE_RARE =
        hex"0601040005020600050301000603010207030400050406000b04010302050101050506000b0501030206020105060600020703010507020007070201090702000308020105080200070803010a0801000309020105090100060904010a090100040a0200060a04010a0a0100050b0100060b0301090b0100060c0300050d0103080d0103040e0601";
    bytes internal constant SPRITE_ULTRA =
        hex"0600010008000100060103000602040105030601050401010604010207040401050506010b05010302060101050606010b060103020702010507060102080501070802040908020103090401070903040a090101030a0301060a04040a0a0101040b0201060b04040a0b0101050c0101060c0304090c0101060d0301050e0103080e0103040f0600";
    bytes internal constant SPRITE_LEGEND =
        hex"0600010408000104060103040602040205030602050401020604010407040402050506020b05010202060102050606020b060102020702020507060202080502070802040908020203090402070903040a090102030a0302060a04040a0a0102040b0202060b04040a0b0102050c0102060c0304090c0102060d0302050e0102080e0102040f0604";

    uint8 private constant TIER_COMMON = 0;
    uint8 private constant TIER_RARE = 1;
    uint8 private constant TIER_ULTRA = 2;
    uint8 private constant TIER_LEGEND = 3;

    /// @notice The treasury Safe — curates the legendary set.
    address public owner;

    /// @notice Curated legendary labelhashes (keccak256 of the bare label).
    mapping(bytes32 => bool) public legendary;

    event LegendarySet(string label, bool flag);
    event OwnerChanged(address owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        RobinBaseRegistrar _registrar,
        RobinWrapper _wrapper,
        address _owner,
        string[] memory legendaryLabels
    ) {
        registrar = _registrar;
        wrapper = _wrapper;
        owner = _owner;
        for (uint256 i = 0; i < legendaryLabels.length; i++) {
            legendary[keccak256(bytes(legendaryLabels[i]))] = true;
            emit LegendarySet(legendaryLabels[i], true);
        }
    }

    /// @notice Crown (or uncrown) labels. Owner-only — the treasury Safe.
    function setLegendary(
        string[] calldata labels,
        bool flag
    ) external onlyOwner {
        for (uint256 i = 0; i < labels.length; i++) {
            legendary[keccak256(bytes(labels[i]))] = flag;
            emit LegendarySet(labels[i], flag);
        }
    }

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
        emit OwnerChanged(_owner);
    }

    // ------------------------------------------------------------------
    // ERC-721 (base registrar)
    // ------------------------------------------------------------------

    /// @inheritdoc IRobinTokenURIProvider
    function tokenURI721(uint256 id) external view returns (string memory) {
        string memory label = registrar.labels(id);
        uint256 expiry = registrar.nameExpires(id);

        string memory display;
        uint256 len;
        if (bytes(label).length == 0) {
            // Registered without a recorded label (e.g. a future controller
            // using plain `register`): fall back to the labelhash.
            display = string.concat("[", _shortHex(bytes32(id)), "].robin");
            len = 0;
        } else {
            display = string.concat(label, ".robin");
            len = label.strlen();
        }

        uint8 tier = _tier(label, len);
        string memory badge = _lifecycleBadge(expiry, registrar.GRACE_PERIOD());

        return _buildURI(display, len, expiry, badge, "Name", false, tier);
    }

    /// @inheritdoc IRobinTokenURIProvider
    function contractURI() external pure returns (string memory) {
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        _svgOpen(NIGHT),
                        _sprite(SPRITE_COMMON, [BUFF, GREEN, CHAR, GREY, BUFF]),
                        "<text x=\"500\" y=\"780\" text-anchor=\"middle\" font-family=\"",
                        _fontStack(),
                        "\" font-size=\"96\" font-weight=\"600\" letter-spacing=\"6\" fill=\"",
                        BUFF,
                        "\">robin</text></svg>"
                    )
                )
            )
        );
        return
            string.concat(
                "data:application/json;base64,",
                Base64.encode(
                    bytes(
                        string.concat(
                            "{\"name\":\"Robin Names\",\"description\":\"Robin names on Robinhood Chain. Human-readable names with annual renewals, standards-compliant resolution, and tradeable subdomains.\",\"image\":\"",
                            image,
                            "\"}"
                        )
                    )
                )
            );
    }

    // ------------------------------------------------------------------
    // ERC-1155 (wrapper)
    // ------------------------------------------------------------------

    /// @inheritdoc IMetadataService
    function uri(uint256 id) external view returns (string memory) {
        bytes memory dnsName = wrapper.names(bytes32(id));
        (, uint32 fuses, uint64 wrapperExpiry) = wrapper.getData(id);

        (
            string memory display,
            string memory firstLabel,
            uint256 labelCount,
            bool ok
        ) = _decodeDNS(dnsName);

        if (!ok || labelCount == 0) {
            display = string.concat("[", _shortHex(bytes32(id)), "]");
            return
                _buildURI(display, 0, 0, "", "Wrapped Name", true, TIER_COMMON);
        }

        bool is2LD = labelCount == 2;
        uint256 expiry;
        string memory badge;
        if (is2LD) {
            // For .robin second-level names the wrapper stores expiry + grace;
            // display the registrar's expiry, which is the meaningful date.
            expiry = registrar.nameExpires(
                uint256(keccak256(bytes(firstLabel)))
            );
            badge = _lifecycleBadge(expiry, registrar.GRACE_PERIOD());
        } else {
            expiry = wrapperExpiry == type(uint64).max ? 0 : wrapperExpiry;
            if (expiry != 0 && block.timestamp > expiry) {
                badge = "EXPIRED";
            }
        }

        if (bytes(badge).length == 0) {
            if (fuses & PARENT_CANNOT_CONTROL != 0) {
                badge = fuses & CANNOT_UNWRAP != 0 ? "LOCKED" : "EMANCIPATED";
            } else {
                badge = "WRAPPED";
            }
        }

        uint256 len = firstLabel.strlen();
        // Only second-level names ride the rarity ladder; a subname is common
        // by construction and can never be legendary.
        uint8 tier = is2LD ? _tier(firstLabel, len) : TIER_COMMON;

        return
            _buildURI(
                display,
                is2LD ? len : 0,
                expiry,
                badge,
                is2LD ? "Wrapped Name" : "Subname",
                true,
                tier
            );
    }

    // ------------------------------------------------------------------
    // Tiers + plumage
    // ------------------------------------------------------------------

    function _tier(
        string memory label,
        uint256 len
    ) internal view returns (uint8) {
        if (len == 0) return TIER_COMMON;
        if (legendary[keccak256(bytes(label))]) return TIER_LEGEND;
        if (len == 3) return TIER_ULTRA;
        if (len == 4) return TIER_RARE;
        return TIER_COMMON;
    }

    function _tierName(
        uint8 tier,
        uint256 len
    ) internal pure returns (string memory) {
        if (tier == TIER_LEGEND) return "LEGENDARY";
        if (tier == TIER_ULTRA) return "3 LETTERS";
        if (tier == TIER_RARE) return "4 LETTERS";
        return string.concat(Strings.toString(len), " LETTERS");
    }

    function _tierTrait(uint8 tier) internal pure returns (string memory) {
        if (tier == TIER_LEGEND) return "Legendary";
        if (tier == TIER_ULTRA) return "3 letters";
        if (tier == TIER_RARE) return "4 letters";
        return "5+ letters";
    }

    /// @dev Plumage index from the name — stable forever, unique per name.
    function _plumageIndex(
        string memory head
    ) internal pure returns (uint256) {
        return
            uint8(bytes32(keccak256(abi.encodePacked("plumage:", head)))[0]) %
            11;
    }

    function _plumageHex(uint256 i) internal pure returns (string memory) {
        if (i == 0) return "#F1EADF";
        if (i == 1) return "#37C6B4";
        if (i == 2) return "#7EC8E3";
        if (i == 3) return "#9FB0BA";
        if (i == 4) return "#E86A4A";
        if (i == 5) return "#D98E4A";
        if (i == 6) return "#E89BB8";
        if (i == 7) return "#B49BE8";
        if (i == 8) return "#C7524A";
        if (i == 9) return "#A8826A";
        return "#FFFFFF";
    }

    function _plumageName(uint256 i) internal pure returns (string memory) {
        if (i == 0) return "buff";
        if (i == 1) return "robin-egg";
        if (i == 2) return "sky";
        if (i == 3) return "steel";
        if (i == 4) return "coral";
        if (i == 5) return "rust";
        if (i == 6) return "rose";
        if (i == 7) return "lavender";
        if (i == 8) return "crimson";
        if (i == 9) return "cocoa";
        return "snow";
    }

    // ------------------------------------------------------------------
    // JSON + SVG assembly
    // ------------------------------------------------------------------

    function _buildURI(
        string memory display,
        uint256 nameLength,
        uint256 expiry,
        string memory badge,
        string memory kind,
        bool wrapped,
        uint8 tier
    ) internal view returns (string memory) {
        (string memory head, ) = _stripRobinSuffix(display);
        uint256 plume = _plumageIndex(head);

        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(
                bytes(
                    _svg(
                        Card({
                            display: display,
                            head: head,
                            len: nameLength,
                            expiry: expiry,
                            badge: badge,
                            tier: tier,
                            plume: plume
                        })
                    )
                )
            )
        );

        string memory attrs = string.concat(
            "[{\"trait_type\":\"Kind\",\"value\":\"",
            kind,
            "\"}"
        );
        if (nameLength > 0) {
            attrs = string.concat(
                attrs,
                ",{\"trait_type\":\"Length\",\"display_type\":\"number\",\"value\":",
                Strings.toString(nameLength),
                "},{\"trait_type\":\"Tier\",\"value\":\"",
                _tierTrait(tier),
                "\"}"
            );
        }
        attrs = string.concat(
            attrs,
            ",{\"trait_type\":\"Plumage\",\"value\":\"",
            _plumageName(plume),
            "\"}"
        );
        if (expiry > 0) {
            attrs = string.concat(
                attrs,
                ",{\"trait_type\":\"Expiration Date\",\"display_type\":\"date\",\"value\":",
                Strings.toString(expiry),
                "}"
            );
        }
        attrs = string.concat(attrs, "]");

        string memory escaped = _escapeJSON(display);
        string memory json = string.concat(
            "{\"name\":\"",
            escaped,
            "\",\"description\":\"",
            escaped,
            wrapped
                ? ", a wrapped Robin name on Robinhood Chain.\""
                : ", a Robin name on Robinhood Chain.\"",
            ",\"image\":\"",
            image,
            "\",\"attributes\":",
            attrs,
            "}"
        );

        return
            string.concat(
                "data:application/json;base64,",
                Base64.encode(bytes(json))
            );
    }

    struct Card {
        string display;
        string head;
        uint256 len;
        uint256 expiry;
        string badge;
        uint8 tier;
        uint256 plume;
    }

    function _svg(Card memory c) internal pure returns (string memory) {
        bool legend = c.tier == TIER_LEGEND;
        string memory plumeHex = _plumageHex(c.plume);
        string memory ink = legend ? CHAR : GREY;

        return
            string.concat(
                _svgOpen(legend ? GREEN : NIGHT),
                legend
                    ? _scatterLegend(c.head)
                    : _scatter(c.head, c.tier, plumeHex),
                "<text x=\"60\" y=\"95\" font-family=\"",
                _fontStack(),
                "\" font-size=\"30\" letter-spacing=\"4\" fill=\"",
                ink,
                "\">robin</text>",
                _chipFor(c),
                _spriteFor(c.tier, plumeHex),
                _nameBand(c.display, legend),
                _expiryLine(c.expiry, ink),
                "</svg>"
            );
    }

    /// @dev Chip text: lifecycle/wrapper state wins over the tier label.
    function _chipFor(Card memory c) internal pure returns (string memory) {
        bool isBadge = bytes(c.badge).length > 0;
        string memory text = isBadge
            ? c.badge
            : c.len > 0
                ? _tierName(c.tier, c.len)
                : "";
        return _chip(text, c.tier, isBadge);
    }

    function _spriteFor(
        uint8 tier,
        string memory plumeHex
    ) internal pure returns (string memory) {
        // palette: 0 plumage, 1 green, 2 charcoal, 3 grey, 4 buff
        string[5] memory pal = [plumeHex, GREEN, CHAR, GREY, BUFF];
        if (tier == TIER_LEGEND) return _sprite(SPRITE_LEGEND, pal);
        if (tier == TIER_ULTRA) return _sprite(SPRITE_ULTRA, pal);
        if (tier == TIER_RARE) return _sprite(SPRITE_RARE, pal);
        return _sprite(SPRITE_COMMON, pal);
    }

    /// @dev Emit run-encoded sprite rects at x0=308, y0=190, scale 24.
    function _sprite(
        bytes memory runs,
        string[5] memory pal
    ) internal pure returns (string memory out) {
        for (uint256 i = 0; i < runs.length; i += 4) {
            out = string.concat(
                out,
                "<rect x=\"",
                Strings.toString(308 + uint256(uint8(runs[i])) * 24),
                "\" y=\"",
                Strings.toString(190 + uint256(uint8(runs[i + 1])) * 24),
                "\" width=\"",
                Strings.toString(uint256(uint8(runs[i + 2])) * 24),
                "\" height=\"24\" fill=\"",
                pal[uint8(runs[i + 3])],
                "\"/>"
            );
        }
    }

    /// @dev Deterministic pixel field; a few green + plumage pixels, dim rest.
    function _scatter(
        string memory head,
        uint8 tier,
        string memory plumeHex
    ) internal pure returns (string memory out) {
        bytes32 h = keccak256(bytes(head));
        uint256 greens = tier == TIER_ULTRA ? 6 : tier == TIER_RARE ? 4 : 2;
        for (uint256 i = 0; i < 26; i++) {
            (uint256 x, uint256 y, uint256 s) = _scatterXY(h, i);
            if (y > 180 && y < 760 && x > 220 && x < 780) continue;
            string memory fill = i < greens
                ? GREEN
                : i < greens + 3
                    ? plumeHex
                    : DIM;
            string memory op = i < greens ? "0.9" : i < greens + 3
                ? "0.55"
                : "1";
            out = string.concat(out, _pixel(x, y, s, fill, op));
        }
    }

    function _scatterLegend(
        string memory head
    ) internal pure returns (string memory out) {
        bytes32 h = keccak256(bytes(head));
        for (uint256 i = 0; i < 26; i++) {
            (uint256 x, uint256 y, uint256 s) = _scatterXY(h, i);
            if (y > 180 && y < 760 && x > 220 && x < 780) continue;
            out = string.concat(
                out,
                _pixel(x, y, s, i < 6 ? BUFF : CHAR, i < 6 ? "0.9" : "0.35")
            );
        }
    }

    function _scatterXY(
        bytes32 h,
        uint256 i
    ) internal pure returns (uint256 x, uint256 y, uint256 s) {
        x =
            (((uint256(uint8(h[i % 32])) * 256 +
                uint256(uint8(h[(i + 7) % 32]))) % 92) * 10) +
            20;
        y =
            (((uint256(uint8(h[(i + 13) % 32])) * 256 +
                uint256(uint8(h[(i + 19) % 32]))) % 92) * 10) +
            20;
        s = 8 + (uint256(uint8(h[(i + 3) % 32])) % 3) * 4;
    }

    function _pixel(
        uint256 x,
        uint256 y,
        uint256 s,
        string memory fill,
        string memory op
    ) internal pure returns (string memory) {
        return
            string.concat(
                "<rect x=\"",
                Strings.toString(x),
                "\" y=\"",
                Strings.toString(y),
                "\" width=\"",
                Strings.toString(s),
                "\" height=\"",
                Strings.toString(s),
                "\" fill=\"",
                fill,
                "\" opacity=\"",
                op,
                "\"/>"
            );
    }

    /// @dev Top-right chip, width fitted to the text. Styles: legendary =
    ///      night fill/green text; ultra = green fill/charcoal text; rare =
    ///      green outline; common + badges = grey outline.
    function _chip(
        string memory text,
        uint8 tier,
        bool isBadge
    ) internal pure returns (string memory) {
        uint256 tl = _visualLength(text);
        if (tl == 0) return "";
        uint256 w = tl * 15 + 40;
        uint256 x = 940 - w;
        string memory rect;
        string memory fill;
        if (!isBadge && tier == TIER_LEGEND) {
            rect = string.concat("fill=\"", NIGHT, "\"");
            fill = GREEN;
        } else if (!isBadge && tier == TIER_ULTRA) {
            rect = string.concat("fill=\"", GREEN, "\"");
            fill = CHAR;
        } else if (!isBadge && tier == TIER_RARE) {
            rect = string.concat(
                "fill=\"none\" stroke=\"",
                GREEN,
                "\" stroke-width=\"2\""
            );
            fill = GREEN;
        } else {
            rect = string.concat(
                "fill=\"none\" stroke=\"",
                GREY,
                "\" stroke-width=\"2\""
            );
            fill = GREY;
        }
        return
            string.concat(
                "<rect x=\"",
                Strings.toString(x),
                "\" y=\"60\" rx=\"22\" ry=\"22\" width=\"",
                Strings.toString(w),
                "\" height=\"44\" ",
                rect,
                "/><text x=\"",
                Strings.toString(x + w / 2),
                "\" y=\"89\" text-anchor=\"middle\" font-family=\"",
                _fontStack(),
                "\" font-size=\"22\" letter-spacing=\"2\" fill=\"",
                fill,
                "\">",
                text,
                "</text>"
            );
    }

    /// @dev The band chip holding the name. Outlined green on night cards;
    ///      night-filled on the legendary green ground.
    function _nameBand(
        string memory display,
        bool legend
    ) internal pure returns (string memory) {
        (string memory head, bool hasSuffix) = _stripRobinSuffix(display);
        uint256 vlen = _visualLength(display);
        uint256 fs = 760 / (vlen > 0 ? vlen : 1);
        if (fs > 72) fs = 72;
        if (fs < 14) fs = 14;
        uint256 w = (vlen * fs * 62) / 100 + 90;
        if (w > 880) w = 880;
        uint256 x = (1000 - w) / 2;

        string memory nameText = hasSuffix
            ? string.concat(
                "<tspan fill=\"",
                BUFF,
                "\">",
                _escapeXML(head),
                "</tspan><tspan fill=\"",
                GREEN,
                "\">.robin</tspan>"
            )
            : string.concat(
                "<tspan fill=\"",
                BUFF,
                "\">",
                _escapeXML(display),
                "</tspan>"
            );

        return
            string.concat(
                "<rect x=\"",
                Strings.toString(x),
                "\" y=\"640\" rx=\"60\" ry=\"60\" width=\"",
                Strings.toString(w),
                "\" height=\"120\" ",
                legend
                    ? string.concat("fill=\"", NIGHT, "\"")
                    : string.concat(
                        "fill=\"none\" stroke=\"",
                        GREEN,
                        "\" stroke-width=\"5\""
                    ),
                "/><text x=\"500\" y=\"",
                Strings.toString(700 + (fs * 34) / 100),
                "\" text-anchor=\"middle\" font-family=\"",
                _fontStack(),
                "\" font-size=\"",
                Strings.toString(fs),
                "\" font-weight=\"600\">",
                nameText,
                "</text>"
            );
    }

    function _expiryLine(
        uint256 expiry,
        string memory ink
    ) internal pure returns (string memory) {
        if (expiry == 0) return "";
        return
            string.concat(
                "<text x=\"500\" y=\"850\" text-anchor=\"middle\" font-family=\"",
                _fontStack(),
                "\" font-size=\"26\" letter-spacing=\"3\" fill=\"",
                ink,
                "\">EXPIRES ",
                _dateString(expiry),
                "</text>"
            );
    }

    function _svgOpen(
        string memory ground
    ) internal pure returns (string memory) {
        return
            string.concat(
                "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1000\" height=\"1000\" viewBox=\"0 0 1000 1000\" shape-rendering=\"crispEdges\"><rect width=\"1000\" height=\"1000\" fill=\"",
                ground,
                "\"/>"
            );
    }

    function _fontStack() internal pure returns (string memory) {
        return "ui-monospace,Menlo,Consolas,monospace";
    }

    /// @dev Codepoint count with 4-byte (wide) codepoints counted double.
    function _visualLength(
        string memory s_
    ) internal pure returns (uint256 vlen) {
        bytes memory b = bytes(s_);
        uint256 i = 0;
        while (i < b.length) {
            uint8 c = uint8(b[i]);
            if (c < 0x80) {
                i += 1;
                vlen += 1;
            } else if (c < 0xE0) {
                i += 2;
                vlen += 1;
            } else if (c < 0xF0) {
                i += 3;
                vlen += 1;
            } else {
                i += 4;
                vlen += 2;
            }
        }
    }

    // ------------------------------------------------------------------
    // Helpers (unchanged from v1)
    // ------------------------------------------------------------------

    /// @dev Decodes a DNS-encoded name ("\x05robin\x00" style) into a dotted
    ///      display string. Returns ok=false on malformed input.
    function _decodeDNS(
        bytes memory dnsName
    )
        internal
        pure
        returns (
            string memory display,
            string memory firstLabel,
            uint256 labelCount,
            bool ok
        )
    {
        uint256 i = 0;
        bytes memory out;
        while (i < dnsName.length) {
            uint256 len = uint8(dnsName[i]);
            if (len == 0) {
                return (string(out), firstLabel, labelCount, true);
            }
            i++;
            if (i + len > dnsName.length) {
                return ("", "", 0, false);
            }
            bytes memory label = new bytes(len);
            for (uint256 j = 0; j < len; j++) {
                label[j] = dnsName[i + j];
            }
            if (labelCount == 0) {
                firstLabel = string(label);
                out = label;
            } else {
                out = bytes.concat(out, ".", label);
            }
            labelCount++;
            i += len;
        }
        return ("", "", 0, false);
    }

    /// @dev Splits "x.y.robin" into ("x.y", true); returns (display, false)
    ///      when the name doesn't end in ".robin".
    function _stripRobinSuffix(
        string memory display
    ) internal pure returns (string memory, bool) {
        bytes memory b = bytes(display);
        bytes memory suffix = ".robin";
        if (b.length <= suffix.length) {
            return (display, false);
        }
        for (uint256 i = 0; i < suffix.length; i++) {
            if (b[b.length - suffix.length + i] != suffix[i]) {
                return (display, false);
            }
        }
        bytes memory head = new bytes(b.length - suffix.length);
        for (uint256 i = 0; i < head.length; i++) {
            head[i] = b[i];
        }
        return (string(head), true);
    }

    function _lifecycleBadge(
        uint256 expiry,
        uint256 gracePeriod
    ) internal view returns (string memory) {
        if (expiry == 0 || block.timestamp <= expiry) {
            return "";
        }
        if (block.timestamp <= expiry + gracePeriod) {
            return "IN GRACE PERIOD";
        }
        return "EXPIRED";
    }

    function _shortHex(bytes32 value) internal pure returns (string memory) {
        bytes memory full = bytes(Strings.toHexString(uint256(value), 32));
        // 0x + first 6 + ellipsis + last 6
        bytes memory out = new bytes(2 + 6 + 3 + 6);
        for (uint256 i = 0; i < 8; i++) {
            out[i] = full[i];
        }
        out[8] = 0xE2; // UTF-8 ellipsis …
        out[9] = 0x80;
        out[10] = 0xA6;
        for (uint256 i = 0; i < 6; i++) {
            out[11 + i] = full[full.length - 6 + i];
        }
        return string(out);
    }

    /// @dev "YYYY-MM-DD" from a unix timestamp (days-from-civil inverse,
    ///      Howard Hinnant's algorithm).
    function _dateString(uint256 ts) internal pure returns (string memory) {
        uint256 z = ts / 86400 + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 d = doy - (153 * mp + 2) / 5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) {
            y += 1;
        }
        return
            string.concat(
                Strings.toString(y),
                "-",
                _pad2(m),
                "-",
                _pad2(d)
            );
    }

    function _pad2(uint256 v) internal pure returns (string memory) {
        return
            v < 10
                ? string.concat("0", Strings.toString(v))
                : Strings.toString(v);
    }

    /// @dev JSON string escaping: quote, backslash, and control bytes.
    ///      Multi-byte UTF-8 passes through untouched.
    function _escapeJSON(
        string memory value
    ) internal pure returns (string memory) {
        bytes memory b = bytes(value);
        uint256 extra = 0;
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c == 0x22 || c == 0x5C) {
                extra += 1;
            } else if (c < 0x20) {
                extra += 5; // \u00XX
            }
        }
        if (extra == 0) {
            return value;
        }
        bytes memory out = new bytes(b.length + extra);
        uint256 k = 0;
        bytes16 hexChars = "0123456789abcdef";
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c == 0x22 || c == 0x5C) {
                out[k++] = "\\";
                out[k++] = b[i];
            } else if (c < 0x20) {
                out[k++] = "\\";
                out[k++] = "u";
                out[k++] = "0";
                out[k++] = "0";
                out[k++] = hexChars[c >> 4];
                out[k++] = hexChars[c & 0x0F];
            } else {
                out[k++] = b[i];
            }
        }
        return string(out);
    }

    /// @dev XML text escaping for SVG: & < > " ' escaped, control bytes
    ///      replaced with spaces. Multi-byte UTF-8 passes through untouched.
    function _escapeXML(
        string memory value
    ) internal pure returns (string memory) {
        bytes memory b = bytes(value);
        uint256 extra = 0;
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c == 0x26) extra += 4; // &amp;
            else if (c == 0x3C || c == 0x3E) extra += 3; // &lt; &gt;
            else if (c == 0x22) extra += 5; // &quot;
            else if (c == 0x27) extra += 4; // &#39;
        }
        if (extra == 0 && !_hasControlBytes(b)) {
            return value;
        }
        bytes memory out = new bytes(b.length + extra);
        uint256 k = 0;
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c == 0x26) {
                out[k++] = "&";
                out[k++] = "a";
                out[k++] = "m";
                out[k++] = "p";
                out[k++] = ";";
            } else if (c == 0x3C) {
                out[k++] = "&";
                out[k++] = "l";
                out[k++] = "t";
                out[k++] = ";";
            } else if (c == 0x3E) {
                out[k++] = "&";
                out[k++] = "g";
                out[k++] = "t";
                out[k++] = ";";
            } else if (c == 0x22) {
                out[k++] = "&";
                out[k++] = "q";
                out[k++] = "u";
                out[k++] = "o";
                out[k++] = "t";
                out[k++] = ";";
            } else if (c == 0x27) {
                out[k++] = "&";
                out[k++] = "#";
                out[k++] = "3";
                out[k++] = "9";
                out[k++] = ";";
            } else if (c < 0x20) {
                out[k++] = " ";
            } else {
                out[k++] = b[i];
            }
        }
        return string(out);
    }

    function _hasControlBytes(bytes memory b) internal pure returns (bool) {
        for (uint256 i = 0; i < b.length; i++) {
            if (uint8(b[i]) < 0x20) {
                return true;
            }
        }
        return false;
    }
}
