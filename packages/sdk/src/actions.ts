import type { Address, Client } from "viem";
import {
  getEnsAddress,
  getEnsAvatar,
  getEnsName,
  getEnsText,
  normalize,
} from "viem/ens";

/**
 * Thin, explicit wrappers over viem's ENS actions. If your client's chain
 * comes from this SDK (`robinhoodChain` / `withRobin`), viem's own
 * `getEnsName`/`getEnsAddress`/... already resolve .robin — use whichever
 * reads better in your codebase.
 */

/** Primary name for an address (reverse resolution), or null. */
export async function getRobinName(
  client: Client,
  params: { address: Address },
): Promise<string | null> {
  return getEnsName(client as never, { address: params.address });
}

/** Forward-resolves a .robin name to its address, or null. */
export async function getRobinAddress(
  client: Client,
  params: { name: string },
): Promise<Address | null> {
  return getEnsAddress(client as never, { name: normalize(params.name) });
}

/** Reads a text record (e.g. "com.twitter", "url", "description"). */
export async function getRobinText(
  client: Client,
  params: { name: string; key: string },
): Promise<string | null> {
  return getEnsText(client as never, {
    name: normalize(params.name),
    key: params.key,
  });
}

/** Resolves the avatar record to a usable URI, or null. */
export async function getRobinAvatar(
  client: Client,
  params: { name: string },
): Promise<string | null> {
  return getEnsAvatar(client as never, { name: normalize(params.name) });
}
