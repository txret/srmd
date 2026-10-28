# srmd for VS Code

A note-taking first spaced repetition Markdown extension for VS Code. Mark the answers in a note as clozes, and each cloze group becomes a flashcard. The Markdown notes are parsed with [micromark](https://github.com/micromark/micromark) with custom extensions. Reviews are scheduled with [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), the TS implementation of the [FSRS algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm).

```markdown
The World population:: approx 8.3 billion

The 5 most populous countries in the world:: 

- India
- China
- United States of America
- Indonesia
- Pakistan
```

Note taking comes first. A note stays readable Markdown and the extension syntax, srmd, is aimed at being as unobtrusive as possible with the FSRS scheduling stored in the note itself. Once a card has been reviewed, a card reference such as `[:1]` ends its first cloze and a one-line card definition holds its scheduling, at the end of the note unless the note already has definitions:

```markdown
The World population:: approx 8.3 billion[:1]

The 5 most populous countries in the world:: 

- India
- China
- United States of America
- Indonesia
- Pakistan

[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
```
There is no database or srmd service. Notes move, rename and sync with whatever you already use, such as Git or Syncthing. Loading a note never rewrites it; only a review, or a manual scheduling hint the user wrote, saves it.

## Turning it on

srmd is **off** in every workspace until you turn it on, so opening a code project costs nothing: no files are searched or watched, and there is no Flashcards view, badge or menu entry. Only a status bar item shows, `⊘ srmd` on the right.

In a folder of notes, turn it on with **srmd: Turn On** from the Command Palette, or by clicking the status bar item. srmd then loads the folder's notes, shows the Flashcards view and the Explorer badges, and watches the folder for changes. It stays on for that workspace, also after a restart.

**srmd: Turn Off**, or another click on the status bar item, unloads everything again: the view and badges disappear, an open review tab closes, and watching stops.

Both write the `srmd.enabled` setting to the workspace settings, which creates `.vscode/settings.json` in the folder if it does not exist. Committed with your notes, it turns srmd on wherever you open them. To turn srmd on in every workspace, set `srmd.enabled` to `true` in your user settings. A workspace that turns it off still overrides that. You can hide the status bar item from the status bar's context menu.

## Writing cards

Notes are files ending in `.sr.md` (configurable). Two or more colons and a space start a cloze. Within a paragraph, it runs to the end of the paragraph or to the next hard line break; at the end of a paragraph, it covers the next block:

```markdown
The World population:: approx 8.3 billion

The 5 most populous countries in the world:: 

- India
- China
- United States of America
- Indonesia
- Pakistan
```

Once you review a card, srmd adds a card reference at the end of its first cloze and a card definition with its scheduling, at the end of the note unless the note already has definitions:

```markdown
The World population:: approx 8.3 billion[:1]

The 5 most populous countries in the world:: 

- India
- China
- United States of America
- Indonesia
- Pakistan

[:1]: k 20261016040000 1 20261015120000 2.3065 2.11810397 0 1 0
```

You can edit the definitions by hand. To reschedule a card, replace its state (the letter after `]:`) with a hint: `7d`, `2w` or `1m` (30 days) makes it due that many days ahead, and `!` picks the least loaded day 7–21 days ahead. srmd saves the new state and due date as soon as it loads the note, changing nothing else. References are reserved notation: one in the wrong place is hidden, and removed when a review saves the note; write `\[:1]` to keep it as text. Groups, continuations (`:;`), explicit clozes (`::>` … `<::`), nesting, tables, where references go and the definition fields are described in [SYNTAX.md](../../SYNTAX.md).

Optional Markdown extensions add syntax to notes; turn them on with `srmd.extensions`. `foam-placeholders` ([micromark-foam-placeholders](../../extensions/micromark-foam-placeholders/README.md)) reads notes written for Foam: block anchors (`^id`) are hidden, and wiki links and embeds show as text, `label: target` or `Link to target`.

## The Flashcards view

The **Flashcards** view in the Explorer side bar lists the open folder, its notes and the folders containing them. Each row shows its counts:

- **d**: due now, including cards seen earlier today that are due again;
- **n**: new, never reviewed;
- **l**: later, scheduled for later today or a later day.

Folder counts include every note below them. Browsing the view never opens a note, so you can pick what to review without seeing any answers: clicking only selects a note or expands a folder. Hover a row for its buttons: **Review** reviews that note or folder, and the top row reviews the whole workspace; **Edit** opens a note in the active editor group. With the keyboard, Enter reviews the selected row and Ctrl+Enter (Cmd+Enter on macOS) edits it. The row's context menu has both, and **Reveal in Explorer** for renaming, moving or deleting it there. While you edit a note, the view selects it.

The regular Explorer marks notes with cards, and the folders containing them: 🔴 when cards are due, 🔵 when only new cards are waiting, 🟢 when everything is scheduled for later. Hover for the counts. When another extension such as Git also decorates a folder, VS Code may show its generic dot in place of srmd's folder badge. The Flashcards view always shows the counts.

## Reviewing

While srmd is on:

| Command             | Where                                                | Reviews                                           |
|---------------------|------------------------------------------------------|---------------------------------------------------|
| **srmd: Review**    | Command Palette                                      | a note or folder you pick, or the whole workspace |
| **srmd: Review**    | Explorer context menu of a file or folder with cards | that file or folder                               |
| **Review** or Enter | a Flashcards view row                                | that note or folder                               |

From the Command Palette, **srmd: Review** lists the open folder and every note and folder with cards, each with its counts. Type to narrow the list: the letters only need to appear in order, so `tpa` finds `topic/a.sr.md`, and several parts separated by spaces must all match.

Cards open in a single review tab. Reviewing something else while it is open switches the tab to the new scope and skips the shown card without rating it. **srmd: Show Note**, in the tab's title bar or the context menu of the tab or the card, shows the card's note with the cursor on the card: in a tab that already has it open, otherwise beside the review. Editing the note while its card is shown drops that card's rating, with a warning. Cards seen earlier today and due again come first, then cards due from earlier days, then new cards; the order is configurable. Within each queue, notes come in the view's order and cards in their order in the note.

Each card shows the whole note with its active clozes hidden. Reveal the back, then rate the card. **Again**, **Hard**, **Good** and **Easy** are scheduled by FSRS, and each button shows its next interval. **Tomorrow**, **Soon** (3–5 days) and **Later** (7–21 days) set the interval yourself. Soon and Later pick the least loaded day in their range.

| Key | Action |
| --- | --- |
| Space | reveal the back; on the back, rate **Good**. Holding Space acts once; release it before the next press |
| Backspace | back to the front |
| Page Down / Page Up | reveal the next / previous active cloze, one at a time |
| Ctrl+F | search the note; Enter or the button moves to the next match |
| Escape | close the search |

With the mouse, click a cloze to reveal or hide it, and click the title to reveal or hide every cloze. Clicking within 30 pixels of the note's left or right edge steps to the previous or next active cloze.

Each rating is saved to the note before the next card appears. If the note changed on disk while its card was shown, for example because you edited it, the rating is not saved, so your edit is never overwritten. A warning says so, and the next card comes from the edited note. If the save fails, the review stops, an error says why, and the card stays due.

## Reading notes

While srmd is on, VS Code's Markdown preview (**Markdown: Open Preview to the Side**, Ctrl+K V) shows a note with every cloze shown, so the whole note reads cleanly. Each cloze is outlined with a faint gray border, and cloze markers, card references and definitions are hidden. Everything else is the usual preview: other extensions' syntax, such as Foam's wiki links and embeds, front matter, code highlighting and scrolling along with the editor. Other Markdown files preview as usual.

If you use Foam, turn on `foam-placeholders` (see [Settings](#settings)), so srmd reads a wiki link as a unit and never finds a cloze inside one.

## Formatting notes

While srmd is on, **Format Document** (Shift+Alt+F) tidies a note's layout, as does saving with `editor.formatOnSave`: one blank line between blocks, list content indented to its marker (`- item`, `1.  item`), `#` headings, fenced code, `---` breaks and aligned tables. What you wrote inside paragraphs, headings and table cells stays as it is, escapes, links, clozes and references included, as do Foam's wiki links and block anchors and the front matter. A card reference line moves directly below its block, and card definitions onto consecutive lines.

The `srmd.format.*` settings (see [Settings](#settings)) choose the bullet, the numbering and the table delimiter rows, and can make formatting wrap paragraphs at a line width or join each onto one line, and write emphasis with asterisks or underscores. Wrapping never breaks a code span, a link's address or a wiki link, never starts a line with something that would begin a list, heading or quote, and keeps the line break after an opener such as `Question::`.

srmd formats notes only; other Markdown files keep their formatter. If another extension, such as Prettier, is your default Markdown formatter, choose srmd with **Format Document With…**. Formatting never changes what a note shows or its cards: should it ever, the note stays as it is and a warning says so.

## Settings

| Setting                       | Default                           | Description                                                                                                                                                             |
|-------------------------------|-----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `srmd.suffixes`               | `[".sr.md"]`                      | Filename suffixes of notes.                                                                                                                                             |
| `srmd.rollover`               | `"04:00"`                         | Local time when a new review day starts, `HH:MM` or `HH:MM:SS`. Cards seen before it count toward the previous day.                                                     |
| `srmd.queueOrder`             | `["intraday", "interday", "new"]` | Order in which queues are served: cards seen earlier today and due again (`intraday`), cards due from earlier days (`interday`), and `new` cards. List each queue once. |
| `srmd.inactive.front`         | `false`                           | Show the clozes of other cards on the front of a card.                                                                                                                  |
| `srmd.inactive.back`          | `false`                           | Show the clozes of other cards on the back of a card.                                                                                                                   |
| `srmd.extensions`             | `[]`                              | Optional Markdown extensions notes are parsed and rendered with: `foam-placeholders` reads notes written for Foam.                                                      |
| `srmd.format.wrap`            | `"preserve"`                      | How formatting breaks a note's paragraph lines: `preserve` keeps them, `always` wraps them at the line width, `never` puts each paragraph on one line.                  |
| `srmd.format.lineWidth`       | `80`                              | The width lines wrap at, list markers and quote prefixes included; at least 20.                                                                                         |
| `srmd.format.numbering`       | `"increment"`                     | Numbers of ordered list items: `increment` counts up from the first, `repeat` repeats the first.                                                                        |
| `srmd.format.bullet`          | `"-"`                             | The bullet of unordered list items: `-`, `*` or `+`.                                                                                                                    |
| `srmd.format.tableDelimiters` | `"compact"`                       | Table delimiter rows: `compact` without spaces around their dashes, `padded` with them.                                                                                 |
| `srmd.format.emphasis`        | `"preserve"`                      | Emphasis delimiters: `preserve` keeps them; `asterisk` and `underscore` write those where they work, never underscores within a word.                                   |
| `srmd.format.strong`          | `"preserve"`                      | Strong emphasis delimiters, likewise.                                                                                                                                   |

Changes apply at once. Suffix, rollover, queue-order and extension changes reload the folder, display changes redraw an open review tab, and formatting settings apply at the next format. An invalid value is reported in the log, and its default is used.

## Problems and the log

The **srmd** output channel (**View: Toggle Output**, then pick *srmd*) logs notes that could not be read, failed saves, invalid settings, and problems found in notes:

- **A card definition that no cloze uses, or that repeats an earlier definition's number.** Saving a review removes such definitions. Often a reference such as `[:2]` was deleted or moved while editing, and its card would lose its scheduling. Put the reference back at the end of its card's first cloze, or delete the definition.
- **A date outside the calendar**, such as 34 August or hour 25 in a definition's due or last-review field. That card is not reviewed until you fix the date; the note's other cards are.

Notes with problems are marked so you can check them before reviewing:

- a notification with **Show Log** when the folder loads with such notes, and when a note gains a problem;
- ⚠ before the counts in the Flashcards view, on the note and on every folder containing it;
- a ⚠ badge and warning color in the Explorer, with the problems listed in the tooltip;
- a notice at the top of the review tab, listing the note's problems.

srmd never cleans up a note with problems on its own: a resolved hint is saved by changing only the state and due date in its definition. A rating you choose saves the note and removes the definitions the notice names, so fix the note first if you want to keep them.

## Limitations

- Only the first folder of a multi-root workspace is loaded; the log says so.
- Cloze highlighting in the Markdown editor is declared in the extension manifest, so it applies to every Markdown file, also while srmd is off. It only colors cloze markers, card references and card definitions.
- In the Markdown preview, a note embedded in another, such as with Foam's `![[note]]`, shows its srmd syntax: the embed does not say which file it comes from, so srmd cannot tell it is a note.

The display language follows VS Code's; English is available.

## Todo

- Handle multiple root folders in workspace.