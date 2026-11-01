// markdown-it's rule for link reference definitions, which its package exports by path but its types do not declare.
declare module 'markdown-it/lib/rules_block/reference.mjs' {
  import type { StateBlock } from 'markdown-it'
  /** The rule: read link reference definitions starting at a line, into the environment's references. */
  export default function reference(state: StateBlock, start_line: number, end_line: number, silent: boolean): boolean
}
