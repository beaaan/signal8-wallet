# contracts

Foundry project. Solidity 0.8.11, OpenZeppelin 4.9.x. Spec: [../docs/specs/contracts.md](../docs/specs/contracts.md).

```bash
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v4.9.6 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
forge build
forge test -vv
```

Interfaces are in `src/interfaces/`. Build order (see [PLAN.md §5.1](../docs/PLAN.md#51-contracts-area-a)):

| File | Status |
| --- | --- |
| `src/MockUSD.sol` | to do |
| `src/PlanModule.sol` | to do (M1, 12 Oct) |
| `test/PlanModule.t.sol`, `test/PlanModule.invariant.t.sol` | to do (M1) |
| `src/SignalAttestor.sol` + tests | to do (13 Oct) |
| `src/mocks/MockSignalCover.sol`, `FlowCreditLine.sol`, `PaymentRouter.sol`, `MockMMFVault.sol`, `EvidenceRegistry.sol` | to do (14 Oct) |
| `src/PlanGuard.sol` | should (13 Oct) |
| `script/Deploy.s.sol` → writes `deployments/<network>.json` | to do (14 Oct) |

Deploy to Base Sepolia:

```bash
source ../.env
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```
