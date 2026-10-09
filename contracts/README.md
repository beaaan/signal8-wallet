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
| `test/PlanModule.t.sol`, `test/PlanModule.invariant.t.sol` | unit, fuzz and the six invariants from the spec |
| `src/SignalAttestor.sol` + `test/SignalAttestor.t.sol` | first version: EIP-712, freshness, nonces, TTLs, FISCO chain id and `timeUnit`, timelocked relayer rotation |
| `src/mocks/MockSignalCover.sol`, `FlowCreditLine.sol`, `PaymentRouter.sol`, `MockMMFVault.sol`, `EvidenceRegistry.sol` + `test/Mocks.t.sol` | first version |
| `src/LocalSafe.sol` | stand-in Safe for Anvil and tests only (one admin, no signatures); Base Sepolia uses the real 2-of-3 Safe |
| `src/PlanGuard.sol` + `test/PlanGuard.t.sol` | first version: blocks module, owner, threshold, guard and fallback changes and any delegatecall unless queued 24 h earlier; deployed by the script, not set on the Safe |
| `script/Deploy.s.sol` → writes `deployments/<network>.json` | works on Anvil; Base Sepolia path untested |

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
