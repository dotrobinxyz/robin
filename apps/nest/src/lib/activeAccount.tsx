import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { storedWallet, type NestWallet } from "./wallet";

/**
 * The one-account rule: the app runs on exactly one account at a time.
 * A connected external wallet (MetaMask etc.) always wins; otherwise the
 * device's passkey wallet, if one exists; otherwise nothing. Every tab and
 * sheet reads identity from here — never straight from wagmi — so pay,
 * trade, manage, and social all agree on who you are.
 */
export type ActiveAccount =
  | { kind: "external"; address: Address }
  | { kind: "passkey"; address: Address; wallet: NestWallet }
  | { kind: "none"; address: undefined };

const Ctx = createContext<{ account: ActiveAccount; refresh: () => void }>({
  account: { kind: "none", address: undefined },
  refresh: () => {},
});

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const [tick, setTick] = useState(0);

  const account: ActiveAccount = useMemo(() => {
    if (isConnected && address) return { kind: "external", address };
    const wallet = storedWallet();
    if (wallet) return { kind: "passkey", address: wallet.address, wallet };
    return { kind: "none", address: undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, tick]);

  const value = useMemo(
    () => ({ account, refresh: () => setTick((t) => t + 1) }),
    [account],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActive(): ActiveAccount {
  return useContext(Ctx).account;
}

export function useActiveRefresh(): () => void {
  return useContext(Ctx).refresh;
}
