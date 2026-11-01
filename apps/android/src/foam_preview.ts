// Foam's preview pipeline from the Foam submodule, which package.json's "#foam-preview" import names. Bundles and Node
// load this file; TypeScript, whose settings are stricter than Foam's, reads foam_preview_types.d.ts instead.
export { createFoamMarkdownIt } from '../../../foam/packages/foam-vscode/src/vscode/features/preview/foam-markdown-it'
