# Installation: the complete install law

This file is the whole procedure for installing ProjectOS into a project.
The assistant reads it and follows it exactly, every step, in order.
The owner does two things only: answers one batch of questions, and reads one
report at the end.

The install is not done until the report in the last section has been
delivered.

## 0. Bring the kit in, when only the link was given

The owner's usual install is the kit's link and the word install, with nothing
copied yet. Run this step only when `CLAUDE.md` (or `CLAUDE-kit.md`),
`Installation.md` or `project-os/` is missing from the project root; when all
three are there, go straight to step 1. It only adds files, so it comes before
the reading step.

1. Fetch the kit into the project's scratch folder, and nowhere else:

   ```
   git clone --depth 1 https://github.com/rotem914/ProjectOS .tmp/projectos-kit
   ```

   Note its commit for step 7 and the report:
   `git -C .tmp/projectos-kit rev-parse --short HEAD`. Without git, download
   `https://github.com/rotem914/ProjectOS/archive/refs/heads/main.zip` into
   `.tmp/`, unpack it into `.tmp/projectos-kit`, copy from the one folder
   inside it, and write the commit as unknown.
   The install needs only the newest files, so this clone is shallow. The
   update path is different: `Go update kit` (CLAUDE.md) compares against the
   kit as it was at the commit a project came from, which needs the kit's full
   history, so that shortcut clones without `--depth`.
2. Copy from the fetch to the project root, never over an existing file:
   - When there is no `project-os/` yet: exactly three items, `CLAUDE.md` (as
     `CLAUDE-kit.md` when the project already has a `CLAUDE.md`),
     `Installation.md` and `project-os/`.
   - When `project-os/` exists, the project was installed before (step 2b):
     only `Installation.md`, if it is missing. Nothing goes into that folder
     and no `CLAUDE-kit.md` is made: its records and its merged `CLAUDE.md`
     are not the kit's to replace.

   Never copy the kit's `README.md`, `LICENSE`, `.gitignore`, `.gitattributes`,
   `tests/`, `hooks/` or `.claude-plugin/`. They belong to the kit repository, and the
   last two together make the plugin take this project for the kit itself:
   its guards would still run here, but its reminders would stay off.
3. Run the fetch's fast suite once, from the project root:

   ```
   node .tmp/projectos-kit/tests/Plugin-and-installer-tests.mjs
   ```

   From a ZIP, the path starts at the one folder inside it. It takes seconds
   and proves the hook scripts run on this machine's Node.
   Its scratch projects go to the system's temp folder and are removed when it
   ends. Note its last line for the install row (step 7). A failure never
   stops the install: it is one Problems line in the report, naming the
   failing cases.
4. Delete the fetch, and the ZIP if there was one:

   ```
   rm -rf .tmp/projectos-kit
   ```

   In PowerShell, `Remove-Item -Recurse -Force .tmp/projectos-kit`. The guards
   let a delete under `.tmp/` through as disposable.
5. Never clone into the project root, and never outside `.tmp/`. A clone at the
   root makes the public kit repository this project's history and push
   address, so the owner's first push could send their work there. A clone
   outside the project is refused by the folder guard.

## 1. Read everything first

Read CLAUDE.md and every markdown file in project-os/, its mcp/ subfolder
included, in full, before changing anything. A step below will tell you to
adapt files; you cannot adapt what you have not read.

Three exceptions, because reading is the biggest bill of the install and these
files are never adapted by hand:

- **The scripts are read by their header only.** `Archive-old-rows.mjs` and
  `Backup-whole-project.mjs` with their PowerShell twins (`.ps1`),
  `Find-heavy-files.mjs`, `Audit-project-records.mjs`, `Compare-kit-files.mjs`,
  `Install-project-hooks.mjs`, the two files under `project-os/guards/`
  and `hooks/dispatch.mjs` at the kit root (part of the plugin, never copied
  into a project) open with a
  comment that says what they do and how they are wired; read that and stop.
  Their internals are not the install's business, and together they are most
  of the folder by size.
- **`project-os/Rule-reasons.md` is not read.** It holds why the rules exist,
  and is opened only when a rule is questioned or changed; nothing in it is
  adapted at install beyond step 5's placeholders.
- **A tool file is read through its setup section only.** Each rules file
  under `project-os/mcp/` is read now down to the end of its section 0, the
  setup facts; the rest is read before that server's first call, as CLAUDE.md
  says. Nothing is deleted at this step: whether a tool folder stays is asked
  in step 4, and a folder leaves only in step 5, on the owner's answer.

## 2. Merge with an existing CLAUDE.md

If the kit's entry file came in as CLAUDE-kit.md beside an existing CLAUDE.md,
fold it into the existing file, then delete CLAUDE-kit.md. The one exception
is a project installed before (step 2b tells): its CLAUDE.md already carries
the kit's rules, so a CLAUDE-kit.md there is not merged. Leave it beside
CLAUDE.md and name it in Waiting on you: folding a newer kit into an installed
project is the `Go update kit` shortcut (CLAUDE.md), not the install, and that
shortcut fetches its own copy of the kit, so this one goes on the owner's word.

The merge law:

- The EXISTING rules win every clash, without exception, during the install.
  This is the client's production repo; an existing rule may encode a
  constraint you cannot see from outside.
- Nothing of the existing file is deleted or reworded on your own initiative.
- Every clash you find is recorded for the report (section 8), never resolved
  silently in either direction.
- An override happens only after the owner's explicit verdict on that clash,
  as its own change, never as part of the install.
- The kit's Working rules stay one block, with the numbers they ship with.
  Never renumber, drop or interleave them: the files in `project-os/` and the
  folder guard point to them by number. If the existing file numbers its own
  rules too, put the kit's block under its own heading, "ProjectOS working
  rules". A kit rule that loses a clash stays in place, marked as held for the
  owner's verdict, so the numbers after it do not shift.

**The assistant's own global instructions are not project rules.** A personal
instruction file the owner keeps for every project (a house style, a preferred
diagram format, a tone) is not the existing CLAUDE.md above, and a clash with
it is not a question. Inside this project the kit's rules win, because the
project's rules are the more specific ones and that is how the assistant
resolves the two anyway. Say it in the report as one line under What was set
("your global preference for X does not apply inside this project"), never as
something the owner has to rule on: a regular owner has no way to answer that
question, and it should not be asked.

## 2b. Checks before you go further

Each one catches a failure that is invisible afterwards.

**Was the kit cloned in place?** Check where this folder's history points:

```
git remote -v
```

If it names `rotem914/ProjectOS`, STOP. The kit repository itself was cloned
into this folder, so its history and its push address are the public kit's,
and a first push would send the owner's work there. Make that the report's
first line, change nothing else, and wait for the owner's word. Never push,
and never delete or re-point `.git` on your own.

**Did copying the kit overwrite an existing rules file?** The merge law above
only works if the project's own CLAUDE.md still exists. If the files were
dragged in rather than renamed, it was replaced on disk before you ever ran,
and there is nothing left to clash with. Check the history:

```
git log --oneline -3 -- CLAUDE.md
```

Run this one before step 2's merge: a merged file holds the kit's
placeholders too, until step 5 replaces them, and that is not an overwrite.
If that shows earlier versions and the file now holds this kit's placeholders,
STOP. Recover the previous one with `git show HEAD:CLAUDE.md`, keep the kit's
beside it as CLAUDE-kit.md, and only then merge (on a project installed
before, step 2's exception applies and it is not merged). In a project with no
version history, say plainly in the report that the merge could not be
verified.

**Was this project installed before?** Look at the two files a copy of the kit
must never replace, and at their history:

```
git log --oneline -3 -- project-os/History.md project-os/Decisions.md
```

- Both open with the kit's `{{PROJECT_NAME}}` heading, and so does any copy
  the history shows: a first install. Go on.
- They open with this project's own name: installed before, and this run is a
  re-run (below).
- One opens with `{{PROJECT_NAME}}` now, while its copy in the last commit
  (`git show HEAD:project-os/History.md`, the same for Decisions) opens with
  this project's name: the kit was copied over an installed project and
  replaced its records with empty templates. STOP. Every file under
  `project-os/` that carries a `{{` placeholder and exists in the last commit
  was replaced: put each back with `git show HEAD:<file>`. Never touch a file with no placeholder, since it may
  hold the owner's own uncommitted edits. List in the report which files came
  back, that rows written after the last commit went with the overwrite, and,
  as one Waiting-on-you item, any other file there that now differs from the
  last commit (`git diff --stat -- project-os/`): keep the kit's copy or put
  the project's back. Then carry on as a re-run.

In a project with no version history, only the first two can be told apart;
say so in the report.

**A re-run** is the install run again on a project that already has it. Every
step still runs, and a step that finds its work done says so and moves on:
nothing already filled is asked again, except the reply language, which step 4
always asks with the project's current one offered first; nothing is copied
over; and the History rows go at the bottom (step 7). Bringing an
installed project up to a newer kit is not a re-run: it is the
`Go update kit` shortcut in CLAUDE.md. Say so in the report in one line,
adding the kit's link when this project's CLAUDE.md does not carry that
shortcut yet, and never improvise it by copying the new kit over the old.

**What does your own memory already say about this project?** Rule 12 keeps
rules out of the assistant's private memory, and that folder is invisible to
the owner, so this is the only moment anyone will look. Sort every note there
that concerns this project into three piles, and decide two of them yourself:

- **A note that is really a rule** moves into the right file here, now, with
  no question. The project is the law book; say in What was set how many moved
  and where.
- **A note about another project** is not this install's business. Leave it
  and say nothing.
- **A note that looks stale for this project** is the only pile the owner
  sees, and they see it as ONE question, never one per note: the list, one
  line each, your keep-or-trim recommendation beside each, and a single ask,
  "trim the ones I marked?". Deleting is on the owner's word, never yours.

On a real install this step produced three separate questions about the
assistant's own notes, which the owner had no way to judge one by one.

**Is Node available?** Everything that enforces the rules runs through it: the
hooks themselves and their installer. So do the upkeep scripts (the archive
at `Go commit`, the backup, the audit and the kit update), and the separate
Chrome step 6d registers for browser checks, which needs Node 20.19 or newer
(22.12 or newer on the 22 line), so note the version. Check:

```
node --version
```

No Node means the enforcement layer cannot run, whatever this project is
written in. That is a Problems line in the report, and the owner needs to know
the rules are documents only until it is installed, and that until then the
growing files are archived and `Go backup` runs only through the PowerShell
twins, where PowerShell exists.

**Is this folder a git repository yet?** A brand-new project can be a blank
folder with nothing in it but the kit. Check:

```
git rev-parse --is-inside-work-tree
```

If it is not one, the install still runs in full: no code means step 3's
"nothing exists to run yet", and no git means only that the version history
starts at the owner's first `Go commit`, which creates it in this folder
(CLAUDE.md, `Go commit`). The install itself creates nothing: no repository,
and no connection to GitHub or anywhere else. Say it in the report as ONE item
under What was set, never under Waiting on you, one sentence per line:
"No version history yet."
"Your first Go commit starts it in this folder."
"Putting it on GitHub is yours, whenever you want a copy off this computer."
"Publish this folder there, not into a new repository that already has files."
Write `Go commit` in
the report's "What to say" section exactly as on any other install: it works
as written. Every check above that reads git history (the CLAUDE.md one, the
clone one and the installed-before one) says "no history yet" instead of
failing.

## 3. Learn the repo before asking

Work out from the repo itself everything you can: the project name, the stack
(framework, data store, host), the command that runs the app locally and the
URL it serves on, and the command that builds, typechecks, and tests.

Read package manifests, config files, lockfiles, CI config and existing docs.
Do not guess where you can check. Run the check command once on the untouched
project.

**Never install dependencies to make that check runnable.** A check command in
a repo whose packages are not installed needs an install first, and that is a
change to the owner's machine they did not ask for: it can take minutes, it can
take gigabytes, and on one real install it took the last of the disk and the
hook install died on it. If the check cannot run without an install, do not
run it. Record the check as "not run: dependencies are not installed", put the
install command in pile two of step 4 for the owner to approve, and when they
do, check free space before running it. A one-shot check that needs nothing
installed, or whose packages are already there, runs as written.

Pass and fail are not the only outcomes:

- **It passes.** It becomes the standing check.
- **It fails.** That is a Problems line and a question for the owner, never the
  standing check.
- **Nothing exists to run yet.** A project with a plan and no code has no check
  command and no dev address. Do not invent one and do not leave the row empty:
  write the FUTURE command the plan will create, name the plan step that creates
  it, and mark every table that carries it "nothing to run before that step",
  the check in CLAUDE.md's Go commit step 4 included, so a commit before that
  step runs nothing instead of failing.
  The report's Problems section says so in one fixed line: "No check exists yet;
  it arrives at step N of the plan." The same shape applies to the dev address.
  With no plan either, write "none yet" wherever the command or the dev address
  goes, do not ask the owner for one, and the Problems line reads: "No check
  exists yet; there is no code." The change that first creates a check command
  or a dev address writes it into CLAUDE.md's "Where things are" table, and
  into every other file that still carries the old value (search for it).
- **It was refused, so it never ran.** A permission system can deny an unfamiliar
  build command, and a session with nobody to approve it gets no answer at all.
  Say REFUSED, name the command, and put it in Waiting-on-you. A command that
  never ran is not a command that passed, and recording it as the standing check
  means every future task believes a check is running when none is.

## 4. Ask once

Ask only what the repo cannot tell you, in one sitting, before any setup work.
That is one panel, or several panels back to back with nothing done in between.
The reply language is the one exception: it is always asked (see below).
An install repeated in the same conversation, after a wiped folder or a false
start, is a first install by the files but not by the owner: every answer
already given in this conversation stands, and only what is still open is
asked. The language is still asked, but in pile one, as the answer already
given, where silence means yes: a panel opened for that one question is a
chore.

**Real questions go in the question panel, when the client has one.** Claude
Code and its desktop app offer a built-in question panel, a form with the
questions as tabs and the options as rows, and the owner has asked for it in
so many words: it is far easier than reading options out of the feed. Every
pile-two question below goes through it, one tab per question, the options as
rows with one line each on what they mean, and a free-text way out. Pile one
never goes in it: those are statements to be waved through, not choices. In a
client with no such panel, the feed carries both piles as written below.

The panel holds a limited number of questions: today at most four per panel,
each with two to four options. A longer pile two goes in panels sent one after
another, the questions that block the install first. Never drop a question or
postpone it to make it fit. The invariants go as multi-select tick lists, at
most four candidates per tab, so six take two tabs. The question text says
that a box left unticked is a no.

**Send it as TWO piles, and label them.** A batch of nine questions reads as
nine decisions when half of them are things you already worked out and only
need waved through. Separating them halves what the owner has to think about.

**Pile one: confirm, and silence means yes.** Everything you derived and are
confident in. State each as a fact with its source, not as a question. The
owner reads them, and answers only the ones you got wrong.
Typically: their name from the version history (with no history yet, from
git's configured user name; with neither, it moves to pile two), the command
that runs the app and the address it serves on, the command that checks the
project, which also gates every `Go commit` (all of them, in a workspace),
and, if a build plan sits loose in the repo, that it moves to
`project-os/Plan.md` (CLAUDE.md rule 13).

**Pile two: needs a real answer, and the install waits.** Only what genuinely
cannot be derived, and what would be wrong to guess. Number these.
Typically: their role on this project, the language replies are written in
(always asked, see below), who starts the dev server and where it runs
(CLAUDE.md rule 16 has four honest answers and is rewritten from this one),
whether this project uses each tool folder under `project-os/mcp/` (see
below), and anything step 3 came up empty on, except the "none yet" rows of a
folder with no code and no plan, which are never asked.

Say which pile blocks the install and which does not, in one line, so nobody
answers eight things to unblock one.

**This batch, like the closing report, is exempt from the reply-length
ceiling.** It must be complete, since a question left out is a setup block
filled by a guess. Every layout rule still applies. The same exemption is
written into Conversations.md rule 1, so the two files agree.

**Reply length is not a question.** The limits in Conversations.md rule 1 are
law and ship as written; never ask how long replies should be, never show two
sample answers, never turn an answer into numbers. An owner who wants a
different limit edits that rule later, with the file in front of them.

**These questions have a shape that matters:**

**The reply language. Always ask it, never work it out.** The language the
owner writes in is not always the one they want to read: an owner can type in
one language and want every answer in another. So it is a pile-two question on
every install, with its own tab in the panel, even when the whole conversation
so far has been in one language. The one exception is an install repeated in
the same conversation, where it goes in pile one (above). Offer the language they have been writing in
and one other likely one (English, or the language the project's own content is
in). When the project's existing rules already name a reply language, offer
that one first and mark it as recommended; it outranks the global instructions
(step 2). If the owner picks a different one, the existing rule still wins for
the install: write the existing language into the Language block, and list the
owner's pick under Clashes, with a keep-or-override recommendation, for their
verdict later. Only when no project rule names one and their global
instructions do, put that one first and mark it as recommended. In every
other case, the owner's answer fills the Language block in
project-os/Conversations.md.

**The project invariants.** Do not leave that section empty and move on. Read
the code, propose the three to six things this project cannot afford to break,
and ask for a yes or no on each. Nothing is faster than judging a real list.
With no code, read the plan instead and propose from it. With no code and no
plan there is nothing to read: propose none, ask nothing, leave the section as
it ships, and put one Waiting-on-you line, that the invariants are proposed at
the first change that adds code, the same shape as the check command's "none
yet".
Write every one as its CONSEQUENCE, in the owner's language: whose data could
be exposed, what a customer would see, what would be lost. A candidate written
as a technical noun cannot be judged by the person who has to approve it, so
the yes it gets back is worthless.

**The worst-class lines.** In the same batch, propose one sentence for each
worst-class line (`project-os/Code_review.md` and `project-os/Visual_QA.md`),
written as its consequence, which is often the first invariant, and ask a yes
or no on each. One tick-list tab holds both. With no code and no plan, the
same as the invariants: propose none, ask nothing, and the one Waiting-on-you
line covers both.

**The tool folders.** One question per folder under `project-os/mcp/`, with
two options: keep it, and its setup is asked at the first request that needs
that server; or not used here, remove the folder. A code repo rarely shows
whether a design file or an analytics account is used, so this is never
worked out and never put in pile one. It does not block the install: no
answer keeps the folder, with "not wired yet" in its setup table (step 5).

Every other marked setup block in the kit is a question waiting to be asked.
Walk them ALL before asking anything, and fold each one into the right pile. A
setup block reached in step 6 with no answer means step 4 was written short.

**The hooks are not a question.** They are installed for you in step 6b, on
their default, and the report says so in one line. Never ask the owner to
choose where they go.

**Committing asks one thing: the branch.** `Go commit` runs the project's
check command from pile one (every one of them, in a workspace). Pile two asks
one question about it: commit straight to the current branch, or give each task
its own branch. The answer fills the bracket in CLAUDE.md's Go commit step 6.
Rule 22 settles the rest: the assistant commits, only on the owner's
`Go commit`, and the owner pushes; in a cloud session the assistant pushes
the session's own branch, never main, and the owner merges it. Neither is a
question. Never ask which checks gate a commit, or
what is never staged. If the
owner says they prefer to commit themselves, that is a clash for the report,
not a line written into the flow.

**Never fill a setup block from a default, a convention, or another
project's habit.** An unanswered block is left as it is and listed in the
report's Waiting-on-you section. A guessed policy looks decided, so nobody
ever revisits it; a blank one gets answered in ten seconds.

## 5. Replace every placeholder

Replace every value written in double curly braces with the real thing, in
CLAUDE.md and every file under project-os/. None may survive there, and that
includes the ones sitting inside example fences (`~~~` blocks): an example
reply in Conversations.md carries the dev address too, and a careful reader of
the table below would not expect one there.

| Token | What it means | Example |
|---|---|---|
| `{{PROJECT_NAME}}` | The project's name | Northwind Dashboard |
| `{{OWNER_NAME}}` | The person the assistant works for | Alex Rivera |
| `{{OWNER_ROLE}}` | Their role on this project | product designer |
| `{{PROJECT_ROOT}}` | Retired. Do not write a machine path into a committed file: it is one person's checkout, and a teammate reads a boundary that does not exist for them. CLAUDE.md now says "this repository, wherever this copy lives". | |
| `{{DEV_URL}}` | Where the app runs locally | http://localhost:3000 |
| `{{STACK}}` | One line: framework, data store, host | server-rendered web app · SQL database · managed cloud host |
| `{{CHECK_COMMAND}}` | The build / typecheck / test command | npm run build && npm test |

The two tool files under project-os/mcp/ carry a few more (the Figma file key
and target page, the Cloud project, the GA4 property), each inside a marked
setup table with its own instruction. In a folder the owner kept, each one
becomes "not wired yet" until that server is connected, the report says so in
one line under What was set, and the setup is asked at the server's first
request.

Leave `project-os/Hooks-settings.json` out of this step: it has nothing to
replace. Its two guard lines carry `${CLAUDE_PROJECT_DIR}` on purpose: the
installer writes this project's own path in its place in the personal settings
file, and keeps it in a committed one. Keep those lines exactly as they are.

**A repo with more than one app gets more than one row.** `{{DEV_URL}}` and
`{{CHECK_COMMAND}}` are written as single values, which is right for a single
app and wrong for a workspace: picking the one app you were pointed at leaves
every other app unchecked, silently, for the life of the project. Replace those
rows with a small table, one line per app, plus the workspace-wide command if
there is one. Every one of them gates a `Go commit`.

Where an answer is missing, write the honest state ("not hosted yet") and add
it to the report's Waiting-on-you section, never a guess.

**A tool folder leaves only on the owner's explicit "not used here"** from
step 4; silence keeps it. Remove it one file at a time, then the empty folder,
never with a recursive or forced delete. The kit's own guard refuses those on
purpose, and on a real install that refusal turned this step into a command
for the owner to run. Each tool folder holds a single file, so it is two plain
deletes: the rules file, then the folder. If even that is refused, it goes to
Waiting-on-you with the one command. Then rewrite the line in CLAUDE.md that
says the kit ships two tool docs so it names only what remains, and drop the
link to the removed doc from the one that stays.

## 6. Setup blocks and scaffolding

Do the setup steps the files carry, then clear the scaffolding:

- fill the marked setup blocks: the project description in CLAUDE.md, the
  reply language in project-os/Conversations.md (its length limits are law,
  not a setup block), the dev-server answer in CLAUDE.md rule 16, which
  rewrites that rule, the invariants the owner said yes to in CLAUDE.md
  rule 11, and the worst-class lines the owner said yes to in
  project-os/Code_review.md and project-os/Visual_QA.md. `Go commit` has
  one thing to fill (step 4): the branch the owner chose. It runs the check
  command step 5 wrote in, and who commits and who pushes are never rewritten
  (rule 22);
- check the exclusion list at the top of project-os/Backup-whole-project.mjs
  against this stack, and make the same change to the list in its PowerShell
  twin, `Backup-whole-project.ps1`, so the two always make the same ZIP: every
  dependency folder and cache this stack regenerates is named there, and
  nothing this project commits on purpose is. Folders named `build` or
  `target` travel in the ZIP by default, since in some projects they hold
  source; add one of them, or any other output folder, only when this
  project's own tools write their output there (its build config or scripts
  say so). Then add
  `/backups/`, `/.tmp/` and `/.claude/*.backup` to the project's `.gitignore`
  in the same edit, creating the file if there is none and skipping a line
  already there, so neither a snapshot, scratch output nor the hook
  installer's copy of the personal settings can ever be committed. A
  `.gitignore` created here from nothing also gets `.env*` and
  `!.env.example`, so a secrets file is never offered to the first commit;
- replace the skeleton tree in project-os/Map.md with the real one and fill
  its Data and Ownership tables;
- delete the example blocks at the end of Map.md, History.md, Decisions.md,
  Backlog.md, BugAtlas.md and Mistakes.md; they only show the shape;
- the example rows inside Code_review.md and Visual_QA.md carry their own
  instruction and stay;
- so does any worst-class line or invariant the owner turned down or left
  unanswered: it stays as it ships, and the report names it as waiting on the
  owner, with your proposed wording, so it can be answered in one word.

A block whose answer never arrived stays unfilled and goes to Waiting-on-you.
Filling it from a sensible default is the one shortcut this install forbids
(step 4).

## 6b. Install the hooks yourself

The rule files you just installed are followed only while they are remembered.
`project-os/Hooks.md` is what repeats the core ones on message fifty, and adds
two guards that refuse a known set of risky commands.

**Install them. Do not ask first.** This is a step of the setup, exactly like
replacing the placeholders, and the owner asking for ProjectOS is the approval.
An enforcement layer that waits for someone to notice a request at the bottom
of a report is an enforcement layer that never gets switched on.

**First, check whether they are already on.** If the owner did the
once-per-computer step (`project-os/Hooks.md`, "Two ways the hooks get
wired"), the kit can run as a plugin on this machine. When the kit was already
in the folder as this session opened, the session's start carried a line
beginning `[ProjectOS plugin] hooks active for` naming this project. That
line, or the hand run below, points to the plugin. The live check after them
is the proof that it is on.

**No line does not yet mean no plugin.** The plugin speaks only in a folder
that carries the kit, and it decides at the moment the session opens. If the
folder was blank then and the kit arrived during this session, the plugin was
silent at the start and may be active now. On a real install that silence made
the install wire every hook into the project's settings as well. So when the
line is absent, ask the plugin directly, from the project root:

```
node "$HOME/.claude/skills/projectos/hooks/dispatch.mjs" session
```

If it prints the `[ProjectOS plugin] hooks active for` line naming this
project, the plugin folder is there, and that is all a hand run can show. It
prints the same line when Claude Code has not loaded the plugin: switched off,
cloned during this session, or left out by a setting. Go on to the live check. If the file does
not exist or it prints nothing, the plugin is not on this computer, and the
installer path below is the path.

**The live check: one real, harmless command.** When the line was in your
context or the hand run printed it, make one real tool call, from the project
root. It uses a name nobody has: `projectos-live-probe-` followed by today's
date and the time as digits, for example `projectos-live-probe-202609251412`,
written NAME below. It deletes only when nothing by that name exists:

```
[ -e NAME ] || rm -rf NAME
```

In PowerShell the same call is
`if (-not (Test-Path NAME)) { Remove-Item -Recurse -Force NAME }`, and the
guard refuses it the same way. Never put the name under `.tmp` or end it in
`.tmp`, because the guard lets those through as disposable. Since it deletes
only a name that does not exist, it can never remove anything. This is the one
approved probe of the install: the owner's request to install ProjectOS covers
it, so CLAUDE.md rule 4 does not turn it into a question. Read the result:

- **Refused with `destructive-guard: blocked`**, while neither
  `.claude/settings.json` nor `.claude/settings.local.json` wires a destructive
  guard of its own: the plugin is live, and the plugin path applies. Claude
  Code usually adds that the hook comes from the `projectos@skills-dir` plugin.
  That is confirmation, not the key.
- **The command simply runs**, in PowerShell perhaps with a "Cannot find path"
  error: nothing was lost, the plugin is not live in this session, and the
  installer path applies.
- **Anything else**, a refusal that does not say `destructive-guard: blocked`
  or one while the project's settings already wire the guard: the installer
  path is the safe fallback.

**The plugin path.** When the live check proved the plugin on: read
`Hooks.md` and adapt the wording exactly as the installer path below says (the
plugin reads the same file), write NOTHING under `.claude`, and skip the
wiring, speaking and guard checks below. Run the installer once, with `--dry`
only: it writes nothing, prints each reminder's length against the recipe,
and says the plugin folder covers this project; its "will add" lines are
about the settings file only, and the refusal you just got is the guard
proof. The speaking check has its own form here: after adapting the
wording, run the plugin's reminder once from the project root and confirm the
new text comes back:

```
node "$HOME/.claude/skills/projectos/hooks/dispatch.mjs" prompt
```

A line saying the reminders are OFF means Hooks-settings.json is not valid
JSON: fix it and run the command again. Nothing back while the file is valid
means a settings file in `.claude/` already carries the kit's reminder, and
that copy is the one sent (Hooks.md, "Settings wiring wins"): name the file
and the event in the report, so the owner can remove that copy or have the
installer replace it. In the report, "# Rules switched on" says
they come from the plugin on this computer, and that another computer needs
the same once-per-computer command.

The plugin runs the guards from its own folder, not from the copy this install
just put in the project, so an older plugin guards a newer project with older
rules. The plugin says so itself: its start line ends in the kit version it
carries, and when this project's guard files differ from its copy a second line
names them and gives the one `git pull` that updates the plugin folder. That
folder is outside the project, so the command is the owner's to run: put it in
the report under "# Rules switched on" (section 8), never run it yourself.

A plugin older than that second line prints nothing even when the files
differ. So when no second line comes, compare the two guard files yourself,
`project-os/guards/` against the plugin folder's copy, and treat a difference
exactly as if the line had come.

**The installer path**, as part of the install:

- Read `project-os/Hooks.md`.
- **Adapt the wording first.** Open `project-os/Hooks-settings.json` and rewrite
  the standing-rules text for THIS project, using the rules it actually has and
  the mistakes it actually makes. The shipped wording is a generic default, and
  a generic reminder every message is worth little. You may edit that file
  freely: it is an ordinary repo file, not agent configuration. The recipe:
  - Five to seven rules, each one line, numbered. A rule earns a line when
    breaking it costs the owner a round of correction; a rule nobody breaks
    does not.
  - Under about 600 characters. The text is paid for on every message. The
    installer prints the length of each reminder and warns above 600.
  - No apostrophes, double quotes, backticks, dollar signs or backslashes
    anywhere in it. The text sits in single quotes inside a double-quoted shell
    command, so each of those ends the string, runs as a command, or is read
    as a variable, and the reminder arrives with words missing or not at all.
    Write "do not", never the contraction, and name files without quotes, by
    their place in the project: project-os/Conversations.md.
    This is about the rules text only: the two guard lines in the same file
    carry `${CLAUDE_PROJECT_DIR}` on purpose (step 5), so leave them as they
    are.
  - Run the finished command once in the shell before installing, and once
    more in the other shell if the machine has both, and read what comes out.
- **Check whether hooks are already installed.** Read
  `.claude/settings.local.json` if it exists (reading it is allowed) and say in
  the report which events already have hooks and which do not. If a hook there
  uses the `echo` form with single quotes around JSON, flag it: it produces
  invalid output under the Windows command prompt and silently injects nothing.
- **Run it**, from the project root:

```
node project-os/Install-project-hooks.mjs
```

  It merges, never overwrites, backs the file up first, and leaves existing
  hooks alone unless re-run with `--replace`. It proves the target folder is
  writable before it starts, and it says "added" only after the file is on
  disk; a run that ends in a sentence starting "Install-project-hooks:" and an error
  wrote nothing, and that sentence carries the remedy. Report what it added,
  in one line, quoting the "added:" line and never the "will add:" one.

- **Prove it is wired, not only that the scripts run.** Run the installer once
  more with `--dry`, adding `--shared` when that is how the hooks were
  installed, since the dry run checks the file it would write to. Every event
  it lists under "present:" is installed; any event under "will add:" is not,
  whatever the two checks below say. Those two run the scripts by hand and
  pass on an unwired project just the same, which is how an install reported
  working hooks that were never in the settings.

- **Prove one hook actually speaks.** Installing is not evidence. Run the hook's
  own command once in a shell, exactly as it is written in the settings, and
  confirm the standing-rules text comes back. If nothing comes back, or the
  shell mangles it, the hooks are installed and silent, which looks identical to
  working. Say so in Problems rather than reporting the rules as on.

- **Prove one guard actually blocks.** Same idea, no real action: pipe one fake
  tool call into the destructive guard and read the exit code. `Hooks.md` has
  the one-line command. Exit 2 with a reason is a working guard; exit 0 means
  it is not installed or not running, and that goes in Problems.

- **If the write is refused**, some environments guard their own configuration,
  do not argue with it and do not retry in a loop. Say plainly that it was
  refused and move on. Fallback, never the plan. But a refused install is not
  one item among eight: the kit's own line is that a project without hooks
  runs on good intentions, so the remedy replaces "# Rules switched on" and
  opens the report as its first section (see section 8), never a
  Waiting-on-you entry. The remedy is one command, and in
  Claude Code the owner can run it without leaving the conversation, by typing
  it in the chat box with an exclamation mark in front:

```
!node project-os/Install-project-hooks.mjs
```

  Say where to type it, not only what. That turns a blocked install from a
  to-do into a ten-second fix in the same session. Beside it, offer the
  once-per-computer command from `project-os/Hooks.md`, "Two ways the hooks
  get wired", in the same chat-box form with an exclamation mark in front, as
  the fix that ends this for every future project on that machine.

- **Tell the owner the one thing that is theirs:** hooks are read at session
  start, so the ones you just installed take effect in their NEXT session.
  Give them the check: ask the assistant what rules it was given this turn, and
  see whether it reads them back.

Never present the install as finished enforcement when only the documents are
in place, and never leave the hooks uninstalled merely because nobody asked.

## 6c. Check the archive and backup scripts run here

Two scripts in `project-os/` do the upkeep. Each is a Node script, the one
`Go commit` and `Go backup` run, with a PowerShell twin beside it that does the
same for anyone who prefers it.

The first, `Archive-old-rows.mjs`, keeps the growing docs from becoming a tax
on every task, with three engines inside it (History rows and the scan log;
Decisions entries; the Backlog Done, Mistakes tail and BugAtlas tables). It
MOVES old material into a sibling `*-archive.md`, never rewrites it, and it is
wired into `Go commit`. At install:

- Run its preview once:

  ```
  node project-os/Archive-old-rows.mjs --dry-run
  ```

  A fresh repo has nothing to move, so the expected output says so for every
  file, and marks a file missing and skipped only when this project does not
  have it. That is the proof the paths resolved; a run that moves nothing
  writes nothing.
- Where PowerShell exists on this machine, run the twin's preview too and
  confirm it says the same:
  `powershell -NoProfile -ExecutionPolicy Bypass -File project-os/Archive-old-rows.ps1 -DryRun`
  on Windows, or `pwsh -NoProfile -File project-os/Archive-old-rows.ps1 -DryRun`
  on macOS or Linux. Where it does not exist, skip the twin: nothing depends
  on it, so it is not a Problem, and the install row says so in a word.
- Without Node the Node script cannot run, and step 2b's Problems line
  already says so.
- Never edit an entry to make a file smaller. Shrinking is that script's job,
  and its alone.

The second, `Backup-whole-project.mjs`, makes the `Go backup` snapshot. Run it
once, after step 6 has settled its exclusion list and gitignored `backups/`:

```
node project-os/Backup-whole-project.mjs
```

It prints the ZIP path and a count of files whose names were checked in the
archive, or fails and leaves nothing; either is the proof. If it prints a
"Left out by name" line, read it: a source folder on it means the exclusion
list names something this project keeps on purpose, so fix the list and run
again. A ZIP that took minutes or weighs hundreds of megabytes means a
regenerable folder is missing from the exclusion list: fix the list, on
step 6's terms for an output folder such as `build` or `target`, delete the
ZIP, run again. Every fix to the list goes into the twin's list too. In a git
worktree or submodule it refuses by design, since a ZIP there would hold no
history; say so in the report. The ZIP it leaves is the project's first
snapshot; tell the owner where it is in the report. Its twin is not run at
install, even where PowerShell exists: one snapshot is enough, and step 6
gave both scripts the same list.

## 6d. Give the project a browser

Rule 6 says anything a person can see is verified in a running browser, and a
project with no browser tool turns that rule into a manual checklist for the
owner. The owner has asked, in so many words, for the assistant to have a
browser in every project, and for Chrome to be set up in every install, even
when another browser already works. So the install runs all four steps below,
every time, the same way it wires the hooks: as a step, not a suggestion.
Finding one working browser never ends the step.

1. **Look first.** Search the tool list for `browser`, and again for `chrome`
   (a deferred tool is invisible until searched for). A search may find only a
   tool that switches one of them on; call it, then search again. The desktop
   app's built-in browser pane counts when it actually loads a page: load
   `https://example.com`, the address reserved for exactly this, never a site
   of your choosing, and close every tab you opened to test it. The Claude in Chrome extension counts only
   for a Chrome on this computer: its connected-browsers tool lists one marked
   as on this computer, or as the one this session's actions go to (in use);
   a mark saying only that its system matches this one is a weak hint and does
   not count alone (the list covers every computer on the account). Where
   that tool does not exist, it counts when its tab-context tool answers
   without saying the extension is not connected; an empty tab list is normal
   at install time. Never ask it to create a tab group, a window or a tab, so
   the install opens nothing in the Chrome the owner is working in.
   Note each one you found in the report.
2. **Check the owner's own Chrome.** The Claude in Chrome extension drives the
   Chrome the owner works in, with their sign-ins, so it is the browser for a
   check that needs a logged-in session or what the owner actually sees. The
   owner adds it once per computer, from the Chrome Web Store; the assistant
   cannot. If it counted in step 1, say so under What was set, and that ends
   this step. If it did not, put ONE Waiting-on-you item, one sentence per
   line, adding a line that it is already connected on another computer when
   that is so:
   "Add the Claude in Chrome extension to your Chrome, and sign in to it."
   "Then switch Chrome on in Claude."
   "It works only when Claude is signed in with a Claude plan, not an API key."
   "I use it for checks that need your own logins."
   When the install runs in the terminal version of Claude, switching it on is
   one command: give it in its own fence, labelled "terminal version only".
   Leave it out in the desktop app.

   ```
   /chrome
   ```
3. **Register Chrome DevTools at project scope, always**, whatever steps 1 and
   2 found. It drives its own Chrome, needs no sign-in, and runs through Node
   20.19 or newer (22.12 or newer on the 22 line), so the project has a Chrome
   that works even while the extension is missing. The entry depends on the
   system: on Windows the command goes through `cmd`, because a stdio server
   started as bare `npx` does not launch there, and `cmd` does not exist on
   macOS or Linux. So the entry for this computer stays on this computer, and
   the project shares an example instead:

   - **No `.mcp.json` yet, or one that is not committed:** add `/.mcp.json` to
     `.gitignore` beside the lines step 6 added, skipping it if it is there.
     Write the entry for this system into `.mcp.json` at the project root,
     merging into an existing one and never overwriting it, and add the same
     entry to `.mcp.json.example`, creating it if there is none; the example
     is committed, so a fresh copy of the project keeps it. Whoever copies the
     example on the other system switches that entry to the other form below.
   - **A `.mcp.json` git already tracks:** merge into it, never overwriting
     it, and put one Problems line in the report: the committed entry starts
     on this system only, and a teammate on the other one gets a server that
     fails at every session.

   Windows:

   ```
   {"mcpServers":{"chrome-devtools":{"command":"cmd","args":["/c","npx","-y","chrome-devtools-mcp@latest"]}}}
   ```

   macOS or Linux:

   ```
   {"mcpServers":{"chrome-devtools":{"command":"npx","args":["-y","chrome-devtools-mcp@latest"]}}}
   ```

   A `chrome-devtools` entry already there stays as it is. If it is written
   for the other system, it will not start on this one: say so in Problems,
   and suggest keeping `.mcp.json` per machine, gitignored with the entry in
   `.mcp.json.example`, rather than swapping the form, which would break the
   other system. If writing the file is refused, do not retry and do not write
   it another way: put one Problems line saying the separate Chrome is not set
   up, with the block above and where it goes, and carry on.
4. **Tell the owner the one thing that is theirs.** A project-scope server is
   read at session start and the assistant asks the owner once to approve it,
   so it works from their next session. When step 3 wrote an entry that can
   start here, put that in the report under What was set, one line: which
   browsers this project has, which system the entry is written for, that
   the separate Chrome starts with the next session once the owner approves
   its prompt, and that the entry fetches chrome-devtools-mcp from npm on
   first start and takes new releases by itself. Declining it leaves the
   project without that Chrome; running
   `claude mcp reset-project-choices` in the project folder brings the prompt
   back at the next session, for every server in the project. If Chrome is
   not installed on the machine, or step 2b found no Node or a version the
   separate Chrome refuses (older than 20.19, or a 22 older than 22.12), say
   so in Problems instead; nothing here installs a browser.

Never write the server into the owner's personal configuration, and never copy
another project's connection (rule 21). The project file is the whole setup.

## 7. Log the install

Log the install itself in project-os/History.md: one scan row and one appendix
row, each at the bottom of its table. On a first install they are the first
rows; on a re-run they follow the ones already there. Both name the kit commit
the files came from, so a later update can tell which kit this project runs:
the one step 0 noted, on a re-run the one the earlier install row names, or
unknown when the files were copied in by hand.

Write the same commit into `project-os/Kit-version.json`, the file
`Go update kit` (CLAUDE.md) reads to know which kit this project starts from.
The date is the day the files came in: today, or on a re-run the earlier
install row's date.

```
{"commit": "<the short commit>", "date": "YYYY-MM-DD"}
```

When the commit is unknown, do not write the file, and say so in the report:
a later `Go update kit` then starts without knowing which kit this project
came from. On a re-run, a file already there stays as it is.

The row's shape, since the file asks for about 900 characters: the kit
commit, the files placed, the questions answered in a word each, and every
check with its result in two or three words (kit tests passed, Node 24,
hooks proved, reminder read back, Chrome found, check command none yet). The
report carries the detail. Never send a result to a commit message: the
install lands on the owner's `Go commit`, often in another session that never
saw the results, so the row is the record that lasts.
The kit's rules apply to the kit.

## 8. The install report

The one output the owner reads. Deliver it as the install's closing message,
in the reply format project-os/Conversations.md prescribes.

**This one report is exempt from that file's length ceiling**, and only this
one. Its layout rules still apply in full: the dividers, the headings, one
sentence per line, plain words. Length is what lifts, because a report that
drops a problem or a clash to fit a line budget defeats its own purpose. The
same exemption is written into Conversations.md, so the two cannot disagree.

Sections, in this order. On a refused install, section 4 becomes "# Rules not
enforced" and moves to the top. The owner's questions come LAST, as
Conversations.md rule 13 requires of every reply: placed fourth of six, they
were read past and left unanswered (review 2026-09-28).

1. **What was set.** Each value, and where it came from: the repo, or the
   owner's answer. The first line is the kit commit the files came from, the
   same one step 7 writes into History and `project-os/Kit-version.json`, or,
   when it is unknown, that the file was not written and why.
2. **Problems.** Every place the project does not work the way the kit
   expects: a failing check command, no dev server, a tool that is not wired,
   a block that cannot be filled. One line each, with its practical
   consequence. An install with no problems says so explicitly.
3. **Clashes.** Every place an existing rule or working habit of this project
   interferes with the kit's processes. The project's own rules only: a clash with
   the assistant's global instructions is settled by step 2, the kit wins, and
   is stated under What was set, not asked here. Per clash: the existing rule, the kit
   rule or process it blocks, what keeping it will cost in practice, and a
   keep-or-override recommendation. This is a decision list for the owner;
   nothing has been overridden.
4. **The rules are on.** Fourth, except on a refused install (below). Short,
   and written for someone who does not read code. Use this shape:

   > ----
   > # Rules switched on
   >
   > I installed the part that repeats your rules to me.
   > From now on your core rules reach me with every message you send,
   > instead of fading as the conversation gets long.
   > Two guards also refuse a known set of risky commands,
   > such as writing outside this project.
   >
   > One thing is yours:
   > close this session and start a new one,
   > because that setting is read when a session opens.
   >
   > To check the rules reach me, ask me in the new session:
   >
   > ```
   > what rules were you given this turn?
   > ```

   When the plugin was proven live in 6b, the block says so instead, and asks
   nothing of the owner here:

   > ----
   > # Rules switched on
   >
   > They come from the ProjectOS plugin on this computer,
   > so nothing had to be installed in this project.
   > Every new session starts with them on.
   > Another computer needs the same one-time command,
   > written in project-os/Hooks.md under "Two ways the hooks get wired".
   > If I read your rules back to you, they are reaching me.

   When the session's start line said this project's guard files differ from
   the plugin's copy, or your own comparison found them different (6b, the
   plugin path), add two lines to that block: this computer's copy of the kit
   is behind the one in this project, and the one
   command that updates it, which is the owner's to run because the plugin
   folder is outside the project:

   ```
   git -C "$HOME/.claude/skills/projectos" pull
   ```

   The pull is ALSO one Waiting-on-you item, a single line: it is the one
   thing that keeps the guards current, and as a line under this block alone
   it was read past twice (install reports, 2026-09-29).

   If the install could not write that setting, this section is REPLACED by
   the honest version, and it moves to the top as the report's FIRST section:
   the rules are documents only until one command runs. Give the command, say it
   can be typed straight into the chat box with an exclamation mark in front,
   and say a new session comes after it. Never file that command under
   Waiting-on-you among the other items; on a refused install it is the one
   thing in the report that matters.

   > ----
   > # Rules not enforced
   >
   > I could not switch on the part that repeats your rules to me
   > and refuses a known set of risky commands.
   > This environment blocks me from writing that setting.
   > Until it is on, your rules are documents I may forget in a long session.
   >
   > Type this in the chat box, exclamation mark included, and it runs here:
   >
   > ```
   > !node project-os/Install-project-hooks.mjs
   > ```
   >
   > Then start a new session, and ask me what rules I was given this turn.

   Say in one line where the hooks were installed: personal to this machine by
   default, and team-wide is available on request. Do not turn it into a
   question.

5. **What to say.** After the rules are on, before the owner's questions.
   The owner has just been handed a folder of rules and knows none of the
   phrases that drive it, so list them: a title, then ONE line saying what it
   does. Nothing else, no flags, no explanation of the machinery.

   **Every title is a capital first letter and the rest lowercase**, whatever
   casing CLAUDE.md gives the phrase: `Go visual qa`, `Fast mode`,
   `Full report`. The owner asked for it. The phrases work in any casing, so
   this changes how the list reads, never how a phrase is typed.

   List every trigger this project actually has, which is every one in
   CLAUDE.md's Review, QA and Shortcuts sections, plus Full report from
   Conversations.md rule 1. On a stock install:

   > ----
   > # What to say
   >
   > **Go commit**
   > I run the checks, commit everything so far, and leave you the push.
   >
   > **Go audit**
   > Count the gaps in the project's own records, and tell you what each means.
   >
   > **Go update kit**
   > Bring this project up to the newest kit, after showing you what changes.
   >
   > **Go backup**
   > Zip the whole project into one file you can put on a drive.
   >
   > **Go commit and backup**
   > Commit everything, then zip the whole project, in one go.
   >
   > **Go code review**
   > Review the whole codebase and hand you the findings.
   >
   > **Go visual qa**
   > Use the running app screen by screen and report what breaks.
   >
   > **Fast mode**
   > Skip the paperwork and check each round yourself, until you say stop.
   >
   > **Backlog**
   > Put the thing we just discussed on the open-items list.
   >
   > **Full report**
   > Lift the length limit when you want the long version of an answer.

   In a cloud session, the Go commit line says instead that you push this
   session's own branch and leave the merge into main to the owner
   (CLAUDE.md rule 22).

   **Then the project's own phrases.** A plan-driven project is driven by its
   own triggers ("go 1.1", "next step", a build phrase the owner already uses),
   and those are the ones used most. Add a second short group under the same
   heading, "This project's own", with whatever this install found or the owner
   named. Leave it out only when there genuinely is none.

   Adapt the list to what this project ended up with, and drop anything that
   does not exist here. A trigger the owner never learns is a trigger nobody
   uses.

6. **Waiting on you.** The closing section: everything that needs the owner's
   answer or verdict, numbered, so each item can be answered in one word. When
   the client has a question panel, every item with options goes through it
   right after the report, as Conversations.md rule 13 requires; this section
   lists them one line each and says the panel follows. An install with
   nothing waiting says so in one line, so the owner knows the report is over.

If a rule in the kit contradicts how this project actually works, it belongs
in Clashes too, said plainly, instead of quietly adapting the kit.

## 9. Clean up

When the report is delivered, this file has done its job, and it STAYS. Other
files point at it by name, so deleting it leaves a reader following a pointer
to nothing. To find them all, search the whole project for `Installation.md`;
the search is the list, since files change. Today it finds CLAUDE.md rule 6,
the one pointer that sends the assistant to step 6d when a browser search
comes back empty, CLAUDE.md's `Go update kit` and Restore, and also
`project-os/Hooks.md`, `project-os/Conversations.md`, the headers of
`project-os/Install-project-hooks.mjs` and `project-os/Compare-kit-files.mjs`,
and both tool files under `project-os/mcp/`. Say once in
the report that it is kept as the record of how the install was done, and that
the owner may delete it later if they want; if they do, every pointer the
search finds is theirs to update. For the ones that send the assistant to
step 6d, updating means copying that step into one of them first, since the
Chrome DevTools entries for `.mcp.json` are written nowhere else.
CLAUDE-kit.md, if there was one, is already gone (step 2), except on a
re-install, where step 2 leaves it beside CLAUDE.md for the owner's word: do
not delete it here, and leave it out of any commit until the owner rules on it.
The kit fetched into `.tmp/` is gone too (step 0).
