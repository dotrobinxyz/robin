#!/usr/bin/env bash
# Prints the complete diff between each Robin contract and its upstream
# ens-contracts v1.7.0 counterpart. This output — plus the new files listed
# at the end — is the entire contract audit surface.
set -euo pipefail
cd "$(dirname "$0")/.."

pair() { # upstream-path robin-path
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "  $2  ⇐  $1 (v1.7.0)"
  echo "════════════════════════════════════════════════════════════════"
  diff -u <(git show "v1.7.0:$1") "$2" || true
}

pair contracts/registry/ENSRegistry.sol            contracts/robin/RobinRegistry.sol
pair contracts/ethregistrar/BaseRegistrarImplementation.sol contracts/robin/RobinBaseRegistrar.sol
pair contracts/ethregistrar/ETHRegistrarController.sol      contracts/robin/RobinRegistrarController.sol
pair contracts/wrapper/NameWrapper.sol             contracts/robin/RobinWrapper.sol

echo
echo "════════════════════════════════════════════════════════════════"
echo "  contracts/robin/RobinPriceOracle.sol merges StablePriceOracle +"
echo "  ExponentialPremiumPriceOracle; diff against each in turn:"
echo "════════════════════════════════════════════════════════════════"
diff -u <(git show v1.7.0:contracts/ethregistrar/StablePriceOracle.sol) contracts/robin/RobinPriceOracle.sol || true
diff -u <(git show v1.7.0:contracts/ethregistrar/ExponentialPremiumPriceOracle.sol) contracts/robin/RobinPriceOracle.sol || true

echo
echo "════════════════════════════════════════════════════════════════"
echo "  New files with no upstream counterpart (review in full):"
echo "════════════════════════════════════════════════════════════════"
ls -1 contracts/robin/RobinMetadata.sol contracts/robin/RobinReservedList.sol \
      contracts/robin/IReservedList.sol contracts/robin/IRobinPriceOracle.sol \
      contracts/robin/IRobinRegistrarController.sol contracts/robin/IRobinTokenURIProvider.sol \
      contracts/robin/mocks/MockAggregator.sol contracts/robin/mocks/MockUSDG.sol

echo
echo "Everything else in contracts/ is byte-identical to ens-contracts v1.7.0"
echo "(verify: git diff v1.7.0 -- contracts ':(exclude)contracts/robin')"
