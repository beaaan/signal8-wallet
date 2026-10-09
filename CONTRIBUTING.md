# How we work

## Branches and pull requests

- `main` is always runnable. Never push directly to it.
- Branch names: `<area>/<short-name>`, e.g. `contracts/plan-module`, `agent/hko-relayer`, `web/dashboard`, `docs/security`.
- Small pull requests, merged the same or next day. One reviewer from another area is enough.
- A pull request is mergeable when CI is green and the reviewer can run what it adds.

## Commits

Short imperative messages: `Add PlanModule daily cap`, `Fix GDACS event id parsing`.

## Definition of done for a card

1. Code merged into `main` with tests (contracts: Foundry tests; agent: at least one runnable script or unit test).
2. The card's "Done when" line on Notion is true.
3. Anything another area needs is published (ABIs, addresses, schemas, fixtures).
4. Card moved to Done on the Notion board.

## Secrets

- Never commit `.env`, private keys, mnemonics or API keys. `.gitignore` covers `.env*` except `.env.example`.
- If a key leaks, rotate it and tell the team the same hour.

## Conventions

- Solidity 0.8.11, OpenZeppelin 4.9.x, custom errors, NatSpec on external functions.
- TypeScript strict mode; zod for every value that crosses a trust boundary.
- Amounts are strings in token units inside JSON; `bigint` in code.
- Times in ISO 8601 with offset; chain timestamps in seconds (FISCO: milliseconds, handled by `TIME_UNIT`).
