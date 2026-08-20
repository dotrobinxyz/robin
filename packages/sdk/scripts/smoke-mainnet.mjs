// Mainnet post-deploy smoke (runbook step 4): register → records → primary
// → wrap → subname → resolve. Run: source ~/.robin-mainnet/keys.env && node smoke-mainnet.tmp.mjs
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  robinhoodChain,
  ROBIN_ADDRESSES,
  makeRegistration,
  makeCommitment,
  randomSecret,
  robinNode,
  robinTokenId,
  REVERSE_RECORD_CHAIN,
  robinRegistrarControllerAbi,
  robinBaseRegistrarAbi,
  robinWrapperAbi,
  publicResolverAbi,
} from "./packages/sdk/dist/index.js";

const A = ROBIN_ADDRESSES[4663];
const account = privateKeyToAccount(process.env.ROBIN_MAINNET_DEPLOYER_PK);
const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http() });
const pub = createPublicClient({ chain: robinhoodChain, transport: http() });
const LABEL = "goldfinch";
const node = robinNode(LABEL);

const wait = (h) => pub.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
const step = (m) => console.log("→", m);

// 1. commit
const reg = makeRegistration({
  label: LABEL,
  owner: account.address,
  duration: 31_536_000n,
  secret: randomSecret(),
  resolver: A.publicResolver,
  data: [
    encodeFunctionData({ abi: publicResolverAbi, functionName: "setAddr", args: [node, account.address] }),
    encodeFunctionData({ abi: publicResolverAbi, functionName: "setText", args: [node, "url", "https://dotrobin.xyz"] }),
  ],
  reverseRecord: REVERSE_RECORD_CHAIN,
});
const commitment = makeCommitment(reg);
let h = await wallet.writeContract({ address: A.controller, abi: robinRegistrarControllerAbi, functionName: "commit", args: [commitment] });
await wait(h);
step("committed " + commitment.slice(0, 18) + "…");

// 2. min commitment age
step("waiting 70s (min commitment age)…");
await new Promise((r) => setTimeout(r, 70_000));

// 3. register (ETH path, promo price)
const [base, premium] = await pub.readContract({ address: A.controller, abi: robinRegistrarControllerAbi, functionName: "rentPrice", args: [LABEL, 31_536_000n] }).then((p) => [p.base, p.premium]);
const value = ((base + premium) * 105n) / 100n;
h = await wallet.writeContract({ address: A.controller, abi: robinRegistrarControllerAbi, functionName: "register", args: [reg], value });
const rr = await wait(h);
step(`registered ${LABEL}.robin — block ${rr.blockNumber}, paid ≤ ${value} wei (base ${base}, premium ${premium})`);

// 4. wrap
h = await wallet.writeContract({ address: A.baseRegistrar, abi: robinBaseRegistrarAbi, functionName: "setApprovalForAll", args: [A.wrapper, true] });
await wait(h);
h = await wallet.writeContract({ address: A.wrapper, abi: robinWrapperAbi, functionName: "wrapETH2LD", args: [LABEL, account.address, 0, A.publicResolver] });
await wait(h);
step("wrapped");

// 5. subname
h = await wallet.writeContract({ address: A.wrapper, abi: robinWrapperAbi, functionName: "setSubnodeOwner", args: [node, "bot1", account.address, 0, 0n] });
await wait(h);
step("subname bot1." + LABEL + ".robin issued");

// 6. verify with stock viem
const fwd = await pub.getEnsAddress({ name: `${LABEL}.robin` });
const rev = await pub.getEnsName({ address: account.address });
const txt = await pub.getEnsText({ name: `${LABEL}.robin`, key: "url" });
const registrarOwner = await pub.readContract({ address: A.baseRegistrar, abi: robinBaseRegistrarAbi, functionName: "ownerOf", args: [robinTokenId(LABEL)] });
const uri = await pub.readContract({ address: A.baseRegistrar, abi: robinBaseRegistrarAbi, functionName: "tokenURI", args: [robinTokenId(LABEL)] });
console.log("forward:", fwd);
console.log("reverse:", rev);
console.log("text url:", txt);
console.log("721 held by wrapper:", registrarOwner === A.wrapper);
console.log("tokenURI head:", uri.slice(0, 40));
const ok = fwd === account.address && rev === `${LABEL}.robin` && txt === "https://dotrobin.xyz" && registrarOwner === A.wrapper;
console.log(ok ? "SMOKE_PASS" : "SMOKE_INCOMPLETE");
process.exit(ok ? 0 : 1);
