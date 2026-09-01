# {{PROJECT_NAME}} — Map

The architecture snapshot: the stack in a line, the folder tree, where the data
lives, what owns what.

Read it at task pickup to find your way around. Keep it true, because a map that
lies costs more than no map.

## How you maintain this file

- **Replace the skeleton tree below with the real one during setup.** Walk the
  project root, then write what is actually there. Until you do, this file
  describes a project that does not exist.
- **Update it in the same change** that adds, moves or removes a folder, a route,
  a data store, or a major file. Never as a follow-up task — a follow-up is a
  task that does not happen.
- One line per entry: what it is, not how it works. The how lives in the code.
- Paths are relative to the repository root.
- This is a snapshot, not a plan. Nothing here describes work that has not landed.

## Stack

{{STACK}}

| Setting | Value |
|---|---|
| Project root | this repository, wherever this copy of it lives |
| Runs locally at | `{{DEV_URL}}` |
| Checks | `{{CHECK_COMMAND}}` |

## Tree

Skeleton — replace with the real tree.

```text
{{PROJECT_NAME}}/
├── CLAUDE.md              # entry file, read first
├── project-os/            # the process docs
├── src/                   # application code
│   ├── ...
│   └── ...
├── tests/
├── public/                # static files served as-is
└── ...
```

## Data

Where state lives and who is allowed to write it.

| What | Where | Format | Written by |
|---|---|---|---|
| | | | |

## Ownership

Which area owns which files. Use this to answer "who owns this?" before changing
anything.

| Area | Files | Notes |
|---|---|---|
| | | |

---

### Example rows — delete these

Data:

| What | Where | Format | Written by |
|---|---|---|---|
| User accounts | `db/users` table | Postgres | `src/server/users.ts` only — no other module writes it |

Ownership:

| Area | Files | Notes |
|---|---|---|
| Auth | `src/server/auth/*`, `src/pages/login` | Session cookie is set in one place, `auth/session.ts`. Do not set it elsewhere. |
