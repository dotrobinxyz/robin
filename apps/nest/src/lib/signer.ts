import { useWalletClient } from "wagmi";
import { encodeAbiParameters, hashMessage, type Address, type Hex } from "viem";
import { useActive } from "./activeAccount";
import { signWithPasskey } from "./passkey";

/**
 * One message-signer for whichever account is active. External wallets
 * sign EIP-191 directly; the passkey wallet signs the message hash as a
 * WebAuthn assertion, abi-encoded so verifiers reach it through the
 * account's ERC-1271 isValidSignature.
 */
export type SessionSigner = {
  address: Address;
  signMessage: (message: string) => Promise<Hex>;
};

const WEBAUTHN_AUTH = [
  {
    type: "tuple",
    components: [
      { name: "authenticatorData", type: "bytes" },
      { name: "clientDataJSON", type: "string" },
      { name: "challengeLocation", type: "uint256" },
      { name: "responseTypeLocation", type: "uint256" },
      { name: "r", type: "uint256" },
      { name: "s", type: "uint256" },
    ],
  },
] as const;

export function useSessionSigner(): SessionSigner | null {
  const active = useActive();
  const { data: walletClient } = useWalletClient();

  if (active.kind === "external" && walletClient) {
    return {
      address: active.address,
      signMessage: (message) =>
        walletClient.signMessage({ account: active.address, message }),
    };
  }
  if (active.kind === "passkey") {
    const { credentialId } = active.wallet;
    return {
      address: active.address,
      signMessage: async (message) => {
        const auth = await signWithPasskey(credentialId, hashMessage(message));
        return encodeAbiParameters(WEBAUTHN_AUTH, [
          {
            authenticatorData: auth.authenticatorData,
            clientDataJSON: auth.clientDataJSON,
            challengeLocation: BigInt(auth.challengeLocation),
            responseTypeLocation: BigInt(auth.responseTypeLocation),
            r: BigInt(auth.r),
            s: BigInt(auth.s),
          },
        ]);
      },
    };
  }
  return null;
}
