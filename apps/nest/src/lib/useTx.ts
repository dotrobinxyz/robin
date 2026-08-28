import { useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { encodeFunctionData, type Hex } from "viem";
import { CHAIN } from "../config";
import { useActive } from "./activeAccount";
import { sendBatch, type WalletCall } from "./wallet";

/** Sentinel returned by the passkey collector in place of a tx hash. */
const BATCHED = ("0x" + "1".padStart(64, "0")) as Hex;

/**
 * Write-and-wait helper, account-aware. External wallets run each step as
 * its own transaction (with just-in-time chain switching). The passkey
 * wallet instead RECORDS every step through a walletClient look-alike and
 * submits them as ONE relayed batch — a whole approve+action flow becomes
 * a single Face ID. Components keep the exact same API either way.
 */
export function useTx() {
  const { data: externalWalletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const active = useActive();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPasskey = active.kind === "passkey";
  const collected: WalletCall[] = [];

  const collector = {
    async writeContract(cfg: {
      address: `0x${string}`;
      abi: unknown;
      functionName: string;
      args?: unknown;
      value?: bigint;
    }): Promise<Hex> {
      collected.push({
        target: cfg.address,
        value: cfg.value ?? 0n,
        data: encodeFunctionData(
          cfg as unknown as Parameters<typeof encodeFunctionData>[0],
        ),
      });
      return BATCHED;
    },
    async sendTransaction(cfg: {
      to: `0x${string}`;
      value?: bigint;
      data?: Hex;
    }): Promise<Hex> {
      collected.push({
        target: cfg.to,
        value: cfg.value ?? 0n,
        data: cfg.data ?? "0x",
      });
      return BATCHED;
    },
    async getChainId(): Promise<number> {
      return CHAIN.id;
    },
  };

  // Components see one "walletClient" whichever mode is active.
  const walletClient = isPasskey
    ? (collector as unknown as NonNullable<typeof externalWalletClient>)
    : externalWalletClient;

  async function run(
    label: string,
    steps: (() => Promise<Hex | null>)[],
    onDone?: () => void,
  ) {
    if (!publicClient) return;
    if (isPasskey) {
      if (active.kind !== "passkey") return;
      setBusy(label);
      setError(null);
      try {
        collected.length = 0;
        for (const step of steps) await step();
        if (collected.length > 0) {
          await sendBatch(active.wallet, [...collected], (phase) =>
            setBusy(phase === "sign" ? "confirm" : label),
          );
        }
        onDone?.();
      } catch (err) {
        setError(
          err instanceof Error
            ? ((err as { shortMessage?: string }).shortMessage ?? err.message)
            : String(err),
        );
      } finally {
        setBusy(null);
      }
      return;
    }

    if (!externalWalletClient) return;
    setBusy(label);
    setError(null);
    try {
      // Wallets drift back to other chains (esp. iOS in-app browsers where
      // the switch prompt gets lost) — ensure the chain right before signing.
      const current = await externalWalletClient.getChainId();
      if (current !== CHAIN.id) {
        try {
          await externalWalletClient.switchChain({ id: CHAIN.id });
        } catch {
          await externalWalletClient.addChain({ chain: CHAIN });
          await externalWalletClient.switchChain({ id: CHAIN.id }).catch(() => {});
        }
      }
      for (const step of steps) {
        const hash = await step();
        if (hash && hash !== BATCHED) {
          await publicClient.waitForTransactionReceipt({ hash });
        }
      }
      onDone?.();
    } catch (err) {
      const message =
        err instanceof Error
          ? ((err as { shortMessage?: string }).shortMessage ?? err.message)
          : String(err);
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  return { run, busy, error, setError, walletClient, publicClient };
}
