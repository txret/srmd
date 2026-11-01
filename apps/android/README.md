# srmd for Android

Read, review and edit your srmd notes on an Android phone or tablet. The app works on the notes folder you already have,
synced to the device by your own tool, such as Syncthing or Git: there is no database or srmd service, and the app works
offline. It has no network access at all and asks for no permissions; it reads only the folder you choose. Notes are
the same files as in VS Code, with clozes and scheduling written as [SYNTAX.md](../../SYNTAX.md) describes, so a review
on the phone continues where the last one on the computer stopped, and the other way round.

## First start

The app asks for the folder holding your notes. Choose it in Android's folder picker and allow access; the app keeps
that access until you choose another folder. It then lists every file in the folder and loads the notes, the files
ending in `.sr.md`. Swipe right for your notes.

## Reading

A file fills the screen. Notes and other Markdown files show rendered, with every cloze outlined and none hidden, so the
note reads as a whole with its answers marked. Images in the notes folder show in the note; images linked from the
web do not, as the app does not go online. Text files, such as `.txt` or `.csv`, show as they are. Other files, such as
images and PDFs, open in the app that handles them on your device.

- **Swipe right** for the drawer: the folder's files as a tree, folders first. Notes show their cards' counts,
  `d<n> • n<n> • l<n>` for due, new and later, and folders the counts of all notes below them; `⚠` marks notes with
  problems to check before reviewing. Tap a folder to open or close it, a file to show it. **Swipe left** or tap the
  note beside the drawer to close it.
- **Search all files** at the bottom of the drawer: the tree shows only the files whose name or text matches, with the
  number of matches in their text.
- **Swipe up** from the strip at the bottom of the screen, or tap it, to search the shown file. The arrows move between
  the matches. In the editor, the same opens the editor's search, which can also replace.
- **Links** open the file they point to over the current one, and Back returns. Web links open in your browser.
  [Foam](https://foambubble.github.io/foam/)'s wiki links (`[[note]]`) show the title of the note they point to and
  open it the same way, and embeds (`![[note]]`, `![[diagram.png]]`) show the note or image in place, its clozes
  outlined but never part of a card. Block anchors (`^id`) are hidden.

## Reviewing

Tap the play button beside a note or folder in the drawer, or the one in the drawer's bottom bar for the shown note.
Cards come one at a time, as in the VS Code review tab: tap **Back** to see the answer, then rate the card. The rating
is saved in the note at once. When no card is left, the app shows the note reviewed last.

If the note changed while its card was shown, for instance by a sync, the rating is not saved, so nothing you wrote
elsewhere is lost; the app says so and goes on with the note as it is now.

## Editing

The Markdown symbol in the drawer's bottom bar switches the shown file to the editor; the eye switches back. Leaving the
editor with changes, by the eye, Back or opening another file, asks whether to **Save**, **Discard** them or **Keep
editing**. If the file changed since you started editing, the app does not save over it unless you say so.

If Android closes the app in the background while you edit, your changes come back unsaved in the editor the next time
you open it.

## Back

Back closes whatever you opened last: a question, the settings, a search in the drawer, the drawer, the search of the
file, a review, the editor or a file opened from a link. With nothing open, Back leaves the app.

## Settings

The cogwheel in the drawer's bottom bar opens the settings:

| Setting                                    | Default                                                         |
|--------------------------------------------|-----------------------------------------------------------------|
| Notes folder, and **Rescan now**           | Chosen at the first start                                       |
| Note suffixes                              | `.sr.md`                                                        |
| Opened as Markdown                         | `.md`, `.markdown` and other Markdown extensions                |
| Opened as plain text                       | `.txt`, `.csv`, `.json`, `.yaml` and other text extensions      |
| Skipped names                              | `.*` (hidden files and folders, such as `.git`), `node_modules` |
| The review day starts at                   | 04:00                                                           |
| Order of cards                             | Again today, due, new                                           |
| Show the note's other clozes on each face  | Off                                                             |

The review settings are those of the VS Code extension, so both apps schedule alike. The log
at the bottom lists notes the app could not read, failed saves and dropped ratings.

## Keeping up with the folder

Android does not tell the app when a sync changes the folder, so the app looks at the whole folder when it starts, when
you return to it after 15 minutes or more, and when you tap **Rescan now**. The file shown is read again whenever you
open it or return to the app, and a note always before its card is shown and before a rating or an edit is saved, so
the app never saves over a change it has not seen.

## Requirements

Android 10 or later, with an up-to-date Android System WebView. Build the app as described in the repository's
[README](../../README.md#building-the-android-app).
