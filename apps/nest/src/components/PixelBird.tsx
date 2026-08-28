import { keccak256, stringToBytes } from "viem";

/**
 * The brand pixel robin, decoded from the SAME run-encoded sprite bytes and
 * plumage algorithm as RobinMetadataV2 on-chain — so a name's feed avatar is
 * literally its NFT bird. Runs are 4 bytes: x, y, width, palette index.
 */
const SPRITES = {
  common:
    "0601040005020600050301000603010207030400050406000b04010302050100050506000b050103020602000506060002070500070702010907020003080400070803010a08010003090300060904010a090100040a0200060a04010a0a0100050b0100060b0301090b0100060c0300050d0103080d0103040e0603",
  rare: "0601040005020600050301000603010207030400050406000b04010302050101050506000b0501030206020105060600020703010507020007070201090702000308020105080200070803010a0801000309020105090100060904010a090100040a0200060a04010a0a0100050b0100060b0301090b0100060c0300050d0103080d0103040e0601",
  ultra:
    "0600010008000100060103000602040105030601050401010604010207040401050506010b05010302060101050606010b060103020702010507060102080501070802040908020103090401070903040a090101030a0301060a04040a0a0101040b0201060b04040a0b0101050c0101060c0304090c0101060d0301050e0103080e0103040f0600",
  legend:
    "0600010408000104060103040602040205030602050401020604010407040402050506020b05010202060102050606020b060102020702020507060202080502070802040908020203090402070903040a090102030a0302060a04040a0a0102040b0202060b04040a0b0102050c0102060c0304090c0102060d0302050e0102080e0102040f0604",
} as const;

const PLUMAGE = [
  "#F1EADF",
  "#37C6B4",
  "#7EC8E3",
  "#9FB0BA",
  "#E86A4A",
  "#D98E4A",
  "#E89BB8",
  "#B49BE8",
  "#C7524A",
  "#A8826A",
  "#FFFFFF",
];
const GREEN = "#CCFF00";
const CHAR = "#2A2622";
const GREY = "#8C8578";
const BUFF = "#F1EADF";

const LEGENDS = new Set(["vlad", "vladtenev", "cashcat", "pons", "eth"]);

export type BirdTier = keyof typeof SPRITES;

export function birdTier(head: string): BirdTier {
  if (LEGENDS.has(head)) return "legend";
  if (head.length <= 3) return "ultra";
  if (head.length === 4) return "rare";
  return "common";
}

export function PixelBird({
  name,
  size = 38,
  gold = false,
}: {
  name: string;
  size?: number;
  gold?: boolean;
}) {
  const head = name.split(".")[0]!;
  const plume =
    PLUMAGE[parseInt(keccak256(stringToBytes(`plumage:${head}`)).slice(2, 4), 16) % 11]!;
  const tier = birdTier(head);
  const pal = [plume, GREEN, CHAR, GREY, BUFF];
  const runs = SPRITES[tier];
  const rects = [];
  for (let i = 0; i < runs.length; i += 8) {
    rects.push(
      <rect
        key={i}
        x={parseInt(runs.slice(i, i + 2), 16)}
        y={parseInt(runs.slice(i + 2, i + 4), 16)}
        width={parseInt(runs.slice(i + 4, i + 6), 16)}
        height={1}
        fill={pal[parseInt(runs.slice(i + 6, i + 8), 16)]}
      />,
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -0.5 18 18"
      shapeRendering="crispEdges"
      style={{
        borderRadius: Math.round(size * 0.26),
        background: tier === "legend" ? GREEN : "#26221D",
        flex: "none",
        display: "block",
        boxShadow: gold ? "0 0 0 2px #e8c24a" : undefined,
      }}
    >
      {rects}
    </svg>
  );
}
