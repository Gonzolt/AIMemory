-- AIMemory SQLite schema. Rebuildable from canonical markdown files
-- in memories/ at any time — no data is authoritative here.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memories (
    id          TEXT PRIMARY KEY,        -- stable slug
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,           -- markdown body (no front-matter)
    path        TEXT NOT NULL UNIQUE,    -- absolute path on disk
    created     TEXT NOT NULL,           -- ISO-8601
    updated     TEXT NOT NULL,           -- ISO-8601
    agents      TEXT,                    -- JSON array
    projects    TEXT,                    -- JSON array
    tags        TEXT,                    -- JSON array
    status      TEXT DEFAULT 'active',
    confidence  TEXT DEFAULT 'medium',
    file_mtime  REAL
);
CREATE INDEX IF NOT EXISTS idx_memories_type    ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated);
CREATE INDEX IF NOT EXISTS idx_memories_status  ON memories(status);

CREATE TABLE IF NOT EXISTS edges (
    src   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    dst   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    kind  TEXT NOT NULL,
    PRIMARY KEY (src, dst, kind)
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    id UNINDEXED,
    title,
    body,
    tokenize = "porter unicode61 remove_diacritics 2"
);

CREATE TABLE IF NOT EXISTS code_files (
    path        TEXT PRIMARY KEY,
    project     TEXT NOT NULL,
    language    TEXT,
    size_bytes  INTEGER,
    mtime       REAL,
    indexed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_code_files_project ON code_files(project);

CREATE TABLE IF NOT EXISTS code_chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT NOT NULL REFERENCES code_files(path) ON DELETE CASCADE,
    project     TEXT NOT NULL,
    line_start  INTEGER NOT NULL,
    line_end    INTEGER NOT NULL,
    body        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_chunks_path    ON code_chunks(path);
CREATE INDEX IF NOT EXISTS idx_code_chunks_project ON code_chunks(project);

CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
    chunk_id UNINDEXED,
    path,
    project,
    body,
    tokenize = "porter unicode61 remove_diacritics 2"
);
