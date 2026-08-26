/**
 * Curated premium names, held by the Robin treasury (the Safe) and offered
 * to their namesakes — CEOs, founders, KOLs. Listed on /auctions.
 * Fulfillment: payment to the treasury, then the Safe transfers the name.
 */
export type PremiumName = {
  label: string;
  priceUSD: number;
  /** true once the name is secured (sale-held or on-chain reserved) — only
   *  live names render, so the list is never a sniper's shopping list. */
  live: boolean;
  /** on-chain reserved (not yet registered) — inquire flow instead of buy. */
  reserved?: boolean;
  /** sale contract holding this name; defaults to SALE_ADDRESS (wave 1). */
  sale?: `0x${string}`;
};

/** RobinPremiumSale — owns and sells the curated names; proceeds forward
 *  to the Safe inside each buy transaction. */
export const SALE_ADDRESS =
  "0x8D5D3242d74C69F54Ece0B50ecbB1a172C09EF79" as `0x${string}` | "";

/** Wave 2 — Robinhood team, symbolic pricing. */
export const TEAM_SALE_ADDRESS =
  "0xCF61A22d199D63A64917FeF36bB8f254434F95bA" as `0x${string}`;

export const PREMIUM_NAMES: PremiumName[] = [
  { label: "vlad", priceUSD: 3000, live: true, reserved: true },
  { label: "vladtenev", priceUSD: 2000, live: true, reserved: true },
  { label: "baiju", priceUSD: 100, live: true, sale: TEAM_SALE_ADDRESS },
  { label: "johann", priceUSD: 100, live: true, sale: TEAM_SALE_ADDRESS },
  { label: "jason", priceUSD: 100, live: true, sale: TEAM_SALE_ADDRESS },
  { label: "steve", priceUSD: 100, live: true, sale: TEAM_SALE_ADDRESS },
  { label: "vitalik", priceUSD: 2000, live: true },
  { label: "satoshi", priceUSD: 2000, live: true },
  { label: "elon", priceUSD: 2000, live: true },
  { label: "brian", priceUSD: 1500, live: true },
  { label: "jesse", priceUSD: 1500, live: true },
  { label: "hayden", priceUSD: 1500, live: true },
  { label: "sergey", priceUSD: 1500, live: true },
  { label: "anatoly", priceUSD: 1500, live: true },
  { label: "saylor", priceUSD: 1500, live: true },
  { label: "balaji", priceUSD: 1500, live: true },
  { label: "naval", priceUSD: 1500, live: true },
  { label: "stani", priceUSD: 1000, live: true },
  { label: "cobie", priceUSD: 1000, live: true },
  { label: "ansem", priceUSD: 1000, live: true },
  { label: "gcr", priceUSD: 1000, live: true },
  { label: "justin", priceUSD: 1000, live: true },
];

export const PREMIUM_CONTACT = "hello@dotrobin.xyz";
