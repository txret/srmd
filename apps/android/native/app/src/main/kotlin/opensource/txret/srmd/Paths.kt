package opensource.txret.srmd

/**
 * Workspace-relative paths, as the web app names files: slash-separated names below the notes folder, such as
 * `topic/a.sr.md`; the empty path is the folder itself.
 */

/** The path of [name] in the folder at [folder]. */
fun childPath(folder: String, name: String): String = if (folder.isEmpty()) name else "$folder/$name"

/**
 * The names along [path], or null when it names nothing below the notes folder: empty names, `.` and `..` would lead
 * elsewhere, so a path from the page can never reach outside the folder.
 */
fun pathNames(path: String): List<String>? {
    val names = path.split('/')
    return if (path.isEmpty() || names.any { it.isEmpty() || it == "." || it == ".." }) null else names
}

/**
 * A skip [pattern] as an expression matching whole file and folder names: `*` stands for any characters, everything
 * else for itself, ignoring case. The web app's settings hold the patterns, such as `.*` for hidden files; a scan
 * compiles them once for all the names it lists.
 */
fun skipPattern(pattern: String): Regex =
    Regex(pattern.split('*').joinToString(".*") { Regex.escape(it) }, RegexOption.IGNORE_CASE)

/** Text decoded from UTF-8 [bytes], without a leading byte order mark, as VS Code's file reads decode it. */
fun decodeText(bytes: ByteArray): String {
    val text = bytes.toString(Charsets.UTF_8)
    return if (text.startsWith('﻿')) text.substring(1) else text
}
