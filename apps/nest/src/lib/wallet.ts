import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { CHAIN } from "../config";
import { createPasskey, signWithPasskey, type PasskeyAuth } from "./passkey";

/**
 * The nest wallet client: a RobinAccount smart wallet owned by this
 * device's passkey, transacting through the sponsored relayer. The digest
 * computed here must byte-match RobinAccount.digestFor.
 */
export const RELAY = "https://api.dotrobin.xyz/relay";

export type NestWallet = {
  credentialId: string;
  x: string;
  y: string;
  address: Address;
};

export type WalletCall = { target: Address; value: bigint; data: Hex };

const KEY = "nest:wallet";

export function storedWallet(): NestWallet | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as NestWallet) : null;
  } catch {
    return null;
  }
}

export function forgetWallet(): void {
  localStorage.removeItem(KEY);
}

export async function accountInfo(
  x: string,
  y: string,
): Promise<{ address: Address; deployed: boolean; nonce: string }> {
  const res = await fetch(`${RELAY}/account/${x}/${y}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "relayer unreachable");
  return body;
}

/** Create the passkey + resolve the counterfactual account address. */
export async function createWallet(): Promise<NestWallet> {
  const { credentialId, x, y } = await createPasskey("nest wallet");
  const info = await accountInfo(x.toString(), y.toString());
  const wallet: NestWallet = {
    credentialId,
    x: x.toString(),
    y: y.toString(),
    address: info.address,
  };
  localStorage.setItem(KEY, JSON.stringify(wallet));
  return wallet;
}

/** Byte-identical to RobinAccount.digestFor(calls, nonce). */
export function walletDigest(
  account: Address,
  nonce: bigint,
  calls: WalletCall[],
): Hex {
  const encodedCalls = encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    [calls],
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes" },
      ],
      ["robin-account-v1", BigInt(CHAIN.id), account, nonce, encodedCalls],
    ),
  );
}

export type SendPhase = "prepare" | "sign" | "relay";

/** Sign a batch with Face ID and submit through the relayer. */
export async function sendBatch(
  wallet: NestWallet,
  calls: WalletCall[],
  onPhase?: (phase: SendPhase) => void,
): Promise<{ txHash: Hex; status: string }> {
  onPhase?.("prepare");
  const info = await accountInfo(wallet.x, wallet.y);
  const digest = walletDigest(wallet.address, BigInt(info.nonce), calls);
  onPhase?.("sign");
  const auth: PasskeyAuth = await signWithPasskey(wallet.credentialId, digest);
  onPhase?.("relay");
  const res = await fetch(`${RELAY}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account: wallet.address,
      x: wallet.x,
      y: wallet.y,
      calls: calls.map((c) => ({
        target: c.target,
        value: c.value.toString(),
        data: c.data,
      })),
      auth,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "relay failed");
  return body;
}
