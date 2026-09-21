# {{PROJECT_NAME}} — Bug Atlas

The map of this project's recurring bug classes.

`project-os/History.md` records that a bug was fixed. This file records the
PATTERN, so the next session recognizes it in minutes instead of rediscovering
it in hours. Read the matching row before writing a fix.

## When a bug earns a row

Add or update a row when:

- the same bug pattern appears a second time,
- a fix took several attempts because the real root cause was hidden,
- a library or API behaves in a known dangerous way,
- a future session is likely to reach for the same WRONG fix again.

A one-off typo earns nothing. The atlas is for classes, not incidents.

## How to use it

1. Name the symptom you see.
2. Search this table for a matching row.
3. If a row matches, follow its fix and checklist before debugging anew.
4. If nothing matches, debug normally.
5. If the issue turns out to be a pattern, add the row in the same task.

## Rotation

`project-os/Archive-old-rows.ps1` keeps the newest 30 Atlas rows live and moves
older ones verbatim into `BugAtlas-archive.md` at `Go commit`. Rows are
relocated, never edited, renumbered or deleted, so an archived row still
answers a search.

## Atlas

| # | Symptom | Root cause | The fix that holds | Times bitten | Where recorded |
|---|---|---|---|---|---|

> **Example — delete this block once your first real row lands.** It only
> shows the shape.
>
> | # | Symptom | Root cause | The fix that holds | Times bitten | Where recorded |
> |---|---|---|---|---|---|
> | 1 | A style rule ships but the page ignores it | The rule targets an element another component renders, so the scoped selector matches nothing, silently | Reach across the boundary the framework's sanctioned way, then read the COMPUTED style in the browser | 2x | History 05-12, 05-30 |
