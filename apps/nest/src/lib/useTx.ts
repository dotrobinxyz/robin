import { useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import type { Hex } from "viem";
import { CHAIN } from "../config";

/**
 * Minimal write-and-wait helper: runs a sequence of transactions (each built
 * lazily so later steps can depend on earlier receipts), tracking a single
 * busy/error state. Keeps page components readable.
 */
export function useTx() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    label: string,
    steps: (() => Promise<Hex | null>)[],
    onDone?: () => void,
  ) {
    if (!walletClient || !publicClient) return;
    setBusy(label);
    setError(null);
    try {
      // Wallets drift back to other chains (esp. iOS in-app browsers where
      // the switch prompt gets lost) — ensure the chain right before signing.
      const current = await walletClient.getChainId();
      if (current !== CHAIN.id) {
        try {
          await walletClient.switchChain({ id: CHAIN.id });
        } catch {
          await walletClient.addChain({ chain: CHAIN });
          await walletClient.switchChain({ id: CHAIN.id }).catch(() => {});
        }
      }
      for (const step of steps) {
        const hash = await step();
        if (hash) await publicClient.waitForTransactionReceipt({ hash });
      }
      onDone?.();
    } catch (err) {
      const message =
        err instanceof Error
          ? (err as { shortMessage?: string }).shortMessage ?? err.message
          : String(err);
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  return { run, busy, error, setError, walletClient, publicClient };
}
