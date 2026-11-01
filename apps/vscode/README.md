# srmd for VS Code

A note-taking first spaced repetition Markdown extension for VS Code. Mark the answers in a note as clozes, and each cloze group becomes a flashcard. The Markdown notes are parsed with [markdown-it](https://github.com/markdown-it/markdown-it) and srmd's plugin for it, together with the markdown-it plugins of your other extensions, such as [Foam](https://foambubble.github.io/foam/)'s wiki links and embeds, in the preview and in reviews alike. Reviews are scheduled with [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), the TS implementation of the [FSRS algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm).

Note taking comes first: a note stays readable Markdown, with srmd's unobtrusive syntax marking its clozes and the FSRS scheduling stored in the note itself. The [README](../../README.md) introduces the syntax, and [SYNTAX.md](../../SYNTAX.md) defines it. There is no database or srmd service. Notes move, rename and sync with whatever you already use, such as Git or Syncthing. Loading a note never rewrites it; only a review, or a manual scheduling hint you wrote, saves it.

## Turning it on

srmd is **off** in every workspace until you turn it on, so opening a code project costs nothing: no files are searched or watched, and there is no Flashcards view, badge or menu entry. Only a status bar item shows, `⊘ srmd` on the right.

In a folder of notes, turn it on with **srmd: Turn On** from the Command Palette, or by clicking the status bar item. srmd then loads the folder's notes, shows the Flashcards view and the Explorer badges, and watches the folder for changes. It stays on for that workspace, also after a restart.

**srmd: Turn Off**, or another click on the status bar item, unloads everything again: the view and badges disappear, an open review tab closes, and watching stops.

Both write the `srmd.enabled` setting to the workspace settings, which creates `.vscode/settings.json` in the folder if it does not exist. Committed with your notes, it turns srmd on wherever you open them. To turn srmd on in every workspace, set `srmd.enabled` to `true` in your user settings. A workspace that turns it off still overrides that. You can hide the status bar item from the status bar's context menu.

## Writing cards

Notes are files ending in `.sr.md` (configurable), with clozes and card definitions as [SYNTAX.md](../../SYNTAX.md) describes; you can edit the definitions by hand, and reschedule a card with a hint, which srmd saves as soon as it loads the note, changing nothing else.

srmd adds only its own syntax. What other extensions add to VS Code's Markdown preview shows in reviews too: with the [Foam](https://foambubble.github.io/foam/) extension installed, a review shows Foam's wiki links (`[[note]]`, `[[note#Section|label]]`), embeds (`![[note]]`, `![[diagram.png]]`) and block anchors (`^id`) as Foam's preview does, and clicking a link opens its file in the editor. An embedded note shows its content, its clozes outlined and never part of the card under review. Without Foam, they show as the text they are. How srmd's syntax and Foam's meet is described in [SYNTAX.md](../../SYNTAX.md#foam-syntax).

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

From the Command Palette, **srmd: Review** lists the open folder and every note and folder with cards, each with its counts. Type to narrow the list to the rows whose path matches.

Cards open in a single review tab. For its first card, srmd activates the extensions that add markdown-it plugins to VS Code's preview and composes their plugins as the preview does, ordered by extension id, with the preview's line break, link and typography settings; reviews then parse, show and save notes with that. An extension whose plugin fails is left out of reviews, and a warning offers the log, which says why. Reviewing something else while it is open switches the tab to the new scope and skips the shown card without rating it. **srmd: Show Note**, in the tab's title bar or the context menu of the tab or the card, shows the card's note with the cursor on the card: in a tab that already has it open, otherwise beside the review. Editing the note while its card is shown drops that card's rating, with a warning. Cards seen earlier today and due again come first, then cards due from earlier days, then new cards; the order is configurable. Within each queue, notes come in the view's order and cards in their order in the note.

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

While srmd is on, VS Code's Markdown preview (**Markdown: Open Preview to the Side**, Ctrl+K V) shows a note with every cloze shown, so the whole note reads cleanly. Each cloze is outlined with a faint gray border, and cloze markers, card references and definitions are hidden. Everything else is the usual preview: other extensions' syntax, front matter, code highlighting and scrolling along with the editor. Other Markdown files preview as usual.

With Foam installed, Foam's preview shows wiki links and embeds; without it, they are text. The clozes of what a note embeds, a note or other Markdown, are outlined too, but belong to no card.

## Settings

| Setting                       | Default                           | Description                                                                                                                                                             |
|-------------------------------|-----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `srmd.suffixes`               | `[".sr.md"]`                      | Filename suffixes of notes.                                                                                                                                             |
| `srmd.rollover`               | `"04:00"`                         | Local time when a new review day starts, `HH:MM` or `HH:MM:SS`. Cards seen before it count toward the previous day.                                                     |
| `srmd.queueOrder`             | `["intraday", "interday", "new"]` | Order in which queues are served: cards seen earlier today and due again (`intraday`), cards due from earlier days (`interday`), and `new` cards. List each queue once. |
| `srmd.inactive.front`         | `false`                           | Show the clozes of other cards on the front of a card.                                                                                                                  |
| `srmd.inactive.back`          | `false`                           | Show the clozes of other cards on the back of a card.                                                                                                                   |

Changes apply at once. Suffix changes reload the folder, rollover and queue-order changes apply to the notes loaded, and display changes redraw an open review tab. An invalid value is reported in the log, and its default is used.

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
- Reviews use other extensions' markdown-it plugins, but not their preview scripts and stylesheets, nor VS Code's code highlighting.

The display language follows VS Code's; English is available.

## Todo

- Handle multiple root folders in workspace.