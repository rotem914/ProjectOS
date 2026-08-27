# {{PROJECT_NAME}} — Mistakes

The waiting room for the assistant's own mistakes.

A mistake corrected in chat lives as long as the session does, and the next
session repeats it. This file is where a correction waits until it has proven
it needs to become a law.

The mechanism is two steps, and it is the whole file:

1. A slip happens and is corrected. It gets ONE row here.
2. The same slip happens again. It stops being a row and becomes a RULE, in
   the file that owns that behavior. The row moves to Promoted.

## What belongs here

Mistakes in HOW you worked:

- you broke a rule that is already written down,
- you decided something that was the owner's to decide,
- you skipped a step the process requires,
- you assumed instead of asking,
- you reported something as done, or as checked, when it was not.

## What does not

- **A code bug** goes to `project-os/BugAtlas.md`. That file maps bugs in the
  product; this one maps bugs in the way you work.
- **What changed** goes to `project-os/History.md`.
- **A product opinion the owner simply overruled.** Their call, not your
  error. Disagreement is not a mistake.
- **A slip whose rule home is obvious.** Write the rule immediately, in its
  own file, and skip the waiting room. This file is for slips with no clear
  home yet, or where it is not yet clear a law is warranted.

## How you use it

- **Write the row in the same reply where the correction landed**, before the
  work continues. A mistake recorded later is a mistake recorded never.
- **Read this file at task pickup.** It stays short on purpose, so there is no
  excuse to skip it.
- **On a repeat, promote it.** Write the rule into the file that owns the
  behavior, then move the row to Promoted with that file named:

| The slip is about | Its rule goes to |
|---|---|
| How you write replies | `project-os/Conversations.md` |
| A step of the process | `project-os/Workflow.md` |
| What counts as checked | `project-os/QA.md` |
| Deciding, scope, permission | `CLAUDE.md` working rules |
| A review's severity or blind spot | `project-os/Code_review.md` |
| Using an outside tool | that server's file under `project-os/mcp/` |

- **Never let it grow into a diary.** It has exactly two ways out: promoted to
  a rule, or retired unrepeated. Nothing accumulates.
- **It is not a confession log and carries no apology.** One line of fact,
  because the next session needs the fact and not the feeling.

## Open

| Date | What I did | What was wanted | Home if it repeats | Times |
|---|---|---|---|---|

## Promoted

| Date | The slip | Where its rule now lives |
|---|---|---|

## Retired

| Date | The slip | Why it left |
|---|---|---|

---

### Example rows — delete this block

| Date | What I did | What was wanted | Home if it repeats | Times |
|---|---|---|---|---|
| YYYY-MM-DD | Set the commit policy by copying another project's habit | To be asked, since it was never decided here | `CLAUDE.md` working rules | 1 |
