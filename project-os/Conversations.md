# Reply format

The rules for every reply you write to {{OWNER_NAME}}.

This file is the ONE home of every reply-format rule.
`CLAUDE.md` only points here and carries no limits of its own.

Each rule below is followed by a live example of a reply obeying it.
Examples sit inside `~~~` fences: they show a reply, they are never rules themselves.

## Language

Every reply is written in one language, picked once and never varied.

> **Setup step: replace this block** with a single line naming that language,
> for example: *Reply in English, always.*

The language of the request never changes the language of the answer.
An owner who sometimes writes in another language still gets the answer in the
project's one.

## In-flight narration

Nothing is written between tool calls.
One line at pickup names the task, its type, the area it touches and its risk
level, plus any invariant it touches; the next text is the report.
No plan of the next edit, no summary of the last one, no "I'll do X now".
That one line follows the tone rules, never the layout: no divider, no heading.
The one exception is a question that blocks the work, and it ends the turn.

## The one hierarchy

`# H1` marks a section or a topic: one distinct heading, nothing above it.

`**bold**` marks a sub-point INSIDE a section (a stacked-list point, a status
group), never a section or topic itself.

## Report-back sections

After work, the summary uses these four sections; drop any with nothing to say.

**What changed**: the behavior in ≤2 sentences, not a per-file breakdown.
**What was checked**: only a check that failed or could not run, the Path B
or Path C outcome of the browser check (`project-os/Workflow.md` step 9), and
review findings waiting for the owner's verdict. A passed check and a clean review are the expected
state and are never listed; the full list lives in `project-os/History.md`.
**Known limitation**: one line each; skip when nothing is risky.
**Next**: one short step or decision.

Many items: keep the ≤2-sentence headline and stack them per rule 10.

What shrinks under pressure is the CONTENT, never the layout. Every layout rule
in this file stands at every length: dividers, `# H1` headings, one sentence per
line. Cutting a heading or a divider to fit is the one thing the budget must
never do.

## Rules

### 1 · Cut hard

Short by default: 3 prose lines, each at most 16 WORDS.
16 is a ceiling, not a target: use the fewest words that still explain.
Inside that ceiling, say the problem and the why, never a verdict alone.
A topic the owner has not heard of gets its cause in words, before the verdict.
Only the long evidence and the full check list go to the `project-os/History.md` row.
The ceiling holds for EVERY reply, work behind it or not.
A findings list (rule 10) has no ceiling: every item in full.
Otherwise it lifts ONLY when the owner asks for a `full report`: 16 prose lines,
and twice more for the two messages `Installation.md` defines, the question
batch and the closing report, which have fixed contents they must carry in
full. Every layout rule still applies to both; only the length ceiling lifts.
Mention `full report` once, at setup, so the owner has it; never offer it after.
The FAST MODE offer in `CLAUDE.md` is exempt from the ceiling too: it is quoted
verbatim, and its lines do not count against the reply it closes.
The ceiling counts prose only; dividers, headings, blank lines and fences don't.
It is the whole reply's budget, the four report sections included.
When content competes for it, bad news wins the room: a limitation or a failed
check is never the line that gets cut.
Over the ceiling, CUT: never reformat the same content into more lines.
Cut any sentence that changes nothing the owner knows or does next.
A single-topic answer needs no headline or divider.
Open on the substance: nothing above the first `----`, no preamble ("Sure,").

**These numbers are law, and the install never asks about them.** Three lines
of sixteen words ships as written, in every project, with no sample answers to
choose between and no question about length at setup.
The full report's sixteen LINES is a separate third number, not the sixteen-word
ceiling, and the two move independently.
All three live in this rule and nowhere else, so nothing can drift out of sync.
An owner who wants a different limit edits this rule later, with the file in
front of them, and that edit is the only way the numbers change.

"Never a verdict alone" is the half that matters most.

~~~
The export button now downloads the whole list, not only the visible page.

Say the word when you want this locked in.
~~~

### 2 · Short headlines

Give each section a short `# H1` heading on its own line: one word where it
works (`# Changed`, `# Checked`, `# Limitation`, `# Next`), never more than
three, no bold wrapper, no trailing colon.
Then a blank line, then the text.

~~~
----
# Changed

The settings page now saves on blur instead of on every keystroke.


----
# Next

Say "do the export button" to start the next one.
~~~

### 3 · Section dividers

Put a `----` divider, with an extra blank line above it, directly above every
`# H1` heading.
Bold sub-headlines take a divider only where rules 10 to 11 grant one: stacked
points do, numbered or not; grouped-status headers don't.

~~~
----
# Changed

Every old address now redirects to its new one.


----
# Next

Say the word and I will lock it in.
~~~

### 4 · Paragraph spacing

Leave a blank line above every paragraph.

~~~
The rename tool is live.

Every name change is recorded automatically.

Old addresses redirect to the new one.
~~~

### 5 · One sentence per line

Break after every sentence-ending period: one sentence per line, never two.
Don't break on periods that aren't sentence ends (`e.g.`, `.env`, `4.8`).
Mid-sentence breaks only at punctuation already there (comma, semicolon, dash,
colon, closing parenthesis), never bare mid-clause.

~~~
The build failed on the third check.
The cause is a missing id on the new entry.
Add the id, rerun the check, and it goes green.
~~~

### 6 · Short sentences

One thought per sentence.
Never chain several topics into one sentence with dashes, semicolons,
parentheses, or comma strings.
Two ideas are two sentences on two lines.
A list packed mid-sentence becomes its own lines, one item each.

~~~
The list code was already generic.
One line gave the new section its ids, renames, and redirects.
Search and the sitemap came free.
~~~

### 7 · Lead-in split

Never run a label or question and its explanation on one line: break after the
colon or question mark so the lead-in sits alone and the detail follows on the
next line.

~~~
The real question:
does the old address still get traffic after the rename?
~~~

### 8 · Numbered options

When proposing options or next actions, use a numbered `1)` `2)` `3)` list under
its own headline.

**Two asks are two numbered items, never one sentence joined by "and".**
However short, and for a verdict list (fix / drop / backlog) too.
Two things the owner owes an answer to means two numbered lines.

~~~
----
# Next

1) Fix, drop, or backlog the empty state on the list page?
2) Do you want the same treatment on the search page?
~~~

~~~
----
# Next

1) Lock in the batch now.
2) Do the export button first.
3) Stop here for today.
~~~

### 9 · Topic headlines in long answers

Any reply spanning several topics gives each topic its own section (rules 2 to 3),
not just the fixed summary ones.

~~~
----
# Saving

Edits save when a field loses focus.
Nothing saves on every keystroke any more.


----
# Entry identity

Every entry carries a permanent id.
Renaming is safe.
~~~

### 10 · Stacked list points

In a list of findings, never pack a point into a paragraph.
Give EVERY point, numbered or not, a **bold** headline with `----` above it.
Under it, in full and never trimmed: `Problem:`, `Proposal:`, `In practice:`,
`Your workflow:`, each label alone on its line, one sentence per line below.
Same-topic points number the headline (`1 ·`), never a Markdown `1.` item.
The install's two messages keep the one-line Problems shape `Installation.md` gives them.

~~~
----
# Review findings

----
**1 · Status column is ambiguous**

Problem:
The column shows the group's status, not the item's.

Proposal:
Pick one meaning and label it.

In practice:
Everyone reads the column the same way.

Your workflow:
No change for you.

----
**2 · Progress reads as text only**

Problem:
done / total is a bare number.

Proposal:
A thin bar beside it.

In practice:
Progress is scannable at a glance.

Your workflow:
No change for you.
~~~

### 11 · Grouped status lists

Items sharing a state group under one short **bold** header in plain words:
**Done**, **Half done**, **Not started**.
The state is said ONCE, in that header.
Never an icon or emoji legend, and never a Markdown table.
Under the header, one item per line: the name, then only the detail that changes
the owner's next action.

~~~
----
# Phase A

**Done**
A1 the list page.
A2 entry identity.

**Half done**
A5 backups, waiting on your account.

**Not started**
A7 the export button, say "do A7".
~~~

### 12 · Verbatim text goes in a fence

Commands, code, quoted wording, addresses and paths the owner will USE each get
their own fence.
One per line, complete, never buried mid-sentence.
Give only a NEW address, never the app's root: that one already sits in an open
tab.
A named route is the FULL absolute address, never a bare path.
A file path is the FULL absolute path, never a project-relative one.
A name merely referenced in prose stays as inline backticks, for an owner who reads code; otherwise rule 14 applies.
The test is copy-intent: if the owner has to retype it to act, fence it.
Inside a fence no layout rule applies: the fence is one object.
A terminal command starts by entering the project folder, full path, on the
same line, in the shell's own syntax.
Never a bare `npm run dev`: it works only if the terminal happens to sit there.
An instruction to click through a dashboard comes with the direct link to that
screen, fenced, not a trail of menu names.

**A fence carries ONLY what the owner copies, never content they read.**
A checklist, a plan, steps, findings or an explanation are ordinary reply text,
in the normal layout, every time.
A fence is a clipboard, not a container.
The one exception is rule 14's skippable reference block, for an owner who does not read syntax.

A path named only to identify a file
("the rule lives in `project-os/Conversations.md`") is prose, not copy-intent, so
it stays inline.

In PowerShell the command form is
`cd "C:\code\northwind"; if ($?) { npm run dev }`, in a POSIX shell
`cd "/Users/alex/code/northwind" && npm run dev`.

~~~
Start it and look:

```
cd "/Users/alex/code/northwind" && npm run dev
```

Then open the settings page and the save button should answer at once.
~~~

~~~
Turn on object storage for the account, here:

```
https://dash.cloudflare.com/?to=/:account/r2
```

Say enabled and I create the bucket.
~~~

~~~
The new page is at:

```
http://localhost:3000/settings/notifications
```

Nothing on the existing pages changed.
~~~

### 13 · A question for the owner goes last

A question for the owner is the LAST thing in the reply, never buried mid-reply.
In a sectioned reply it sits under the final headline; number options (rule 8).
When the client has a built-in question panel, a question with options goes
through it, always, with one line per option; the feed then carries only what
the answer is waiting on.

~~~
----
# Changed

The contact form now shows a clear line when sending fails.


----
# Next

The form needs one call from you:

1) Send through your own server.
2) Use a managed service.
~~~

### 14 · Plain language: the owner's words, never the code's

{{OWNER_NAME}} is a {{OWNER_ROLE}}: speak in that role's vocabulary.
The test for every word: would the owner have to ask what it meant?
If yes, rewrite the line before sending; if their trade reads code, code words are fine.
Before naming any part of the product, say what it is and where it sits on screen.
Give that context FIRST, then the finding, the suggestion or the question.
State every technical finding as its consequence for the product, one per line (rule 10).
A list of suggested wording runs in the product's own order, quoting the words the owner sees.
Never group it under headings you invented; they exist nowhere on the owner's screen.
Name each thing the way the OWNER says it, never the way the code says it.
For an owner who does not read syntax, say each thing in plain words, never as code in a sentence.
A command, address or path they must USE still gets its own fence where it is needed (rule 12); it is never skippable.
Syntax they would only read is left out, or collected in ONE fenced block at the section's end, labeled skippable.
Frame every decision in product terms.
If the owner says they did not understand, the explanation was built wrong; rebuild it.

~~~
Never:
Purge the orphaned pre-migration blobs?

Instead:
Delete the leftover copies from the old version?
Nothing uses them any more.

And the same for a finding:

Never:
The resolver emits an unvalidated path.

Instead:
A page can vanish from the live site and the build will not notice.

```text
Reference (skippable): ../ traversal above src/;
the -f and --force write paths uncovered by the check.
```
~~~

~~~
Never:
The label is title1, the bold line is title2, that is every pair I listed.

Instead:
Every picture on the project page has two lines above it.
The small one names the area, the bold one under it names the work.
Those are the two lines each suggestion below rewrites.
~~~

### 15 · Elaborate stays short

"Elaborate", "expand", "tell me more" buy depth, never length.
Answer the deeper question inside rule 1's ceiling, dropping breadth to pay.
When the owner calls a reply too long, cut content, never a `# H1` or a `----`.

The numbers live in rule 1 only, so this rule can never drift from them.

~~~
The slow page is the query, not the rendering.
It refetches the whole list on every keystroke.
Fix: fetch once, filter in memory.
~~~

### 16 · One home: never open a second file

This file is the ONLY place that carries reply-format rules.
Never create, open, or write another file about how replies are written: not a
memory file, not a note, not a plan, not a scratch doc.
A format lesson learned mid-conversation is added HERE, in place.

One thing is not a second home: the row a correction earns in
`project-os/Mistakes.md` (CLAUDE.md rule 20). That row records the slip, so a
repeat can be seen and promoted; the RULE it points at still lives here, and
only here. A correction on how a reply was written gets both: nothing new in
this file when the rule already exists, and one row there every time.

Nor is `project-os/Rule-reasons.md`: it holds only why these rules exist,
never a rule, and it is opened only when a rule is questioned or changed.

~~~
That rule is already rule 6 here.
One row goes on the mistakes list; the rule stays as it is.
~~~

### 17 · After a commit, never print the push command

End a commit report with a `# Next` section carrying one line:
`Push to live, <joke> <emoji>`.
One clause, short, WITTY with a little sting, a tease, never a silly pun.
BUILD IT FROM THE WORK JUST COMMITTED, so the line can never repeat.
It should read like a sharp friend ribbing the owner, not a dad joke.
Never lift a line from this file, and never read past sessions for one.
Close with ONE emoji, LONG-ESTABLISHED: a newer one renders as a white square.
Rule 12 does not apply here: there is no command to fence.
In a cloud session you have already pushed the session's own branch (CLAUDE.md rule 22), so the line opens `Merge to live,` instead.
A cloud session with no remote to push to gets no such line: Next says the commit is unpushed and goes when the session's machine does.

~~~
----

# Next

Push to live, the footer only needed three reminders 🕰️
~~~

### 18 · Never a long dash

Never write a dash longer than a hyphen: not `—`, not `–`, not a `--` pair.
Use a comma, a period, a colon, or a new line instead.
This covers every text you write: replies, docs, commit messages, product copy.
The `----` divider is layout, not punctuation, so it stays.
A single hyphen inside a compound word (`build-time`) is untouched.

Text already written is not retro-edited; the rule is forward-looking until the
owner asks for a sweep.

The `## YYYY-MM-DD · Title` heading in Decisions.md uses a middle dot because a
long dash is banned, and the rotation script accepts any separator there, so
an older entry written with a dash still rotates.

~~~
Never:
The redirect map is live — all 16 old links land correctly.

Instead:
The redirect map is live.
All 16 old links land correctly.
~~~

---

Replies shaped by this file are for one reader's eye.
No tooling ever parses one back, so every format choice serves scanning, nothing
else.
