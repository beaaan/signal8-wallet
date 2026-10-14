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
| `src/LocalSafe.sol` | stand-in Safe for Anvil and tests (one admin, no signatures); also the standalone wallet on the local FISCO chain, which has no Safe. Base Sepolia uses the real 2-of-3 Safe |
| `src/MockVNDDeposit.sol` + `test/FiscoYagi.t.sol` | mock bank-issued VND deposit token (mVND, 6 decimals) for the Yagi replay on FISCO; the test runs the Yagi deployment with chain id 20200, millisecond timestamps, NCHMF and no HKO relayer |
| `src/PlanGuard.sol` + `test/PlanGuard.t.sol` | first version: blocks module, owner, threshold, guard and fallback changes and any delegatecall unless queued 24 h earlier; a delegatecall to `MultiSendCallOnly` is checked call by call; a queued entry is used up only when the Safe transaction succeeds. Deployed by the script, not set on the Safe, not yet tried against real Safe bytecode |
| `script/Deploy.s.sol` → writes `deployments/<network>.json` | works on Anvil and on a local FISCO BCOS v3.16.3 chain (`deployments/fisco.json`); Base Sepolia deployment in `deployments/base-sepolia.json` |

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

Optional: `REGION` (must match the params file's `region`), `MULTISEND_CALL_ONLY` (default: the canonical Safe v1.4.1 address), `NCHMF_RELAYER_ADDRESS` (anvil default: dev account 9), `TIME_UNIT`, `ATTESTOR_CHAIN_ID`, `TOKEN` (`mUSD`, default, or `mVND`), `LOCAL_SAFE` (`true`: deploy a `LocalSafe` with `OWNER_ADDRESS` as admin and enable the module with `OWNER_PRIVATE_KEY`, off anvil too). The script refuses params whose plan hashes disagree and relayer addresses that repeat, and needs `NETWORK` on any chain other than anvil and Base Sepolia. On a local fork of Base Sepolia (chain id 84532 but a rehearsal) set `NETWORK=anvil-fork`, so the real `deployments/base-sepolia.json` is not overwritten.

A Yagi rehearsal on anvil (region VN-QN-HP, mVND, dev keys): `NETWORK=anvil-yagi TOKEN=mVND PLAN_PARAMS=../data/fixtures/plans/plan-params.yagi.json forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast`.

## Local FISCO BCOS (Yagi, stretch)

The Yagi replay (Vietnam, Sep 2024) runs on a local 4-node FISCO BCOS v3.16.3 Air chain. Hashes are in [docs/EVIDENCE.md](../docs/EVIDENCE.md#yagi-replay-local-fisco-bcos-stretch); they can be checked only on that local node. What differs from Base Sepolia:

| | Base Sepolia | Local FISCO BCOS |
| --- | --- | --- |
| Wallet | 2-of-3 Safe v1.4.1; owner proposals through the Safe Transaction Service | `LocalSafe`: one admin key (the owner), no signatures, no guard; owner proposals are only logged |
| Token | MockUSD (mUSD) | `MockVNDDeposit` (mVND): a mock bank-issued VND deposit token, because crypto is not a lawful means of payment in Vietnam. 6 decimals like mUSD; mock balances sized at about 25,000 VND per dollar (sizing, not an exchange rate) |
| Time | seconds, `timeUnit = 1` | the EVM's `block.timestamp` is in milliseconds: `TIME_UNIT=1000` for `PlanModule`, `SignalAttestor` and `PlanGuard`. The web3 RPC reports block header timestamps in seconds |
| Chain id | 84532 | 20200 from both `eth_chainId` and the `CHAINID` opcode (measured on v3.16.3; the plan assumed 0). The attestor's EIP-712 chain id is a constructor parameter anyway: `ATTESTOR_CHAIN_ID=20200`, recorded as `attestorChainId` |
| Local signal | HKO | NCHMF (risk level 4 → 8); `HKO_RELAYER_ADDRESS=0x0…0`, so no HKO attestation counts there |
| Gas | EIP-1559 | gas price 0, legacy transactions (`--legacy --with-gas-price 0`) |

Build and start the chain (outside the repo, in `$FISCO_DIR`, default `/tmp/fisco`; it downloads the v3.16.3 binary and `build_chain.sh` from GitHub once):

```bash
bash contracts/fisco/build-local-chain.sh <deployer address>   # 4 nodes, web3 RPC on 127.0.0.1:8545, prints eth_chainId 0x4ee8
```

v3.16.4 does not work for this: its web3 RPC refuses every sender with a zero balance (`InsufficientFunds`, even at gas price 0) and its genesis cannot fund accounts.

Foundry cannot read FISCO v3.16.3's blocks directly (`logsBloom` is `"0x"`, which alloy refuses), so `forge` goes through a small JSON-RPC shim that pads the bloom and changes nothing else; the agent talks to FISCO directly:

```bash
node contracts/fisco/rpc-shim.mjs 8547 http://127.0.0.1:8545 &   # forge → :8547 → FISCO :8545
```

Deploy (keys: throwaway keys made for this chain, kept outside the repo; FISCO has no balances to fund):

```bash
cd contracts
# DEPLOYER_PRIVATE_KEY, OWNER_PRIVATE_KEY, OWNER_ADDRESS, AGENT_ADDRESS, GUARDIAN_ADDRESS,
# GDACS_RELAYER_ADDRESS, NCHMF_RELAYER_ADDRESS, DEMO_CLIENT_ADDRESS in the environment
NETWORK=fisco TOKEN=mVND LOCAL_SAFE=true TIME_UNIT=1000 ATTESTOR_CHAIN_ID=20200 \
PLAN_PARAMS=../data/fixtures/plans/plan-params.yagi.json \
HKO_RELAYER_ADDRESS=0x0000000000000000000000000000000000000000 \
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8547 --broadcast --legacy --with-gas-price 0 --slow
```

This writes `deployments/fisco.json` (committed: addresses only). The broadcast log for chain 20200 is ignored. Then run the replay from `agent/` ([agent/README.md](../agent/README.md#yagi-on-a-local-fisco-bcos-chain)).
