---
name: ship-fix
description: End-to-end delivery loop for a bug fix or small feature in a GitHub repo — plan, delegate to agents, independent review until SHIP, QA, PR, wait for the user's merge word, merge, watch the deploy, verify on production, report. Use when the user says "/ship-fix <task>", "修一下 X 然后上线", "fix and ship", or hands over a bug/feature to take all the way to production; also when a .ship-fix/state.md exists in the repo and the user answers a pending ship-fix question such as "merge", "合并", "keep waiting" or "rollback". Not for local-only fixes with no deploy, exploratory spikes, multi-week features, or non-GitHub hosting.
---

# ship-fix — from task to verified production

The lead (you) coordinates; agents do the work. The user decides only what is
listed in the Approvals table at the end. `references/templates.md` holds the
state file format, the agent prompt templates, and the PR / QA / report templates.

## Project config
Read `CLAUDE.md` (and plan docs it points to) first. Needed: agent file
ownership, test/typecheck/lint commands, deploy target and CLI, merge strategy,
forbidden actions, optionally which post-merge workflow is the authoritative CI gate.

- **How to operate this project** (commands, deploy, merge strategy,
  ownership): `CLAUDE.md` decides and overrides this skill.
- **Global limits** (Hard rules, Approvals, the merge gate, the Opus review):
  fixed. `CLAUDE.md` may add limits, never loosen these.

Commands `CLAUDE.md` doesn't give: infer from CI config first, then build files
(`package.json`, `pom.xml` / `build.gradle`, `pyproject.toml`, `Makefile`).
Low-cost commands (unit, typecheck, lint, compile) → use, say where it came
from. High-cost or side-effect commands (DB/containers, E2E, seeding or
migrating data, external services, deploys) → **if inferred**, confirm first,
all in one message; a command written in `CLAUDE.md` needs no confirmation.
`CLAUDE.md` can authorise a test command; it never authorises a production write.

**Before step 0, once:** `gh auth status` must pass, or — where auth is
proxied and `gh auth status` reports no token — `gh api repos/{owner}/{repo}`
must return the repo; neither → stop and ask the user to log in. Resolve, record in `state.md`, and reuse: `$BASE` = `gh repo
view --json defaultBranchRef -q .defaultBranchRef.name`; merge strategy from
`CLAUDE.md` (silent and several allowed → ask); **watch timeout** from
`CLAUDE.md`, else ~2× the median of recent completed runs (`gh run list
--branch $BASE --status completed --limit 10 --json createdAt,updatedAt`),
else 20 min; **never below 5 min** (fast CI gives a median of seconds).
**Always pass it to `timeout` with the unit: `timeout <N>m`** (a bare number
is seconds), and **never pipe a watched command** — `… | tail` returns
tail's exit code, not gh's; redirect to a log file and read the exit code. The same value is the hang threshold given to
execution agents.

## State
`.ship-fix/state.md` (format in templates) is the single source of truth for
the current run; keep `.ship-fix/` out of git via `.git/info/exclude`, never
`.gitignore`. When step 8 ends with a **terminal** verdict (shipped / partial
pass / failed) `state.md` is moved to `.ship-fix/runs/<branch-slug>.md`, so
the next run starts fresh. A "stopped — awaiting user" report leaves
`state.md` in place: the run resumes from it when the user answers.
- **Before any action with side effects** (push, PR, update-branch, merge,
  deploy, rollback),
  check the real state — branch pushed? PR exists? `gh pr view --json
  state,autoMergeRequest` already `MERGED`, or auto-merge set / queued? deploy
  for this commit already running? Done → record and move on, never repeat.
- **Immediately after** such an action, after every approval received (into
  the Approvals table of `state.md`), and at the end of every step, update
  `state.md` before anything else.
- After a context reset: read `state.md`, verify its last action against the
  real state, resume at "Next action".

## Commit rules (both paths; pasted into agent prompts with `$BASE` filled in)
- Conventional commits; stage only the paths you own.
- No AI attribution in commits or PR bodies. Only Claude's own trailers
  (`Co-Authored-By: Claude …`, `Claude-Session:`) count; human co-authors stay.
- Attribution is prevented, not repaired: the repo or user settings must
  disable it (`"attribution": {"commit": "", "pr": ""}`); check that before
  step 2 and tell the user if it is missing. **This skill never rewrites
  history.**
- Check right after every commit or agent-branch merge, and again before every
  push: `git fetch origin $BASE` (explicit — `origin/$BASE` may not exist
  in a fresh clone), then
  `git log origin/$BASE..HEAD --format=%B | grep -iE '^(Co-Authored-By: Claude|Claude-Session:)'`
  (merge commits included — the lead's own merges can carry one).
  A match → stop and ask (Approvals): the user either accepts those commits
  (record their SHAs under `accepted trailers`; later checks skip exactly
  those SHAs, nothing else) or rewrites the branch themselves. Never rebase,
  amend or force-push. **After a user rewrite of a pushed branch:** `git
  fetch origin && git checkout -B <branch> origin/<branch>`, clear
  `QA valid for commit`, `last gated commit` and `merge word`, then step 3 on
  the full diff, step 4, step 5 from the CI watch.

## 0. Intake
- `state.md` already exists → same task: resume at its "next action";
  different task: report, ask. Only then write the "Before step 0" values.
- `git status`. Dirty tree with someone else's work → stop and ask.
- Leftovers from a crashed run: `git worktree prune`; list remaining
  worktrees, old agent branches, `.git/index.lock`. Items in `state.md` belong
  to the run being resumed — keep. Others: list to the user, delete only on
  their word; `index.lock` only when `pgrep -x git` is empty, never kill git.
- Create the branch now from an up-to-date `$BASE`: `fix/<slug>` or `feat/<slug>`.
- Reproduce or locate the problem; state the root cause in one or two
  sentences. Repository search that would return more than a screen of
  output (grep across a tree, log excerpts, several commands) goes to a Haiku
  agent on the execution template — the lead receives paths, line numbers and
  one-line summaries, not file dumps. One or two short commands the lead runs
  itself: an agent costs ~70k tokens of baseline overhead regardless of task
  size. The lead makes the root-cause call either way.
  Can't → stop, report what you checked. Never fix on a guess.

## Models
| Model | Used for |
|---|---|
| Haiku | Execution only, on the execution template: read-only search, running test suites, collecting evidence, CI log triage, read-only smoke checks. Returns results in the template's formats; writes nothing except what the listed commands themselves produce, directed under `.ship-fix/logs/`; never judges, never cleans up. |
| Sonnet | Implementation within one unit, adding tests, fixing findings, failure-mode reproduction, browser walkthroughs, test-data cleanup. |
| Opus | The lead's own root-cause call, cross-file or tricky implementation, every review, security and database pass. |

Always pass `model: "opus"` to review agents, including the repo's own
reviewer agents — the model override wins over a pinned lesser model. An
execution agent that returns `UNEXPECTED: …` is not retried blindly: the lead
reads the saved log, decides, and re-briefs; from QA it is classified per
step 4 (test failure vs environment failure). In **no-agent mode** the lead does all agent work itself.

## 1. Plan
**Fast path** (all true): one logical unit, roughly ≤20 lines, no auth / input
handling / DB / secrets / external calls / new dependency → the lead implements
and commits, then step 3 (one round minimum), then step 4. On the fast path
"the owning agent" below means the lead, and each fix round after review or
QA counts as one fix loop.

**Full path**: split into subtasks of one logical unit each, assigned to the
agent owning those paths. Scope change, migration, new dependency or
production data → present the plan and wait.

## 2. Implement (full path)
- Model per the Models table: Sonnet by default, Opus for cross-file or
  tricky logic. Never Haiku — every implementation agent tests and commits.
- Build each prompt from the agent prompt template (Commit rules + Hard rules
  verbatim). Each agent: tests first where practical → implement → typecheck,
  lint, unit tests pass → commit → report files changed and branch name.
- Sequential agents work on the fix branch, one at a time. Parallel agents
  use `isolation: "worktree"` and **must commit on their own branch before
  finishing** (an uncommitted worktree is discarded); the lead merges them in
  dependency order, then removes the worktrees and branches. Never two agents
  in one working tree.
- Conflicts: the lead resolves (ownership exception), re-runs typecheck, lint
  and unit tests, and records the touched files under `conflict files` in
  `state.md` so step 3 reviews them. Conflict resolution is a code change: it
  counts as a fix loop.
- **No Agent tool** (e.g. running inside a subagent): the lead implements
  everything itself and records "no-agent mode".

## 3. Independent review
- A reviewer that did not write the code reviews `git diff $BASE...HEAD`,
  on Opus (this is the only independent quality gate): the repo's reviewer
  agents if any, else a general-purpose agent on the **review prompt
  template** (checklist: root cause actually fixed, edge cases, error
  handling, tests cover the fix, scope creep, conflict files; read-only, no
  git state changes — a reviewer once ran `git checkout` in the shared tree). Add a security pass for auth, input, DB, files,
  external calls, secrets; a database pass for SQL/migrations.
- **Each pass returns one verdict: `SHIP` or `FIX` with findings.** The loop
  ends when every pass that ran says `SHIP`; record the verdict per pass.
- **No-agent mode:** the lead reviews from a fresh read against the same
  checklist and marks the review **"not independent"** in the PR, the report,
  and the request for merge approval. Never present it as independent.
- CRITICAL/HIGH → fix; MEDIUM → fix unless clearly not worth it (say why);
  LOW → deferred, listed in the PR. Fixes go to the owning agent; re-review
  only the change. Don't argue a finding away without evidence.
- Findings ledger in `state.md`, given to the reviewer every round: don't
  reverse a resolved finding without new evidence. **Oscillation** (a resolved
  finding returns, or a fix undoes an earlier fix) → stop early and ask.
- **Fix-loop budget:** every return to step 2, whatever the trigger, is one
  loop. After 4 with anything still failing → stop, summarise, ask.

## 4. QA
Up to two agents, split by whether judgement is involved. Before either
starts, the lead records the **id baseline** (current max ids of tables the
tests will touch) in `state.md`. The Sonnet agent runs **only if there is
something for it** — a browser flow, a failure mode that needs environment
manipulation, or data to clean up; otherwise the lead records those rows as
`n/a` with the reason. It **starts only after Haiku has returned** (its
failure-mode step may stop the DB that Haiku's suites use). In no-agent mode
the lead does all of it.
- **Haiku, execution template:** full unit suite; integration tests (local
  DB/containers if the repo has them); E2E if present — told to **run every
  suite regardless of earlier exits**, with trace/screenshot output pointed
  under `.ship-fix/logs/`. Returns the template's test-run lines; **the lead
  writes the QA entry** from them.
- **Sonnet, agent prompt template in its QA variant** (no source write paths,
  no commit): the browser pass of the affected flow (headed where a display
  exists, else headless with evidence); the reported failure mode, not just
  the happy path (a "DB asleep" bug means actually stopping and waking the
  DB); cleanup, which removes only rows above the recorded id baseline.
- The QA entry always goes in `.ship-fix/qa.md` (untracked — a commit to a
  tracked report would itself invalidate QA). Copy it into the PR body's
  evidence table. QA does not edit source.
- A test failure → step 2 → step 3 on the change → QA again; if the branch
  was already pushed, then step 5 from the push (CI watch, body edit, gate). An **environment failure** (suite could not
  run: DB/container didn't start, missing tool — no failing test in the
  output) is not a fix loop: the lead fixes the setup and re-runs, at most
  twice; a third environment failure → stop and ask.
  **Any new commit after QA invalidates it**, including base updates and
  conflict resolution.

## 5. Pull request
- Commit-rules check, push `-u`, `gh pr create` from the PR template, no
  attribution footer.
- **CI watch:** `timeout <N>m gh pr checks <n> --watch > .ship-fix/logs/pr-checks.log 2>&1; rc=$?`
  (no pipe). Classify by the log **and** `rc` (exit 1 is both "failed" and
  "no checks reported"; 124 is timeout):
  - "no checks reported" → look at `.github/workflows/*` for a
    `pull_request`, `pull_request_target` or `push` trigger that matches the
    head branch (or `push` on `$BASE` for post-merge) and whose `paths` /
    `branches` filters don't exclude this change. One exists → CI may be slow to
    register: re-run every 30 s under **one** watch-timeout budget for all
    re-runs together; budget spent with still no checks → `no CI` (not
    `not verified`: nothing was ever running). None → `no CI`.
  - any failed → **Red path:** Haiku log triage, fix through steps 2–4, then
    the commit-rules check and push, then back to the CI watch. Each pass
    through the Red path is a fix loop.
  - cancelled → `cancelled`, report, ask. Only skipped → `no CI`.
  - exit 124 → the **Timed out** rule in step 6; user stops waiting →
    `not verified`.
  Then `gh pr view <n> --json body -q .body > .ship-fix/pr-body.md`, edit
  the CI line from `pending` to the final value, `gh pr edit <n> --body-file
  .ship-fix/pr-body.md` — the body the user sees must be current. Record
  `ci … for commit <sha>` in `state.md`.
- **Merge gate: stop.** Record the head as `last gated commit`. Give the PR
  link, that commit, and whether the review was independent. Wait for an
  explicit "合并 / merge" and record the commit it was given for.

## 6. Merge and deploy
- `gh pr view <n> --json state,headRefOid,mergeStateStatus,autoMergeRequest`.
  Take the **first matching** rule:
  - `state` = `MERGED` → record, skip to the merge SHA.
  - `state` = `CLOSED` → report, ask.
  - `autoMergeRequest` set, or in the merge queue (`gh api graphql -F
    owner='{owner}' -F name='{repo}' -F n=<n> -f query='query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){isInMergeQueue}}}'`)
    → the merge is already submitted: skip to the merge SHA and poll there.
  - **`merge word` is `none`, or its commit ≠ `headRefOid` → never merge.**
    Route by what `state.md` says about this head:
    - head = the last commit that reached the merge gate (word not yet given,
      or a reset at the gate) → back to the merge gate.
    - head = `base-update commit` → no re-review (the fix's code did not
      change); if `QA valid for commit` and `ci … for commit` both equal this
      head → merge gate, else resume the BEHIND sequence at its CI watch.
    - anything else → a commit arrived after the merge word: `git pull
      --ff-only`, the Commit-rules check, step 3 on the delta, step 4 on the
      new head, then step 5 from the push (CI watch, body edit, merge gate).
  - `CLEAN` or `HAS_HOOKS` → merge.
  - `BEHIND` → `gh pr update-branch <n>` (merge, never `--rebase`: that needs
    a force-push). Record the new head as `base-update commit`, set
    `merge word: none`, `git pull --ff-only`, the CI watch of step 5 (red →
    Red path), step 4 on the new head, body edit, then the merge gate. The
    rule above then routes it without re-review.
  - `DIRTY` → resolve conflicts (counts as a fix loop), steps 3–4, then step
    5 from the commit-rules check (push, CI watch, body edit, merge gate).
  - `UNSTABLE` or `BLOCKED` → `gh pr checks <n>`: pending → the step-5 CI
    watch under `timeout <N>m` (then the Timed out rule). Failing under
    `UNSTABLE` (non-required) → the Red path of step 5, **unless** the user
    names that check and approves merging over it (Approvals table) — then
    merge and set the PR body's CI line to `red`. Failing or no checks under
    `BLOCKED` (a required check), all passing under `BLOCKED`, or `DRAFT` →
    human gate (required checks, reviews, branch protection, draft status) →
    report and wait.
  - `UNKNOWN` or anything else → report verbatim, ask; never guess.
- Merge pinned to the approved commit — the server refuses if the head moved:
  `gh pr merge <n> --<strategy> --match-head-commit <approved-sha>`. Non-zero
  exit → re-run the rules above from the top **once**; if that lands on the
  same rule at the same head, or the merge fails a second time, report gh's
  error verbatim and ask (never retry without `--match-head-commit`, never
  `--admin`). A failing *required* check is a human gate, not something a
  named approval can merge over.
- **Merge SHA:** `gh pr view <n> --json state,mergeCommit`. `state` ≠
  `MERGED` after a successful merge command → queued or auto-merge: poll
  under the watch timeout, checking `isInMergeQueue` and `autoMergeRequest`
  each time. Both gone while still `OPEN` → **ejected** (counts as a fix
  loop): the queue's checks ran on a temporary commit, so triage
  `gh run list --event merge_group --limit 10 --json databaseId,conclusion,headBranch`,
  keeping only runs whose `headBranch` starts with
  `gh-readonly-queue/$BASE/pr-<n>-`;
  a failed run → Red path with that run's log; no failed run (removed by
  hand, conflict) → report and ask. On `MERGED`, record `mergeCommit.oid`;
  everything below keys off it, not off "latest on `$BASE`". Fast-forward
  local `$BASE`.
- **Post-merge CI, all runs on that SHA:** `gh run list --commit <sha>
  --limit 100 --json databaseId,workflowName,status,conclusion` (empty →
  same rule as step 5: workflows with a `push` trigger on `$BASE` exist →
  keep polling under the watch timeout; none → `no CI`). Poll under `timeout` until none
  has `status` in `queued`, `in_progress`, `requested`, `pending`; then list
  once more — runs triggered by other runs appear late. New runs → poll them
  too, list again; repeat until a list adds nothing new. Only then is the set
  complete. If `CLAUDE.md` names an authoritative workflow (matched on
  `workflowName`), only that one gates; a failure in any other run is
  recorded and reported under "Still open", never silently dropped. Record
  every run with its raw status/conclusion; the overall CI value is:
  - all gating runs `success` and the set complete → `green`; `skipped` /
    `neutral` runs are ignored (all skipped → `no CI`). The named
    authoritative workflow never ran on this SHA, or concluded only
    `skipped` (path filter) → it cannot gate, so **every other run gates**
    for this merge; report that it didn't run.
  - any gating `failure` / `timed_out` / `startup_failure` → `red` →
    **post-merge CI failed** below.
  - `status` = `waiting` or conclusion `action_required` → `awaiting action`:
    a human must trigger or approve something, often the deploy itself;
    report which run and wait (triggering a deploy is a production write).
  - `cancelled`, `stale`, anything else → `cancelled`, report the raw value,
    ask; don't retry.
- **Platform deploy:** watch with read-only CLI commands to a terminal state
  under the same timeout; record `deploy: <id> — pending | success | failed |
  not verified | not started`. `gh` and most platform CLIs have no timeout
  flag — wrap in `timeout` (macOS: `gtimeout`; or run in the background and
  treat the shell tool's own limit as exit 124).
- **Timed out** (exit 124) ≠ failed, for any watch (PR checks, post-merge CI,
  queue, deploy): check the real state once, report, ask whether to keep
  waiting. User stops the wait → record **that watch** as `not verified`
  (never green) in `state.md` and the report. Any watch `not verified` →
  verdict at most `partial pass`; a deploy `not verified` skips step 7 (its
  three fields become `not run`); a merge-queue wait `not verified` → the
  merge state is unknown → verdict `stopped — awaiting user`, nothing further. Never propose a rollback on a
  timeout alone.
- **Post-merge CI failed** ≠ deploy failed: Haiku log triage (execution
  template) for the failing job, then check separately whether the deploy
  ran. Never ran → `deploy: not started`, production untouched, no rollback
  question → post-merge fix. Ran and succeeded → step 7, then post-merge fix.
  Failed or unclear → next rule.
- **Deploy failed or unclear:** check production impact first (partial
  rollout, service down, old version serving). Record `deploy: failed`;
  unclear with impact ruled out → `not verified`. Affected → tell the user
  now and propose a rollback (step 7). Then find the cause → post-merge fix.
  Never "retry until green" without knowing why.
- **Post-merge fix:** the branch is merged, so a fix is a **new run**.
  First finish this one: step 8 now — verdict `failed` if the deploy failed
  or `rollback: done`, else `partial pass` — the follow-up
  listed under "Still open"; then `state.md` moves to
  `.ship-fix/runs/<branch-slug>.md`. Then start fresh: new `state.md` with
  `linked run` pointing back, new branch `fix/<slug>-2` (never reuse a
  branch name; a `runs/` file is never overwritten — suffix it the same way)
  from an up-to-date `$BASE` (which contains the merge SHA), steps 0–8 with
  its own fix-loop budget, PR and merge word; its step-8 report closes the
  first run's open item.

## 7. Verify on production
- Smoke-test affected endpoints with **read-only requests** (`curl -I`, GET,
  view flows). Read-only is decided by what the handler does, not the HTTP
  method: logout, confirm/unsubscribe links, tracking, "mark as read" are
  writes. Writes → list for the user to run, or ask.
- Read runtime logs after the deploy.
- Environmental bug (cold start, sleep, network) → reproduce that condition
  with read-only actions; don't generate traffic that defeats it; wait in a
  background task.
- Record smoke, logs and failure-mode results in `state.md`.
- **Verification fails or new errors appear** → tell the user with evidence
  and propose a rollback: prefer the platform's redeploy-previous (fast); a
  revert PR is the code follow-up and needs merge + deploy. Approved →
  perform it, record `rollback: done`, then post-merge fix. Declined →
  record `rollback: none`, post-merge fix; verdict per step 8.

## 8. Report (in the user's language)
Final-report template: one-line verdict, table of checks, open items, what
needs the user. **Verdict, first rule that applies:** waiting on the user at
a gate → `stopped — awaiting user`; deploy failed or `rollback: done` →
`failed`; any watch `not verified`, any open follow-up run, any non-gating CI
failure, or any step-7 check failed → `partial pass`; otherwise
`shipped and verified`.

## Approvals — when to stop and wait
This is the complete list. An approval covers exactly what it says; when in
doubt, it has expired. Nothing here is pre-approved by an earlier run or a
general "go ahead". (A test command written in `CLAUDE.md` is not on this
list; an inferred one is.)

| Action | Wait for | Covers |
|---|---|---|
| `gh` not logged in | Login | — |
| Merge strategy not in `CLAUDE.md` and several allowed | A choice | This run |
| Dirty tree with someone else's work | Instruction | That tree |
| Deleting leftovers from earlier runs | Per listed item | Those items |
| Root cause not found | Instruction | — |
| Plan with scope change, migration, new dependency or production data | Plan approval | That plan |
| Inferred high-cost / side-effect command | Confirmation | That command, this run |
| Review oscillation or fix budget exhausted | A direction | That decision |
| Merge | Explicit "合并 / merge" | That PR at exactly that head commit |
| Merge over a failed non-required check (`UNSTABLE`) | Approval naming the check | That check, that commit |
| Human gate on the PR (reviews, branch protection, `DRAFT`) | The gate cleared, or instruction | That gate |
| PR closed | Instruction | That PR |
| Watch timed out | Keep waiting or not | That wait |
| CI run `waiting` / `action_required` | The human action, or instruction | That run |
| Production write (incl. triggering a deploy job, non-listed smoke writes) | Approval naming the action | That action |
| Rollback | Approve or decline | That rollback |
| Touching the user's dev server or test account | Instruction | That resource |
| Attribution trailer found in any commit on the branch | Accept, or the user rewrites it themselves | Those commit SHAs only |
| Any state reported verbatim as unhandled | A direction | That decision |

## Hard rules
- No real customer/business data in code, tests, fixtures, docs or commits.
- Never print secrets, tokens, DB URLs or credentials.
- Production writes (data, env vars, scaling, DNS, rollbacks, deploy triggers)
  only with the user's approval for that action.
- Don't touch the user's running dev servers or personal test accounts unless
  the user says so.
- Prefer the read-only command that answers the question (`railway domain
  list`, not `railway domain`).
- Configuration is not behaviour: confirm a fix by observing it.
- Write only inside your assigned paths (exceptions: the lead's conflict
  resolution, and the fast path).
