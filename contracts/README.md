# contracts

Foundry project. Solidity 0.8.11, OpenZeppelin 4.9.x. Spec: [../docs/specs/contracts.md](../docs/specs/contracts.md).

```bash
git clone --depth 1 --branch v1.9.7 https://github.com/foundry-rs/forge-std lib/forge-std   # last forge-std that supports solc 0.8.11
git clone --depth 1 --branch v4.9.6 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
forge build
forge test -vv
```

Interfaces are in `src/interfaces/`. Status (see [PLAN.md §5.1](../docs/PLAN.md#51-contracts-area-a)):

| File | Status |
| --- | --- |
| `src/MockUSD.sol` | first version |
| `src/PlanModule.sol` | first version: typed agent functions, every check from the spec, 24 h timelock, pause |
| `test/PlanModule.t.sol`, `test/PlanModule.invariant.t.sol` | unit, fuzz and the six invariants from the spec (invariant 4, storm actions only in storm mode, runs against a mock attestor) |
| `src/SignalAttestor.sol` + `test/SignalAttestor.t.sol` | first version: EIP-712, freshness, nonces, TTLs, FISCO chain id and `timeUnit`, timelocked relayer rotation (one address per source); the storm's event id is pinned at `StormStarted`, so a new GDACS id mid-storm does not reset the per-storm caps; HKO/NCHMF only for their own region, GDACS alerts need an event id |
| `test/Integration.t.sol` | the real `SignalAttestor` with `PlanModule`: storm unlock, caps per pinned event, next storm is a new event, lapse after 12 h |
| `src/mocks/MockSignalCover.sol`, `FlowCreditLine.sol`, `PaymentRouter.sol`, `MockMMFVault.sol`, `EvidenceRegistry.sol` + `test/Mocks.t.sol` | first version |
| `src/LocalSafe.sol` | stand-in Safe for Anvil and tests only (one admin, no signatures); Base Sepolia uses the real 2-of-3 Safe |
| `src/PlanGuard.sol` + `test/PlanGuard.t.sol` | first version: blocks module, owner, threshold, guard and fallback changes and any delegatecall unless queued 24 h earlier; a delegatecall to `MultiSendCallOnly` is checked call by call; a queued entry is used up only when the Safe transaction succeeds. Deployed by the script, not set on the demo Safe |
| `test/PlanGuardFork.t.sol` | PlanGuard on a fresh 2-of-3 Safe made through the real Safe v1.4.1 contracts on a Base Sepolia fork, with signed Safe transactions; skips without `BASE_SEPOLIA_RPC` (CI) |
| `script/Deploy.s.sol` → writes `deployments/<network>.json` | works on Anvil; Base Sepolia path untested |
| `script/ThrowawayGuard.s.sol` → writes `deployments/base-sepolia-throwaway-guard.json` | sets PlanGuard on a new throwaway Safe; rehearsed on an anvil fork of Base Sepolia, not yet run live |

PlanGuard against real Safe bytecode (forks Base Sepolia; without `BASE_SEPOLIA_RPC` the suite skips):

```bash
BASE_SEPOLIA_RPC=<url> forge test --match-path test/PlanGuardFork.t.sol -vvv   # optional FORK_BLOCK pins the fork
```

It creates a 2-of-3 Safe through the canonical v1.4.1 `SafeProxyFactory` and `SafeL2` singleton, enables a cut-down `PlanModule`, sets `PlanGuard`, and checks with owner signatures: ordinary transfers and `MultiSendCallOnly` payroll batches pass; every module, owner, threshold, guard and fallback change, a batch hiding one, and a delegatecall to anything but `MultiSendCallOnly` (full `MultiSend`, `SignMessageLib`) are blocked until queued for 24 h, then pass once; a failed inner call keeps the queue entry (with `safeTxGas` 0 the Safe reverts with `GS013`; with `safeTxGas` > 0 it reports failure to the guard); `PlanModule` calls skip the guard (v1.4.1 does not run guards on module transactions); a queued `setGuard(address(0))` removes the guard after the delay. A guard bound to a different Safe passes `setGuard`'s ERC-165 check and then locks the Safe (`NotSafe` on every transaction), so check `guard.safe()` before setting it.

Local chain (what the agent and website use until Base Sepolia):

```bash
anvil                                   # separate terminal
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

On chain 31337 the script uses anvil's public dev accounts (0 deployer, 1 owner, 4 guardian, 5 agent, 6 HKO relayer, 7 GDACS relayer, 8 demo client), deploys a `LocalSafe`, enables the module and writes `deployments/anvil.json`. Plan parameters come from `PLAN_PARAMS` (default `../data/fixtures/plans/plan-params.example.json`, the output of `npm run plan:hash` on the example plan book).

Deploy to Base Sepolia:

```bash
source ../.env   # SAFE_ADDRESS, DEPLOYER_PRIVATE_KEY, AGENT_ADDRESS, GUARDIAN_ADDRESS, HKO_RELAYER_ADDRESS, GDACS_RELAYER_ADDRESS, DEMO_CLIENT_ADDRESS
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```

`--verify` needs `BASESCAN_API_KEY`. Without one, `script/verify-keyless.sh` verifies every contract in the broadcast file on [Sourcify](https://sourcify.dev) and on [Blockscout](https://base-sepolia.blockscout.com), neither of which needs a key; the 10 Oct deployment is verified there (all nine contracts an exact match on Sourcify). Rerun it after a redeploy; Blockscout rate-limits, so rerun for any "Too many requests".

Optional: `REGION` (must match the params file's `region`), `MULTISEND_CALL_ONLY` (default: the canonical Safe v1.4.1 address), `NCHMF_RELAYER_ADDRESS`, `TIME_UNIT`, `ATTESTOR_CHAIN_ID`. The script refuses params whose plan hashes disagree and relayer addresses that repeat. On a local fork of Base Sepolia (chain id 84532 but a rehearsal) set `NETWORK=anvil-fork`, so the real `deployments/base-sepolia.json` is not overwritten.

PlanGuard on a throwaway Safe (Base Sepolia, [SECURITY.md](../docs/SECURITY.md) known risk 7). `script/ThrowawayGuard.s.sol` never touches the demo Safe: it creates a new 1-of-1 Safe v1.4.1 owned by the `DEPLOYER_PRIVATE_KEY` address, deploys a `PlanGuard` bound to it, checks `guard.safe()` and sets it with a Safe transaction the deployer signs, then sends one allowed Safe transaction through the guard (the deployer, as `MockUSD` owner, mints 1 mUSD to the Safe and the Safe sends it back; without mint rights it sends 0 mUSD). It simulates, without broadcasting, `addOwnerWithThreshold` and `setGuard(address(0))`, requires both to revert with `Blocked(selector)` and logs them. Five transactions, about 1.31 M gas (Safe 259 k, guard 798 k, mint 53 k, `setGuard` 101 k, transfer 95 k): about 0.00001 ETH at 0.006 gwei plus the L1 data fee.

```bash
set -a; source ../.env; set +a   # DEPLOYER_PRIVATE_KEY, BASE_SEPOLIA_RPC
forge script script/ThrowawayGuard.s.sol --rpc-url base_sepolia --broadcast --slow
forge script script/ThrowawayGuard.s.sol --sig "record()"   # adds the tx hashes from broadcast/ to the file
```

The first command writes `deployments/base-sepolia-throwaway-guard.json` (Safe, guard, safeTxHashes, the simulated revert data); `record()` adds the transaction hashes. Optional: `MOCK_USD` (default: `deployments/base-sepolia.json`), `SALT_NONCE` (default: block time). Rehearsal on an anvil fork with a public dev key (the dev keys carry an EIP-7702 delegation on Base Sepolia; clear it on the fork):

```bash
anvil --fork-url "$BASE_SEPOLIA_RPC" --port 8565 &
cast rpc anvil_setCode 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0x --rpc-url http://127.0.0.1:8565
export NETWORK=anvil-fork DEPLOYER_PRIVATE_KEY=$(cast wallet private-key "test test test test test test test test test test test junk" 0)   # anvil dev key 0
forge script script/ThrowawayGuard.s.sol --rpc-url http://127.0.0.1:8565 --broadcast --slow
forge script script/ThrowawayGuard.s.sol --sig "record()"
rm -r broadcast/ThrowawayGuard.s.sol/84532; kill %1   # the fork run is not a Base Sepolia run
```
