# skill-test-a

Fixture repository for dry-running the `ship-fix` skill. Node 20, Jest.

## Commands
- unit tests: `npm test`
- lint: `npm run lint`
- typecheck: `npm run typecheck`
- No integration tests, no E2E, no browser flows.

## Git / GitHub
- Default branch: `main`
- Merge strategy: squash
- Branch protection: none

## Deploy
- None. There is no deployment target; after merge, post-merge CI is the last
  verification step and production verification is skipped (report it as
  "n/a — no deploy").

## Ownership
- One implementation agent owns `src/` and `test/`.
- No repo-specific reviewer agents.
- No authoritative post-merge workflow named; all runs gate.
