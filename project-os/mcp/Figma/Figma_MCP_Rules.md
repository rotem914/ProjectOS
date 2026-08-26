# Figma MCP — Working Rules

Read this before any Figma MCP work: pushing designs into Figma, reading designs
out, or any `use_figma` / `get_design_context` / asset call.

Every rule here was paid for with a real failed call. The traps are silent by
nature: a green tool result with the wrong file state, so the rules matter more
than they look.

## 0. Setup facts

> **Setup step — fill this table, then delete this block.** Ask the owner for
> the file link and the plan; everything else follows from it.

| Fact | Value |
|---|---|
| Figma file | `{{FIGMA_FILE_KEY}}` ({{FIGMA_FILE_NAME}}) |
| Target page for generated work | {{FIGMA_TARGET_PAGE}} |
| Plan and daily MCP call budget | e.g. Pro: 200 calls/day, 10/min |

Push generated pages onto the one target page; never scatter them across the
file.

## 1. The call budget is rule #1

- Writes count against the budget, and so do reads (`get_metadata`,
  `get_screenshot`, `get_design_context`, `get_variable_defs`).
  Know the plan's number before the first call.
- The working shape: capture with FREE tools (browser, file reads, grep),
  build in ONE `use_figma` call, verify by the owner's eye in Figma.
  Do not spend a metered screenshot on verification unless the owner OKs it.
- Iterate by fixing, not re-reading. A page done right is 1 to 2 calls.

## 2. Capture: from the real thing, never from memory

- Read the live app's DOM, the real asset, the real file with free tools before
  building. Never guess geometry, colors, or text.
- Colors stored as `lab()` / `oklab()` must be resolved to sRGB first
  (a `<canvas>` does it). Figma cannot use lab strings.
- Capture what does not show in markup explicitly: input and textarea values,
  checkbox states, placeholder text in its real muted color.
- Never mutate project data to stage a capture (ticking a checkbox can
  autosave). Capture as-is, or toggle and restore.

## 3. Build (`use_figma`)

- **The `code` argument is hard-capped at 50 000 characters, with no way
  around it.** Plugin-data stashing across calls is unsupported and Figma
  cannot fetch `localhost`, so the content must fit in one call or be split by
  design.
- Absolute positioning (`layoutMode = 'NONE'`) is pixel-faithful and reliable
  to build blind.
- **Never hard-code a new frame's `x`.** Compute it from the page's CURRENT
  children (max right edge plus a margin), or the new frame lands on top of an
  existing one and the owner sees nothing.
- Text: single lines get auto-width (`textAutoResize = 'WIDTH_AND_HEIGHT'`) so
  a substitute font cannot wrap them; multi-line gets fixed width plus
  `textAutoResize = 'HEIGHT'`.
- **Name every layer semantically at build time.** A hand-written builder that
  skips `.name` ships a file full of "Frame", useless for any round-trip.
- **Mirror the capture's parent-to-child nesting at every level.** Hand-emitted
  flat sequences of positioned nodes recur as flattening bugs (a field's text
  beside the field instead of inside it). Recurse the captured tree and
  substitute only per-instance values.
- For repetitive layouts, write a small builder from fixed geometry plus tiny
  per-item data instead of replaying raw capture; inlining big repetitive JSON
  by hand drops rows and unbalances braces.
- **Verify the builder offline before the metered call, and verify STRUCTURE,
  not only positions.** A position-only check passes flattened output; assert
  each leaf's parent chain against the capture too.
- Pre-flight every `code` string locally: compile it as an async function body
  and count brace balance. A dropped brace is caught free.
- Sanitize captured text: encoding mojibake (an em dash arriving as `â€”`)
  renders verbatim in Figma.
- `use_figma` returns no value. To read data back,
  `throw new Error(JSON.stringify(...))`, but ONLY from a call that made no
  mutations; otherwise split into a check call and an act call.

## 4. Fonts

- **Account-uploaded fonts are loadable by the MCP on any plan** (Figma:
  Settings, Account, Your uploaded fonts). The server sees only the Google
  Fonts catalogue plus those uploads, never locally-installed fonts.
- Resolve exact names via `listAvailableFontsAsync`, never guess style
  spellings. A build script should THROW when a required upload is not visible
  yet (propagation can lag minutes), never silently substitute.
- Do not upload OS system fonts whose license forbids it (Segoe UI); keep a
  lookalike substitute for those.
- Record every substitution. On the way back to code, map values to the
  project's tokens, never literal hex or the substitute font's name.

## 5. Round-trip (Figma to code): the diff must be structural

- A value-only diff is BLIND to deleted, added, or moved layers; it flags a
  value that changed, never a layer that vanished. Compare the layer TREE
  against a saved baseline: presence, count, order, position.
- Code is the source of truth. State the change list first (added, removed,
  changed, and which code target each maps to), then edit and verify per the
  project's own QA.

## 6. SVG artwork as editable vectors

- `figma.createNodeFromSvg(svgString)` is the whole mechanism. It returns a
  frame: name it, `appendChild` it, THEN set `x` / `y`.
- Shrink to fit the 50 000-char cap without touching design code:
  strip SVG filters (Figma renders none of them), round coordinates to whole
  pixels, decimate sampled polylines only (paths with no curves).
  Verify the shrink offline: identical element counts, endpoints preserved.
- `return svg.length` from the build call and compare it with the file on
  disk: a free transfer-integrity check inside the same metered call.
- Group opacity travels: a `<g opacity="0.14">` arrives as a Figma group at
  14%, one slider for the owner instead of a baked-in wash.

## 7. Pages and images: the silent traps

- **`figma.currentPage` resets to the FIRST page on every call.** Resolve the
  page and `await figma.setCurrentPageAsync(pg)` before any id lookup, or every
  id on another page resolves `null`. An unloaded page also reports 0 children;
  never read that as "the page is empty".
- **`figma.getImageByHash()` is not a validity test.** It returns `null` for an
  image that IS in the file but unreferenced by a loaded node; gating a fill on
  it silently drops the picture. Set the `imageHash` unconditionally; it
  resolves at render time.
- **`upload_assets` with a nested `nodeId` is destructive.** Aimed inside a
  built page it can dissolve container frames and delete subtrees while
  returning success. Call it with NO `nodeId`: it drops one throwaway node at
  top level and returns `imageHash` plus `placedOnNodeId`; set the hash as a
  fill in one `use_figma` and remove the throwaway (guard: parent is a PAGE,
  id equals `placedOnNodeId`).
- Prefer PNG uploads. A WebP can upload with `success: true` and then render
  nothing as a fill.
- **Verify by re-reading the tree, not the return value.** A mangled build can
  return a healthy-looking object; after any image step, re-read the root's
  children names and compare against what the builder created.

---

*Keep this current: when a new gotcha or fix is learned here, add the rule in
place, the same bitten-twice pattern as the rest of the kit. A different MCP
server earns its own folder under `project-os/mcp/` the first time it bites.*
