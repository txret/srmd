# micromark-foam-placeholders

Placeholders for [Foam](https://foambubble.github.io/foam/)'s syntax in
[micromark](https://github.com/micromark/micromark), so notes written for Foam read cleanly where Foam's
features are not available:

| Foam syntax                                                                                                                                   | Rendered as                                            |
|-----------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| A block anchor, `^id`, after whitespace or a line ending at the end of a paragraph, list item, heading or table cell, or alone in a paragraph | nothing                                                |
| A wiki link or embed with a label: `[[Physiology#Heart\|the heart]]`, `![[ecg.png\|300]]`                                                     | the text `the heart: Physiology#Heart`, `300: ecg.png` |
| A wiki link or embed without a label: `[[Physiology]]`, `![[Pharmacology]]`                                                                   | `Link to Physiology`, `Link to Pharmacology`           |

Nothing is resolved and no embedded content is inserted. Tags, `#tag`, are ordinary text already. In a GFM
table, write the divider `\|`, as in Foam. Code, and a backslash before the first bracket, as in `\[[note]]`,
keep a link literal.

```js
import { micromark } from 'micromark'
import { foam_placeholders, foam_placeholders_html } from 'micromark-foam-placeholders'

micromark('See [[Physiology#Heart|the heart]]. ^note', {
  extensions: [foam_placeholders()], htmlExtensions: [foam_placeholders_html()]
})
// <p>See the heart: Physiology#Heart. </p>
```

In srmd, the VS Code host turns it on with the `srmd.extensions` setting, `["foam-placeholders"]`.

Tests: `npm test` in this directory.
