# ship-fix templates

## `.ship-fix/state.md`

Rewrite the whole file at the end of every step, immediately after every
action with side effects, and after every approval received. "Last verified action" is what you confirmed against
the real state (PR state, remote branch, platform deploy), not what you intended.

```markdown
# ship-fix state
task: <one line>
mode: fast | full · agents: yes | no-agent
base: <$BASE> · branch: <fix/slug> · created from: <base commit>
merge strategy: <squash | merge | rebase> · watch timeout: <N>m (minutes; pass to `timeout` with the unit)
current step: <0–8>
next action: <the single next thing to do>
linked run: <.ship-fix/runs/<slug>.md of the run this one fixes, or none>
id baseline: <table: max id, … — recorded before QA, or none>

## Root cause
<one or two sentences>

## Subtasks
| # | Unit | Owner (agent) | Agent branch | Status |
|---|---|---|---|---|
conflict files: <paths the lead touched resolving conflicts, or none>

## Findings ledger
| # | Round | Severity | Finding | Resolution | Status |
|---|---|---|---|---|---|
review verdict (per pass): code <pending|FIX|SHIP> · security <…|n/a> · database <…|n/a> · independent: yes | no

## Fix loops
used: <n> / 4 — <trigger of each>

## QA
result: pending | pass | fail · evidence: <paths> · valid for commit: <sha>

## Delivery
pr: <number/link> · ci: <CI value> for commit <sha>
last gated commit: <head commit shown at the merge gate, or none>
trailer check: active | waived by user at <time>
merge word: <received at commit sha, or none>
base-update commit: <sha after PUT /pulls/<n>/update-branch, or none>
merged: <merge SHA or none>
post-merge ci: overall <CI value>
  <run id> <workflowName> — <raw status/conclusion> — gating: yes | no   (one line per run on the merge SHA)
deploy: <id> — pending | success | failed | not verified | not started | n/a — no deploy
rollback: none | proposed | approved | done

## Production verification
smoke (read-only): pending | pass | fail | not run | n/a — no deploy — <detail>
runtime logs: pending | clean | errors | not run | n/a — no deploy — <detail>
failure mode on prod: pending | pass | fail | not reproducible read-only | not run | n/a — no deploy

## Last verified action
<action> — verified by <command or observation> at <time>

## Approvals received
| Action | Scope | Given at |
|---|---|---|
```

**CI value** (one set for every overall CI status; raw GitHub values go only
in the per-run lines): `pending | green | red | no CI | not verified |
awaiting action | cancelled`. `pending` never appears in a final report; a
report written while CI is still pending uses the verdict "stopped — awaiting
user". **Deploy value:** `pending | success | failed | not verified | not started`.

## Agent prompt (Sonnet / Opus)

For implementation subtasks and, in its **QA variant**, for the Sonnet QA
pass. Fill the angle-bracket fields. Keep the two rule sections word for word
from SKILL.md, with `$BASE` replaced by the real branch name.

QA variant: Goal = "QA pass: <flow>"; "Files you may write" = none (evidence
under `.ship-fix/logs/` only); acceptance criteria = the checks to perform and
the cleanup rule (remove only rows above the id baseline given in the prompt);
**delete the Commands section and the commit sentence of Working rules** —
a QA agent commits nothing.

```markdown
You are working on one subtask of a fix. Work only inside the files listed
under "Files you may write".

## Goal
<what this subtask delivers>

## Root cause
<as stated by the lead>

## Files you may write
<paths>

## Files you must not touch
<paths, including other agents' areas>

## Acceptance criteria
- <observable behaviour, not "code looks right">

## Commands (run all before committing; all must pass)
- typecheck: `<cmd>`
- lint: `<cmd>`
- unit tests: `<cmd>`

## Working rules
- First: `mkdir -p .ship-fix/logs` (the Commit rules below write there).
- Trailer check: <active | waived — skip the trailer check in Commit rules>.
- Write a failing test first where practical.
- You are on branch `<branch>` (worktree: <yes/no>). Commit your own work
  before you finish; an uncommitted worktree is discarded.
- Report back: files changed, your branch name, commands run with results,
  anything you could not do.

## Commit rules
<paste verbatim from SKILL.md, $BASE replaced>

## Hard rules
<paste verbatim from SKILL.md>
```

## Review agent prompt (Opus)

For the code, security and database passes. One pass per agent; the lead
passes the findings ledger every round.

```markdown
You are an independent reviewer. You did not write this change and you will
not change it. Repository: <path>. Review `git diff origin/<$BASE>...HEAD` on branch
<branch>. You may read any file and run: <test/lint/typecheck commands>.

## Reported problem
<as given by the user>
## Root cause stated by the lead
<one or two sentences>
## Findings ledger from earlier rounds
<table, or "none — first round">  Do not reverse a resolved finding without
new evidence.

## Checklist (<code | security | database> pass)
<the pass's checklist>

## Return EXACTLY
VERDICT: SHIP | FIX
FINDINGS:
- [CRITICAL|HIGH|MEDIUM|LOW] <file:line> — <one sentence> — <suggested fix>
(or "- none")
NOTES: <at most three lines>
Severity: CRITICAL/HIGH only for incorrect behaviour or a missing test that
leaves the reported problem uncovered; hypotheticals outside the documented
contract are LOW at most.

## Limits
- Read-only: do not edit, create or delete files; do not commit.
- Do not touch git state: no checkout, switch, stash, reset, rebase, pull.
  Inspect other revisions with `git show <rev>:<path>` only.
- Do not start servers or touch databases or external services.
- Never print secrets, tokens or credentials; replace with `<redacted>`.
```

## Execution agent prompt (Haiku)

For read-only search, test runs, evidence collection, log triage and smoke
checks. The agent runs what it is given and reports; it decides nothing.

```markdown
You run the commands below exactly as written and report the results. You do
not fix, retry, modify commands, or investigate beyond what is listed.

## Task
<one line: what this run is for>

## Commands (run in order)
1. `<cmd>` — expected: <exit 0 / output contains X>
2. `<cmd>` — expected: <...>
A non-zero exit from a listed command is a **result**, not an error: record
it and continue with the next command unless the line says "stop on failure".

## Output format (nothing else)
- For each command: command, exit code, duration, last 50 lines of output.
- Full output of every command saved to `.ship-fix/logs/<task>-<n>.log`;
  report the path.
- For search tasks: one line per hit — `path:line — one-line summary`. No
  file contents beyond the matching line.
- For log triage: the failing job name, the first error line, the last 30
  lines before it, the log path. No interpretation.
- For test runs: one line per suite — `<suite>: <passed>/<total>, exit <code>`,
  plus evidence paths. Run every listed suite even if an earlier one fails
  (the lead says so in the Commands section). The lead copies this into the
  QA entry.

## If anything is unexpected
A command that could not start (missing tool, permission denied), a prompt
for input, a hang past <n> minutes (the lead fills in the watch timeout).
A non-zero exit or output that merely differs from "expected" is a result,
not UNEXPECTED — record it and continue. On UNEXPECTED: stop immediately, save what you have to
the log path, and report "UNEXPECTED: <what you saw>" with the command and
its output. Do not retry, do not try another command, do not guess a fix.

## Limits
- First: `mkdir -p .ship-fix/logs`.
- Read-only. Do not create, edit or delete files outside `.ship-fix/logs/`,
  apart from what the listed commands themselves write (test caches, build
  output); point any trace/screenshot/report output they take as an option
  under `.ship-fix/logs/`.
- Do not touch git state (no checkout, switch, stash, reset, commit),
  running servers, databases or external services beyond what the listed
  commands do.
- Never print secrets, tokens or credentials, even if they appear in output;
  replace them with `<redacted>`.
```

## PR body

No AI attribution footer (e.g. "Generated with Claude Code") — remove it if
the tooling adds one.

```markdown
## Summary
<one or two sentences: what is fixed / added>

## Root cause
<what actually caused it, with file:line where relevant>

## Changes
- <file or unit>: <what changed>

## Review
- Rounds: <n>  ·  Review verdict: SHIP  ·  Independent: yes | **not independent** (lead self-review, no-agent mode)
- Fixed: <CRITICAL/HIGH/MEDIUM findings and how they were resolved>
- Deferred: <LOW / skipped MEDIUM with reason>

## Test evidence
| Suite | Result |
|---|---|
| Unit | <passed>/<total> |
| Integration | <passed>/<total> or n/a |
| E2E | <passed>/<total> or n/a |
| Browser pass | <headed/headless> — <flow> — pass/fail |
| Reported failure mode | <how it was reproduced> — pass/fail |
| CI | <CI value> — `pending` at creation, updated before the merge gate; `red` only when merged over a failed check with the user's named approval |

## Risks
- <what could break, who it affects>

## Test plan
- [ ] <production smoke check 1>
- [ ] <production smoke check 2>
- [ ] <log check>
```

## QA report entry

Always written by the lead to `.ship-fix/qa.md` (untracked).

```markdown
### <date> — <branch>
| # | Severity | Area | Finding | Location |
|---|---|---|---|---|
| 1 | HIGH | <flow> | <what failed, expected vs actual> | path/to/file.ts:42 |

Suites run: unit <x/y>, integration <x/y>, E2E <x/y>, browser <headed|headless>
Evidence: <trace / screenshot paths>
Cleanup: removed ids > <baseline> in <tables>
```

## Final report

Write every label and sentence in the user's language; the English below is
structure only.

```markdown
<One-line verdict: shipped and verified / partial pass / failed / stopped — awaiting user (<at which gate>)>

| Check | Result |
|---|---|
| Review | <n> rounds, SHIP — independent / **not independent** |
| Fix loops used | <n> / 4 |
| Unit / Integration / E2E | <x/y> / <x/y> / <x/y> |
| PR CI | <CI value, never pending> |
| Post-merge CI (merge SHA) | <CI value, never pending> — <n> runs checked, <m> gating |
| Deploy | <success / failed / not verified / not started / n/a — no deploy> |
| Rollback | <none / proposed / approved / done> |
| Production smoke (read-only) | <pass / fail + detail / not run> |
| Runtime logs | <clean / errors found / not run> |
| Reported failure mode on prod | <pass / fail / not reproducible read-only / not run> |

**Still open:** <deferred items, non-gating CI failures, linked post-merge fix run>
**Needs you:** <decisions, approvals, write checks to run, account actions>
```
