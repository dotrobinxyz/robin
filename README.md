# Robin

Robin is the ENS-standard naming and identity layer for Robinhood Chain
(chainId 4663): human-readable `.robin` names that replace 0x addresses across
wallets, dapps, and explorers, with annual renewals, standards-compliant
resolution, tradeable wrapped subdomains, fully on-chain SVG metadata, and
expiry auctions. The contracts are a minimal-diff fork of
[ens-contracts](https://github.com/ensdomains/ens-contracts); any ENS-aware
library resolves `.robin` by pointing at the registry and UniversalResolver.

## Repository

- `contracts/` — the Robin contracts (fork of ens-contracts) + Foundry tests
- `packages/sdk/` — [`robin-names`](https://www.npmjs.com/package/robin-names) (`npm i robin-names`), one-line viem/wagmi resolution
- `indexer/` — Ponder indexer (GraphQL) for names, records, and auctions
- `apps/web/` — the web app (search, register, manage, renew, subdomains)

## Mainnet — Robinhood Chain (chainId 4663)

Live and Blockscout-verified. Owner: 2-of-3 Safe
`0xD0d82499Bfbbc5D92d31BDc46d31d1Fd3eA50a71`.

| Contract | Address |
|---|---|
| RobinRegistry | `0x29d8cEae06c4F97c784BD016A41eB45c9A2d6aE1` |
| RobinBaseRegistrar | `0x218CCD54F64cdcB7d0B6e45eA4665846df01Ad5C` |
| RobinRegistrarController | `0x9080E579fa9776EFe4531004aBe78D8f25480f77` |
| RobinPriceOracle | `0x38507fc485d269914A2DCCEF4973f9e572473730` |
| RobinWrapper | `0x2Ad2590817Dde5A070849DdFBB38959153D7B282` |
| RobinReservedList | `0xE458B7c0f88A746baeaa9b2a687e6F3d8E1Ba3Eb` |
| RobinMetadata | `0xda05Ecd77E31099Ea24829E135c18928254E17EB` |
| PublicResolver | `0x859fe65f2d58182C72E6B7Ca54e32c9a16d5bF04` |
| ReverseRegistrar | `0x489ae7566b8E48C9B6F922DAe7a6c9c552B57C47` |
| DefaultReverseRegistrar | `0x3C0ae4a25307c66Fb5f558DF592cc4B70E42ffaa` |
| UniversalResolver | `0x1C336914666256e2c5131FB460C598F2EAB0292B` |
| GatewayProvider | `0xf1702Bc3441c87f51c01C035BC2aDA49eBF8a011` |

Explorer: https://robinhoodchain.blockscout.com · App: https://dotrobin.xyz ·
Docs: https://docs.dotrobin.xyz · API: https://api.dotrobin.xyz/graphql

## Testnet — Robinhood Chain Testnet (chainId 46630)

| Contract | Address |
|---|---|
| RobinRegistry | `0x8705DEC51223E119C5C9f03121626d086A8eF753` |
| RobinBaseRegistrar | `0x78443cD8242AfCC56F8779a1D9acB8971cD67ac8` |
| RobinRegistrarController | `0x042C39d404C58528963E691a6befC905511a3Dcb` |
| RobinPriceOracle | `0x6ab29612665a93682a3C6d64f1523f6991723111` |
| RobinWrapper | `0xB1125eb75343054722881F995FE961f93290e1aF` |
| RobinReservedList | `0x0e558E92D0B4B93C450f4a48EB95Ed3f467ce6de` |
| RobinMetadata | `0x525c188297509941f6f97Cd0ff639cD3011Cb886` |
| PublicResolver | `0x293758cf47CE956fbeD160E54259Af2549faa090` |
| ReverseRegistrar | `0x818145E450422484c240a7294de5f71e3A39e4F4` |
| UniversalResolver | `0x7112730612e4253Ba2e418A86580615A2c3CDB1D` |

Explorer: https://explorer.testnet.chain.robinhood.com

## License

MIT — see [LICENSE](./LICENSE). Contracts include code from ensdomains/ens-contracts
(© ENS Labs Ltd, MIT). Security: [SECURITY.md](./SECURITY.md).
