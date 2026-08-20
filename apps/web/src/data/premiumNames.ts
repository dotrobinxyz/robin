/**
 * Curated premium names, held by the Robin treasury (the Safe) and offered
 * to their namesakes — CEOs, founders, KOLs. Listed on /auctions.
 * Fulfillment: payment to the treasury, then the Safe transfers the name.
 */
export type PremiumName = {
  label: string;
  priceUSD: number;
  /** true once the name is secured (Safe-held or on-chain reserved) — only
   *  live names render, so the list is never a sniper's shopping list. */
  live: boolean;
};

export const PREMIUM_NAMES: PremiumName[] = [
  { label: "vlad", priceUSD: 2000, live: true },
  { label: "vladtenev", priceUSD: 1000, live: true },
  { label: "vitalik", priceUSD: 2000, live: false },
  { label: "satoshi", priceUSD: 2000, live: false },
  { label: "elon", priceUSD: 2000, live: false },
  { label: "brian", priceUSD: 1500, live: false },
  { label: "jesse", priceUSD: 1500, live: false },
  { label: "hayden", priceUSD: 1500, live: false },
  { label: "sergey", priceUSD: 1500, live: false },
  { label: "anatoly", priceUSD: 1500, live: false },
  { label: "saylor", priceUSD: 1500, live: false },
  { label: "balaji", priceUSD: 1500, live: false },
  { label: "naval", priceUSD: 1500, live: false },
  { label: "stani", priceUSD: 1000, live: false },
  { label: "cobie", priceUSD: 1000, live: false },
  { label: "ansem", priceUSD: 1000, live: false },
  { label: "gcr", priceUSD: 1000, live: false },
  { label: "justin", priceUSD: 1000, live: false },
];

export const PREMIUM_CONTACT = "hello@dotrobin.xyz";
