package opensource.txret.srmd

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import java.io.FileNotFoundException
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap

/** A file below the notes folder: its path, modification time in milliseconds and size in bytes. */
data class FileEntry(val path: String, val mtime: Long, val size: Long)

/** A file's text with the modification time and size the file had when it was read. */
data class FileText(val text: String, val mtime: Long, val size: Long)

/** A document's modification time in milliseconds and size in bytes; 0 where its provider reports none. */
data class Stat(val mtime: Long, val size: Long)

/**
 * The notes folder through the Storage Access Framework: listing, reading and writing its files by workspace-relative
 * path (see Paths.kt). Each path maps to a document id. The last scan's ids serve later calls; a path it did not list,
 * such as a file synced since, is looked up name by name. Every call does I/O, so callers stay off the UI thread.
 */
class NoteStorage(private val resolver: ContentResolver) {
    /** The notes folder's tree URI, or null before one is picked; a new folder forgets the old one's ids. */
    @Volatile
    var root: Uri? = null
        set(value) {
            field = value
            ids = ConcurrentHashMap()
        }

    /** Document ids by path: the last scan's files and folders, and paths looked up since. */
    @Volatile
    private var ids = ConcurrentHashMap<String, String>()

    /** A child document of a folder, as one query lists it. */
    private data class Child(val id: String, val name: String, val folder: Boolean, val mtime: Long, val size: Long)

    /** The notes folder's tree URI; refused as `no_root` before one is picked. */
    private fun tree(): Uri = root ?: throw BridgeException("no_root", "No notes folder is chosen")

    /** The notes folder's name, as the picker shows it. */
    fun name(): String {
        val tree = tree()
        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        resolver.query(uri, arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst() && !it.isNull(0)) return it.getString(0)
        }
        return tree.lastPathSegment ?: "notes"
    }

    /**
     * Every file below the notes folder, folder by folder with one query each, skipping files and folders whose names
     * match a pattern of [skip] (see skipPattern()). The listing's ids replace the previous scan's.
     */
    fun scan(skip: List<String>): List<FileEntry> {
        /* Walk breadth first from the root, recording each kept path's id and each file's entry. */
        val tree = tree()
        val patterns = skip.map(::skipPattern)
        val found = ConcurrentHashMap<String, String>()
        val entries = mutableListOf<FileEntry>()
        val folders = ArrayDeque(listOf("" to DocumentsContract.getTreeDocumentId(tree)))
        while (folders.isNotEmpty()) {
            val (folder, id) = folders.removeFirst()
            for (child in children(tree, id)) {
                if (patterns.any { it.matches(child.name) }) continue
                val path = childPath(folder, child.name)
                found[path] = child.id
                if (child.folder) folders.addLast(path to child.id) else entries.add(FileEntry(path, child.mtime, child.size))
            }
        }
        ids = found
        return entries
    }

    /**
     * The file's text, decoded as UTF-8, with the time and size it had. A file written while it is read could pair one
     * version's text with another's time, so the time is checked before and after, reading again when they differ.
     */
    fun read(path: String): FileText = withDocument(path) { uri ->
        var attempts = 0
        var text: FileText
        do {
            val before = stat(uri)
            val bytes = content(uri, path)
            val after = stat(uri)
            text = FileText(decodeText(bytes), after.mtime, after.size)
            attempts++
        } while (before != after && attempts < 3)
        text
    }

    /**
     * The file's text, decoded as UTF-8, without asking its time and size: for loading notes after a scan, which listed
     * them. Unlike read(), it adds no provider queries to the content read.
     */
    fun load(path: String): String = withDocument(path) { uri -> decodeText(content(uri, path)) }

    /** The bytes of the document at [uri], the file at [path]. */
    private fun content(uri: Uri, path: String): ByteArray =
        resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw BridgeException("io", "Cannot open $path")

    /**
     * Replace the file's text, encoded as UTF-8. With [expectedMtime], a file whose time differs, changed since the text
     * the write is based on was read, is refused as `conflict` and left as it is. Returns the file's new time and size.
     */
    fun write(path: String, text: String, expectedMtime: Long?): Stat = withDocument(path) { uri ->
        if (expectedMtime != null && stat(uri).mtime != expectedMtime) throw BridgeException("conflict", "$path changed since it was read")
        openForWriting(uri).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        stat(uri)
    }

    /** The document of the file at [path]; refused as `not_found` when there is none below the notes folder. */
    fun document(path: String): Uri {
        val tree = tree()
        val names = pathNames(path) ?: throw BridgeException("not_found", "No file $path")
        return DocumentsContract.buildDocumentUriUsingTree(tree, ids[path] ?: lookUp(tree, names, path))
    }

    /** The MIME type its provider gives a document, for apps opening it; null when unknown. */
    fun type(uri: Uri): String? = resolver.getType(uri)

    /**
     * Run [action] on the document of [path]. A scan's id may be stale, as when a sync replaced the file, so a
     * document not found is looked up again by name once.
     */
    private fun <T> withDocument(path: String, action: (Uri) -> T): T {
        val uri = document(path)
        return try {
            action(uri)
        } catch (error: FileNotFoundException) {
            if (ids.remove(path) == null) throw error
            action(document(path))
        }
    }

    /** The id of the document at [path], found folder by folder from the root by name, keeping the ids found. */
    private fun lookUp(tree: Uri, names: List<String>, path: String): String {
        var id = DocumentsContract.getTreeDocumentId(tree)
        var current = ""
        for (name in names) {
            current = childPath(current, name)
            id = ids[current] ?: children(tree, id).firstOrNull { it.name == name }?.id?.also { ids[current] = it }
                ?: throw BridgeException("not_found", "No file $path")
        }
        return id
    }

    /** The children of the folder with document id [folderId], with their names, types, times and sizes. */
    private fun children(tree: Uri, folderId: String): List<Child> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, folderId)
        val projection = arrayOf(
            Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
            Document.COLUMN_LAST_MODIFIED, Document.COLUMN_SIZE
        )
        val cursor = resolver.query(uri, projection, null, null, null) ?: throw BridgeException("io", "Cannot list a folder")
        return cursor.use {
            buildList {
                while (it.moveToNext()) {
                    val mtime = if (it.isNull(3)) 0L else it.getLong(3)
                    val size = if (it.isNull(4)) 0L else it.getLong(4)
                    add(Child(it.getString(0), it.getString(1), it.getString(2) == Document.MIME_TYPE_DIR, mtime, size))
                }
            }
        }
    }

    /** A document's current time and size. */
    private fun stat(uri: Uri): Stat {
        resolver.query(uri, arrayOf(Document.COLUMN_LAST_MODIFIED, Document.COLUMN_SIZE), null, null, null)?.use {
            if (it.moveToFirst()) return Stat(if (it.isNull(0)) 0L else it.getLong(0), if (it.isNull(1)) 0L else it.getLong(1))
        }
        throw FileNotFoundException("No document $uri")
    }

    /**
     * A stream replacing the document's content. Mode `wt` truncates; providers without it are tried with `rwt`. Plain
     * `w` is never used: some providers leave the old content's end in place with it.
     */
    private fun openForWriting(uri: Uri): OutputStream {
        for (mode in listOf("wt", "rwt")) {
            try {
                resolver.openOutputStream(uri, mode)?.let { return it }
            } catch (_: IllegalArgumentException) {
                // The provider does not support this mode; try the next.
            } catch (_: UnsupportedOperationException) {
            }
        }
        throw BridgeException("io", "Cannot write $uri")
    }
}
