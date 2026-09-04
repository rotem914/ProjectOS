# {{PROJECT_NAME}} — Backlog

The owner-curated open-items list. One place to see what is still open.

## How you maintain this file

- **Nothing enters this file on your own initiative.** An item is added only when
  {{OWNER_NAME}} says so. Your own good ideas are not backlog items — offer them
  in chat and let them decide. An assistant-curated backlog fills with noise, and
  a noisy list stops being read.
- Verdict vocabulary on any finding you report: **fix** (do it now), **drop**
  (never mind), **backlog** (add a row here). Only `backlog` writes to this file.
- One row per item: date added · the item in plain words · where it came from.
- Plain words, no jargon. This list is read by the owner, not by you.
- **Scan the Open table at task pickup.** If the current task touches an open
  item, say so in chat before you start.
- When an item is done, **move its row to Done with the closing date**. Never
  delete a row — the record of what was decided is part of the value.
- Full detail stays in the source it came from. This file stays one line per item.
- **Done rotates, Open never does.** `project-os/rotate.ps1` keeps the
  newest 40 Done rows live at `Go commit` and moves older ones verbatim into
  `Backlog-archive.md`. Open is the part read at every pickup and is never
  touched. Nothing is deleted; the row just moves out of the live read.

## Open

| Added | Item | Source |
|---|---|---|
| | | |

## Done

| Added | Closed | Item | Source |
|---|---|---|---|
| | | | |

---

### Example row — delete this

| Added | Item | Source |
|---|---|---|
| YYYY-MM-DD | The export button gives no sign it is working, so on a slow connection people press it three times and get three files. Needs a busy state and a lock while the export runs. | chat |
