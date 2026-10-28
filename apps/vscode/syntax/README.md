# Editor syntax scopes

The grammar selects complete srmd cloze markers, card references and single-line
card definitions (see [SYNTAX.md](../../../SYNTAX.md)). Each selection has one scope,
without separate scopes for its parts. Cloze contents use ordinary Markdown
highlighting. Headings are not highlighted, since srmd syntax is literal text there.

| Selection | TextMate scope |
| --- | --- |
| Opening and closing markers (`::`, `:;`, `::>`, `<::`, `<:;`, etc.) | `punctuation.definition.srmd.markdown` |
| Card references, such as `[:1]` | `comment.other.card-reference.srmd.markdown` |
| Complete single-line card definitions, such as `[:1]: k 20261012040000 7` | `comment.line.card-definition.srmd.markdown` |

References and definitions inherit the active theme's comment styling. For custom
colors, add rules like these to VS Code's `settings.json`:

```json
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "scope": "punctuation.definition.srmd.markdown",
        "settings": { "foreground": "#D7BA7D", "fontStyle": "bold" }
      },
      {
        "scope": [
          "comment.other.card-reference.srmd.markdown",
          "comment.line.card-definition.srmd.markdown"
        ],
        "settings": { "foreground": "#737373", "fontStyle": "" }
      }
    ]
  }
}
```

Use **Developer: Inspect Editor Tokens and Scopes** to inspect a selection.
Highlighting recognizes syntax without pairing cloze markers or checking which
card owns a reference. Code and escaped characters retain their literal meaning.
