---
name: ship-fix
description: End-to-end delivery loop for a bug fix or small feature in a GitHub repo — plan, delegate to agents, independent review until SHIP, QA, PR, wait for the user's merge word, merge, watch the deploy, verify on production, report. Use when the user says "/ship-fix <task>", "修一下 X 然后上线", "fix and ship", or hands over a bug/feature to take all the way to production; also when a .ship-fix/state.md exists in the repo and the user answers a pending ship-fix question such as "merge", "合并", "keep waiting" or "rollback". Not for local-only fixes that will not be merged, exploratory spikes, multi-week features, or non-GitHub hosting.
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

**Before step 0, once:** `mkdir -p .ship-fix/logs` (every redirect below
depends on it) and add `.ship-fix/` and `.claude/worktrees/` to
`.git/info/exclude` (so step 0's `git status` doesn't see them). Then `gh api repos/{owner}/{repo}` must return the repo —
that, not `gh auth status` (which fails on proxied setups), decides whether
`gh` is usable; failure → stop and ask the user to log in. Resolve, record
in `state.md`, and reuse: `$BASE` = `gh api repos/{owner}/{repo} --jq .default_branch`; merge strategy from
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
the current run; keep `.ship-fix/` **and `.claude/worktrees/`** (where the
Agent tool puts isolated worktrees — inside the repo) out of git via
`.git/info/exclude`, never `.gitignore`. When step 8 ends with a **terminal** verdict (shipped / partial
pass / failed) `state.md` is moved to `.ship-fix/runs/<branch-slug>.md`, so
the next run starts fresh. A "stopped — awaiting user" report leaves
`state.md` in place: the run resumes from it when the user answers.
- **Before any action with side effects** (push, PR, update-branch, merge,
  deploy, rollback),
  check the real state — branch pushed (`git ls-remote`)? PR exists
  (`gh api "repos/{owner}/{repo}/pulls?head={owner}:<branch>&state=all"` —
  quoted, or the shell eats the `&`)?
  already merged, or `auto_merge` set? deploy for this commit already
  running? Done → record and move on, never repeat.
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
  the first commit (step 1 on the fast path, step 2 otherwise) and tell the
  user if it is missing. **This skill never rewrites
  history.**
- Check right after every commit or agent-branch merge, and again before every
  push: `git fetch origin +$BASE:refs/remotes/origin/$BASE` (explicit
  refspec — a single-branch or empty-repo clone never creates `origin/$BASE`
  on a plain fetch), then
  `git log origin/$BASE..HEAD --format=%B > .ship-fix/logs/trailers.log || echo CHECK-FAILED`,
  then `grep -iE '^(Co-Authored-By: Claude|Claude-Session:)' .ship-fix/logs/trailers.log`
  (two commands, no pipe — agent sandboxes may refuse the piped form; merge
  commits included — the lead's own merges can carry one). `CHECK-FAILED` or
  a grep exit of 2 is a failed check, never a clean one: fix the refs and
  re-run once; a second failure → stop and ask.
  A match → stop and ask (Approvals). The user either rewrites the branch
  themselves, or **waives the check for this run** — record
  `trailer check: waived by user at <time>` in `state.md` and pass
  `Trailer check: waived` to every later agent prompt, which then skips the
  check. There is no per-commit accept list. Never rebase, amend or
  force-push. **After a user rewrite of a pushed branch:**
  `git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch> && git checkout -B <branch> origin/<branch>`,
  clear `QA valid for commit`, `last gated commit` and `merge word`, then
  step 3 on the full diff, step 4, step 5 from the CI watch.

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
  dependency order, then **removes the worktrees and branches before running
  anything** (`git worktree remove --force <path>`, `git branch -d`): test
  runners and linters in the main tree pick up files under
  `.claude/worktrees/` (Jest ran 35 tests instead of 13). Never two agents in
  one working tree.
- Conflicts: the lead resolves (ownership exception) and commits the
  resolution only; typecheck, lint and unit tests run once, after all merges
  and the worktree removal (the worktrees would pollute the run). Record the
  touched files under `conflict files` in `state.md` so step 3 reviews them. Conflict resolution is a code change: it
  counts as a fix loop.
- **No Agent tool** (e.g. running inside a subagent): the lead implements
  everything itself and records "no-agent mode".

## 3. Independent review
- A reviewer that did not write the code reviews `git diff origin/$BASE...HEAD`
  (after the fetch above — local `$BASE` is stale until step 6),
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
All GitHub calls in steps 5–6 use the REST API: `gh api` (`{owner}` /
`{repo}` are filled in by gh) and `gh run list` (REST as well). `gh pr …`
subcommands need GraphQL, which some environments block; the forms below
work everywhere `gh api` does. Quote any endpoint containing `&`.
- Commit-rules check, push `-u`, then create the PR from the PR template (no
  attribution footer):
  `jq -Rs --arg t "<title>" --arg h "<branch>" --arg b "$BASE" '{title:$t,head:$h,base:$b,body:.}' .ship-fix/pr-body.md > .ship-fix/pr.json`
  and `gh api repos/{owner}/{repo}/pulls --method POST --input .ship-fix/pr.json --jq '{number,html_url,head:.head.sha}'`
  (non-2xx → report the error verbatim, ask; a 422 "already exists" → find
  it with the `pulls?head=` query above and continue with that number).
  Record the number and head. **After every later push, set head =
  `git rev-parse HEAD`** and confirm it against the PR's `.head.sha` before
  watching — the watch always runs on the current head, never a stale one.
- **CI watch** on the head SHA, polled every 20 s under the watch timeout, no
  pipes — each poll is three reads:
  `gh api "repos/{owner}/{repo}/commits/<head>/check-runs?per_page=100" --paginate --jq '{n:.total_count,runs:[.check_runs[]|{name,status,conclusion}]}'`
  (paginated — the default page is 30 and a failing run past it would be
  missed; `n` must equal the number of runs listed),
  `gh api repos/{owner}/{repo}/commits/<head>/status --jq '{n:.total_count,state}'`
  (legacy statuses; **with `n` = 0 its `state` is always `pending` and means
  nothing — ignore `state` unless `n` > 0**), and
  `gh run list --commit <head> --limit 100 --json databaseId,status,conclusion`
  (workflow runs: a job behind `needs:` or a late matrix has no check run
  until it is queued, so the check-runs list alone can look complete while
  work is still coming). Record each poll's exit code; a non-zero exit is an
  error to report, not a result.
  - both `n` = 0 → look at `.github/workflows/*` for a `pull_request`,
    `pull_request_target` or `push` trigger that matches the head branch and
    whose `paths` / `branches` filters don't exclude this change. One exists
    → CI may be slow to register: keep polling under **one** watch-timeout
    budget; budget spent with still nothing → `no CI` (not `not verified`:
    nothing was ever running). None → `no CI`.
  - any check-run `status` ≠ `completed`, any workflow run `status` ≠
    `completed`, or (status `n` > 0 and `state` = `pending`) → keep polling.
  - everything completed → poll **once more** after 20 s; new runs appeared
    → keep going; nothing new, every check-run `conclusion` ∈ {`success`,
    `skipped`, `neutral`}, every workflow-run `conclusion` the same, and
    (status `n` = 0 or `state` = `success`) → `green` (only skipped/neutral
    → `no CI`).
  - any `failure` / `timed_out` (check run or workflow run), or status
    `state` = `failure` → **Red path:** Haiku log triage, fix through steps
    2–4, then the commit-rules check and push (head updated), then back to
    the CI watch. Each pass through the Red path is a fix loop.
  - `cancelled` → `cancelled`, report, ask. `action_required` → `awaiting
    action`, report, wait. Any other conclusion (`stale`, …) → report
    verbatim, ask.
  - watch timeout reached → the **Timed out** rule in step 6; user stops
    waiting → `not verified`.
  Then `gh api repos/{owner}/{repo}/pulls/<n> --jq .body > .ship-fix/pr-body.md`,
  edit the CI line from `pending` to the final value,
  `jq -Rs '{body:.}' .ship-fix/pr-body.md > .ship-fix/pr-body.json`,
  `gh api repos/{owner}/{repo}/pulls/<n> --method PATCH --input .ship-fix/pr-body.json --jq '.body' > /dev/null`
  — the body the user sees must be current. Record `ci … for commit <sha>`
  in `state.md`.
- **Merge gate: stop.** Record the head as `last gated commit`. Give the PR
  link, that commit, and whether the review was independent. Wait for an
  explicit "合并 / merge" and record the commit it was given for.

## 6. Merge and deploy
- `gh api repos/{owner}/{repo}/pulls/<n> --jq '{state,merged,head:.head.sha,mergeable,mergeable_state,auto_merge,merge_commit_sha}'`.
  `merged` = true → record `merge_commit_sha` (**only then** — before the
  merge that field holds GitHub's test-merge commit, not a real one), skip
  to the merge SHA (the
  head branch may already be auto-deleted; don't look for it). `state` =
  `closed` and not merged → report, ask. Otherwise also
  `git ls-remote origin refs/heads/<branch>`: the two heads differ → the PR
  API is lagging a push (seen ~5 s): wait 10 s and re-read, under the watch
  timeout; still differing → report both heads, ask. `mergeable` = null →
  GitHub is still computing: wait 10 s, re-read, under the watch timeout;
  still null → the Timed out rule. Then take the **first matching** rule:
  - `auto_merge` set (by the user, outside this skill) → head must equal
    both the merge-word commit and `QA valid for commit`; if not, report the
    mismatch and ask — auto-merge can land an unreviewed head. If they match,
    no merge call is made: poll `GET pulls/<n>` under the watch timeout until
    `merged` is true, then take `merge_commit_sha` as the merge SHA.
  - **`merge word` is `none`, or its commit ≠ `head` → never merge.**
    Route by what `state.md` says about this head:
    - head = the last commit that reached the merge gate (word not yet given,
      or a reset at the gate) → back to the merge gate.
    - head = `base-update commit` → no re-review (the fix's code did not
      change); if `QA valid for commit` and `ci … for commit` both equal this
      head → merge gate, else resume the BEHIND sequence at its CI watch.
    - anything else → a commit arrived after the merge word: `git pull
      --ff-only` (fails → an unannounced force-push or divergence: report,
      ask), the Commit-rules check, step 3 on the delta, step 4 on the
      new head, then step 5 from the push (CI watch, body edit, merge gate).
  - `mergeable_state` = `clean` or `has_hooks` → merge.
  - `behind` → `gh api repos/{owner}/{repo}/pulls/<n>/update-branch --method PUT -f expected_head_sha=<head>`
    (a merge from base, never a rebase: that needs a force-push; the call is
    asynchronous — poll the PR until `head` changes, under the watch
    timeout; non-2xx → re-read the PR and re-run these rules once, then
    report verbatim and ask). Record the new head as `base-update commit`, set
    `merge word: none`, `git pull --ff-only`, the CI watch of step 5 (red →
    Red path), step 4 on the new head, body edit, then the merge gate. The
    rule above then routes it without re-review.
  - `dirty` → resolve conflicts (counts as a fix loop), steps 3–4, then step
    5 from the commit-rules check (push, CI watch, body edit, merge gate).
  - `unstable` or `blocked` → re-run the step-5 CI watch on the head:
    pending → wait (then the Timed out rule); all passing → re-read the PR
    and re-run these rules once (the state usually becomes `clean`; if it
    stays `blocked` it is a human gate). Failing under `unstable`
    (non-required) → the Red path of step 5, **unless** the user names that
    check and approves merging over it (Approvals table) — then merge and set
    the PR body's CI line to `red`. Failing or no checks under `blocked` (a
    required check), all passing under `blocked`, or `draft` → human gate
    (required checks, reviews, branch protection, draft status) → report and
    wait.
  - `unknown` or anything else → report verbatim, ask; never guess.
- Merge pinned to the approved commit — the server refuses with 409 if the
  head moved:
  `gh api repos/{owner}/{repo}/pulls/<n>/merge --method PUT -f merge_method=<squash|merge|rebase> -f sha=<approved-sha> --jq '{merged,sha}'`.
  Non-2xx → re-run the rules above from the top **once**; if that lands on
  the same rule at the same head, or the merge fails a second time, report
  the API error verbatim and ask (never retry without `sha`; a 405 "not
  mergeable" or a merge-queue refusal is a human gate — this skill does not
  drive merge queues). A failing *required* check is a human gate, not
  something a named approval can merge over.
- **Merge SHA:** the `sha` in the merge response (a 2xx from PUT `/merge`
  always means merged); confirm with
  `gh api repos/{owner}/{repo}/pulls/<n> --jq '{merged,merge_commit_sha}'`.
  On the `auto_merge` path the SHA comes from that poll instead. Record it;
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
  not verified | not started`, or `n/a — no deploy` when `CLAUDE.md` says the
  project has no deploy target (step 7 fields then also `n/a — no deploy`,
  and the verdict is unaffected). `gh` and most platform CLIs have no timeout
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
  now and propose a rollback (step 7) **and wait for that decision before
  anything else** — `state.md` stays in place until it is answered. Then
  find the cause → post-merge fix. Never "retry until green" without knowing
  why.
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
| Merge over a failed non-required check (`unstable`) | Approval naming the check | That check, that commit |
| Human gate on the PR (reviews, branch protection, `draft`, merge queue) | The gate cleared, or instruction | That gate |
| PR closed | Instruction | That PR |
| Watch timed out | Keep waiting or not | That wait |
| CI run `waiting` / `action_required` | The human action, or instruction | That run |
| Production write (incl. triggering a deploy job, non-listed smoke writes) | Approval naming the action | That action |
| Rollback | Approve or decline | That rollback |
| Touching the user's dev server or test account | Instruction | That resource |
| Attribution trailer found on the branch | The user rewrites it, or waives the check | This run |
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
