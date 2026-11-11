const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { hashPassword } = require('./passwords');

const dataDirectory = path.resolve(process.env.SCHOOL_DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(dataDirectory, { recursive: true });

const database = new Database(path.join(dataDirectory, 'school.sqlite'));
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'student')),
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS public_results (
        id INTEGER PRIMARY KEY,
        class_level INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 12),
        exam TEXT NOT NULL,
        academic_year TEXT NOT NULL,
        students_appeared INTEGER NOT NULL CHECK (students_appeared BETWEEN 1 AND 100000),
        students_passed INTEGER NOT NULL CHECK (students_passed BETWEEN 0 AND students_appeared),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

async function createUser(email, role, password) {
    const { salt, hash } = await hashPassword(password);
    const result = database.prepare(
        'INSERT INTO users (email, role, password_salt, password_hash) VALUES (?, ?, ?, ?)'
    ).run(email, role, salt, hash);
    return Number(result.lastInsertRowid);
}

module.exports = { database, createUser };
