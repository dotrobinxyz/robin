import type { ReactNode } from "react";
import { Link, useRoute } from "wouter";
import { ConnectButton } from "./ConnectButton";
import { ADDRESSES, EXPLORER, NETWORK } from "../config";
import { shortAddress } from "../lib/format";

function NavLink({ href, label }: { href: string; label: string }) {
  const [active] = useRoute(href);
  return (
    <Link href={href} className={active ? "active" : ""}>
      {label}
    </Link>
  );
}

function ContractLine({
  label,
  address,
}: {
  label: string;
  address: `0x${string}`;
}) {
  const body = (
    <>
      <span className="muted">{label}</span>
      <span>{shortAddress(address)}</span>
    </>
  );
  return EXPLORER ? (
    <a
      className="contract-line"
      href={`${EXPLORER}/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      {body}
    </a>
  ) : (
    <span className="contract-line">{body}</span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Robin home">
          <img src="/robin-mark-light.svg" alt="" width={34} height={34} />
          <span className="wordmark">robin</span>
          {NETWORK !== "robinhood" && (
            <span className="tag reserved">
              {NETWORK === "local" ? "local" : "testnet"}
            </span>
          )}
        </Link>
        <ConnectButton />
      </header>

      <nav className="nav">
        <NavLink href="/" label="search" />
        <NavLink href="/my" label="my names" />
        <NavLink href="/auctions" label="auctions" />
      </nav>

      <main>{children}</main>

      <footer className="footer">
        <div className="footer-brand">
          <img src="/robin-mark-night.svg" alt="" width={28} height={28} />
          <span className="wordmark">robin</span>
        </div>
        <p>
          Open-source naming on Robinhood Chain. ENS-standard resolution,
          on-chain SVG art, locked metadata.
        </p>
        <div className="contracts">
          <ContractLine label="registry" address={ADDRESSES.registry} />
          <ContractLine label="resolver" address={ADDRESSES.publicResolver} />
          <ContractLine label="registrar" address={ADDRESSES.baseRegistrar} />
        </div>
        <div className="links">
          <a href="https://docs.dotrobin.xyz" target="_blank" rel="noreferrer">
            docs.dotrobin.xyz
          </a>
          <a href="https://api.dotrobin.xyz" target="_blank" rel="noreferrer">
            api.dotrobin.xyz
          </a>
          <a
            href="https://github.com/dotrobinxyz/robin"
            target="_blank"
            rel="noreferrer"
          >
            github
          </a>
          <a href="https://x.com/dotrobinxyz" target="_blank" rel="noreferrer">
            @dotrobinxyz
          </a>
          <a href="mailto:hello@dotrobin.xyz">hello@dotrobin.xyz</a>
          <a href="mailto:security@dotrobin.xyz">security@dotrobin.xyz</a>
        </div>
      </footer>
    </div>
  );
}
