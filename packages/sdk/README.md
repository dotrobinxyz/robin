# robin-names

Resolve and register `.robin` names on Robinhood Chain — ENS-standard
resolution with a one-line viem config.

Robin implements the exact ENS interfaces (ERC-137 registry, standard
resolver profiles, ENSIP namehash, reverse records, a UniversalResolver), so
**the ENS tooling you already use works unchanged** — stock viem, wagmi, and
ethers resolve `.robin` once they know where the registry lives.

## Install

```sh
npm i robin-names viem
```

## Use

```ts
import { createPublicClient, http } from "viem";
import { robinhoodChain } from "robin-names"; // ← the one line

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(),
});

// reverse: address → name (render this instead of 0x…)
await client.getEnsName({ address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" });

// forward: name → address (payments, transfers, search)
await client.getEnsAddress({ name: "trader.robin" });

// profile records
await client.getEnsText({ name: "trader.robin", key: "com.twitter" });
await client.getEnsAvatar({ name: "trader.robin" });
```

With wagmi, pass the chain into your config and use the stock hooks —
`useEnsName`, `useEnsAddress`, `useEnsText`, `useEnsAvatar`. Nothing else
changes. Already have your own chain object? Wrap it:
`withRobin(myChainConfig)`.

Live on Robinhood Chain **mainnet** (chainId 4663) — `robinhoodChain` — and
testnet (46630) — `robinhoodChainTestnet`. Addresses always come from the
deploy script's own record in
[`contracts/deployments/`](https://github.com/dotrobinxyz/robin/tree/main/contracts/deployments).

## Verify names & check tickers

Robin also runs an index-backed REST API. The ticker registry maps tickers
to their **canonical token contracts** — on a chain full of tokenized
assets, ten contracts will claim the same ticker and one is real:

```ts
import { getTicker, verifyName, getTickers } from "robin-names";

// the one true USDG on Robinhood Chain (null unless protocol-curated)
const usdg = await getTicker("usdg");
// → { symbol: "USDG", kind: "stable", contract: "0x5fc5…d168", official: true }

// verify any name: registered ∧ unexpired ∧ address set
const v = await verifyName("goldfinch.robin");
// → { verified: true, checks: {…}, address, records, ticker, … }

// the whole registry, official listings first
const all = await getTickers();
```

Only trust a mapping when `official: true` — it means the name is held by
the protocol treasury Safe, so the record is multisig-curated. Point
`{ apiUrl }` at your own indexer to avoid trusting ours.

Every name also gets two shareable pages, no setup:
`dotrobin.xyz/u/name` (profile) and `dotrobin.xyz/pay/name` (payments,
with `?amt=&cur=&memo=` prefill).

## Also exported

- `ROBIN_ADDRESSES`, `getRobinAddresses` — the verified contract addresses
- `getRobinName` / `getRobinAddress` / `getRobinText` / `getRobinAvatar` —
  standalone actions when you don't want to touch your chain object
- `makeRegistration`, `makeCommitment`, `randomSecret`, `validateLabel` —
  commit–reveal registration helpers
- `normalize`, `namehash`, `labelhash` (re-exported from `viem/ens`) — always
  normalize user input before hashing
- Typed ABIs for every deployed contract

## More

- Docs: <https://docs.dotrobin.xyz>
- App: <https://dotrobin.xyz>
- Indexed data (GraphQL, CORS open): <https://api.dotrobin.xyz/graphql>
- Source: [github.com/dotrobinxyz/robin](https://github.com/dotrobinxyz/robin) — `packages/sdk`

MIT © dotrobinxyz
