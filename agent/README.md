# agent

TypeScript backend: relayers, replay runner, extractor, planner, executor, storm and everyday loops. Spec: [../docs/specs/agent.md](../docs/specs/agent.md).

```bash
npm install
npm install @safe-global/protocol-kit @safe-global/api-kit   # pin the versions you install
npm run typecheck
npm run hko:now        # prints the current HKO tropical cyclone signal level
npm run replay -- --event ragasa-2025 --speed 600 --dry-run
```

What exists now: `src/types.ts` (zod schemas), `src/relayers/hko.ts` (HKO parser), `src/replay/runner.ts` (timeline loader and clock, dry-run only). Everything else in the spec's layout is still to build (see [PLAN.md §5.2–5.3](../docs/PLAN.md#52-trigger-and-replay-area-b)).
