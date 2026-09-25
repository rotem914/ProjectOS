# {{PROJECT_NAME}} — History

The change log. Every completed change lands here, in two layers: a scan table
you always read, and an appendix you read only when digging.

The scan table answers "what happened lately". The appendix answers "what exactly
did that change do, and how do I undo it".

## How you maintain this file

- **After every completed change**, add one scan row AND one appendix row. Both,
  in the same change that did the work.
- **One change = one row.** Not one row per file, not one row per session. A log
  that has to be reassembled from fragments is a log nobody reads.
- Write the scan row for a reader who was not there. Name the behavior that
  changed, not the files.
- Keep appendix rows short — a few lines, not an essay. The full story is in the
  commit diff; a real decision belongs in `project-os/Decisions.md`.
- Record the commit SHA from **before** the change. That is the rollback target.
  Before the project's first commit there is no SHA yet. Write `none yet`
  there instead, and make Rollback say how to undo the change by hand: what to
  delete, or what to put back and from which backup.
- Never rewrite or delete a past row. Correct a wrong one by adding a new row —
  an edited log cannot be trusted about anything.
- A `medium` or `high` risk row names its review result under **What was
  checked**: findings found, findings fixed, pre-existing ones flagged. A
  medium-or-higher row without that is a task that is not finished.
- Never write "tested" or "QA passed". Those phrases record nothing. Name the
  input, the screen, and what happened.
- When this file gets long, move the oldest rows into an archive file beside it.
  `project-os/Archive-old-rows.ps1` does exactly that at `Go commit`, and creates
  the archive the first time it is needed. Rows move **verbatim** — never
  rewritten, never summarized, never merged, because the detail you drop is the
  one the next reader needed. Never hand-move rows: the script dedups, so it is
  safe to run every time, and a hand-move breaks that guarantee.

## Risk scale

The scale's one home is `project-os/Workflow.md` step 2 — read it there, so the
two files can never disagree. State the level at task pickup; the owner's
override wins.

## Scan log

Newest at the bottom.

| Date | Area | What changed |
|---|---|---|
| | | |

## Appendix — deep rows

Newest at the bottom, same as the scan log.

| Date | Task | What changed | What was checked | Result | Risk | Commit before | Rollback |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

---

### Example rows — delete these

Scan:

| Date | Area | What changed |
|---|---|---|
| YYYY-MM-DD | auth | **Signing in with the wrong password now says so.** It used to fail silently and leave the form looking untouched, so the same wrong password got typed three times. The message appears under the field and clears on the next keystroke. |

Appendix:

| Date | Task | What changed | What was checked | Result | Risk | Commit before | Rollback |
|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | Show a failed-login error | `login.ts` returns the failure reason; the form renders it under the password field and clears it on input. No change to what the server logs. | Wrong password → message shown, no console error. Right password → still signs in. Empty password → field-required message, request not sent. Reloaded, retried: no stale message. Review: 2 findings, both fixed (the message survived a route change; the error was announced twice to screen readers). 1 pre-existing flagged: rate limiting is still per-process. | Pass | medium | `a1b2c3d` | `git revert` the commit; nothing persisted, no migration to undo. |
