/**
 * Node's readFileSync() as Foam's embed plugin calls it, which the bundle gives it for `fs`: markdown-it renders
 * synchronously, while the app reads files through the shell, so Foam.prepare() keeps the texts an embed needs here
 * beforehand, by Foam's file path (`/topic/b.md`).
 */

/** The texts of the files prepared, by Foam's file path. */
export const texts = new Map<string, string>()

/** A file's text as readFileSync() returns it; one not prepared throws, which Foam's embed plugin shows as nothing. */
export function readFileSync(path: string): { toString(): string } {
  const text = texts.get(path)
  if (text === undefined) throw new Error(`${path} was not read before rendering`)
  return { toString: () => text }
}
