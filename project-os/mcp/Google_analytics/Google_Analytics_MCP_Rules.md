# Google Analytics MCP — Setup & Working Rules

The official Google Analytics MCP server
([googleanalytics/google-analytics-mcp](https://github.com/googleanalytics/google-analytics-mcp),
PyPI package `analytics-mcp`), wired in so the assistant reads GA4 reports
directly instead of the owner exporting screenshots by hand.

**Read this before any GA MCP work.** Companion folder:
[`../Figma/Figma_MCP_Rules.md`](../Figma/Figma_MCP_Rules.md).

## 0. Setup facts

> **Setup step — fill this table during install, then delete this block.**
> Until the wiring exists, leave the honest state ("not wired yet") and flag it.

| Fact | Value |
|---|---|
| Cloud project | `{{GCP_PROJECT_ID}}` |
| Service account | `{{SERVICE_ACCOUNT_EMAIL}}` (GA role: Viewer on the property) |
| Key file | an absolute path OUTSIDE the repo; named only in the untracked `.mcp.json` |
| GA4 property | `{{GA4_PROPERTY_ID}}` |

**An analytics request with no server connected is the START of the setup,
never the end of the task.** Do not answer that there is no analytics and
stop. Do sections 1 and 2 below as far as you can from here (the venv, the
`.mcp.json.example`, the exact grant the owner has to make), ask for the
owner's part in one message, say a restart is needed, verify with one small
read, and then answer the question that was asked.

## 1. Install shape

- **Server**: `analytics-mcp` (Python), installed into a project-local virtual
  environment at `project-os/mcp/Google_analytics/.venv/`. Self-contained: nothing
  system-wide, no `pipx` or `uv` needed.
- **Registration**: `.mcp.json` at the repo root, server name
  `google-analytics`, pointing at the absolute path of the venv launcher, so
  the server starts with the assistant in this project only.
- **Not in git, for two different reasons.** `.venv/` is gitignored because it
  is ~100 MB of regenerable dependencies (rebuild recipe in §4). `.mcp.json` is
  gitignored because it names the key file's location on disk; commit
  `.mcp.json.example` with placeholders instead, and a fresh clone copies it
  and fills its two paths.

## 2. Authorization

Prefer a **service-account key** over the gcloud CLI: nothing installed
system-wide, and no login that expires.

1. In the Cloud project, create a service account and one JSON key.
2. Grant that account **Viewer** on the GA4 property
   (GA: Admin, Property access management).
3. Keep the key file at a path OUTSIDE the repo.
4. `.mcp.json` carries only the PATH, never the key:

```json
"env": {
  "GOOGLE_APPLICATION_CREDENTIALS": "<absolute path to the key file, outside the repo>"
}
```

- **Enable BOTH APIs in the Cloud project, Admin and Data.** They are separate
  APIs, and enabling only one is the most common setup failure.
- The server itself reads no environment variables; it calls
  `google.auth.default()`, and Google's auth library is what reads
  `GOOGLE_APPLICATION_CREDENTIALS`.
- **Rotation is cheap.** If the key leaks or ages out: new JSON key on the same
  service account, drop it at the outside-the-repo path, update the one line,
  restart the assistant. The GA-side grant is on the account, not the key, so
  it survives untouched.
- A synced folder (Dropbox and the like) is acceptable for a READ-ONLY viewer
  key; it would not be for a write-capable one.
- Never commit the key file. The rule is: keys live outside the project root.

Alternative, kept for reference: `gcloud auth application-default login` with
the analytics readonly scope, signed in as the account that owns the property.
The trade-off is a system-wide CLI install plus a login that can expire.

## 3. Rules for the assistant

1. **Never guess numbers.** Every analytics figure in a reply comes from a tool
   call, quoting the property and date range used. No estimating, no rounding
   a number you did not fetch.
2. **State the property.** An account can hold several GA4 properties; say
   which one a report came from.
3. **Read-only stays read-only.** Do not propose or run anything that changes
   GA settings; if a change is needed, describe it for the owner to do in the
   GA UI.
4. **Sampling and thresholds are real.** GA4 can withhold or sample rows; if a
   response carries a sampling or data-threshold flag, say so instead of
   presenting the number as exact.
5. **No analytics data in committed files** without the owner asking; reports
   go in chat, or in the project's notes folder if the owner wants them kept.
6. Report METHOD rules (what a standing report contains, which visitors are
   excluded, how visit length is counted) are project decisions; when they
   accumulate, give them their own file under `project-os/` and point at it
   from here.

## 4. Rebuilding the venv (after a restore, or if it breaks)

```shell
python -m venv "<project root>/project-os/mcp/Google_analytics/.venv"
"<project root>/project-os/mcp/Google_analytics/.venv/Scripts/python" -m pip install analytics-mcp
```

Credentials are never restored from here: the key file lives outside the repo
by design. `.mcp.json` is gitignored, so a fresh clone copies
`.mcp.json.example` and fills in its two paths: the venv launcher and the key
file.
