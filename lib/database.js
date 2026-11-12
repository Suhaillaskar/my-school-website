const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { hashPassword } = require('./passwords');

const schema = [
    `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'student')),
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)',
    `CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS public_results (
        id INTEGER PRIMARY KEY,
        class_level INTEGER NOT NULL CHECK (class_level BETWEEN 1 AND 12),
        exam TEXT NOT NULL,
        academic_year TEXT NOT NULL,
        students_appeared INTEGER NOT NULL CHECK (students_appeared BETWEEN 1 AND 100000),
        students_passed INTEGER NOT NULL CHECK (students_passed BETWEEN 0 AND students_appeared),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
];

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();
if (Boolean(tursoUrl) !== Boolean(tursoAuthToken)) {
    throw new Error('Set both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, or unset both to use local SQLite.');
}
if (process.env.VERCEL && !tursoUrl) {
    throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel to use persistent database storage.');
}

const isRemote = Boolean(tursoUrl);
let localDatabase;
let client;
let initialization;

if (isRemote) {
    client = createClient({ url: tursoUrl, authToken: tursoAuthToken, intMode: 'number' });
} else {
    const LocalDatabase = require('better-sqlite3');
    const dataDirectory = path.resolve(process.env.SCHOOL_DATA_DIR || path.join(__dirname, '..', 'data'));
    fs.mkdirSync(dataDirectory, { recursive: true });
    localDatabase = new LocalDatabase(path.join(dataDirectory, 'school.sqlite'));
    localDatabase.pragma('journal_mode = WAL');
    localDatabase.pragma('foreign_keys = ON');
    localDatabase.exec(schema.join(';'));
    initialization = Promise.resolve();
}

async function initialize() {
    if (!initialization) {
        initialization = (async () => {
            for (const statement of schema) {
                await client.execute(statement);
            }
        })().catch((error) => {
            initialization = undefined;
            throw error;
        });
    }
    return initialization;
}

function remoteRow(result, row) {
    if (!row) return undefined;
    return Object.fromEntries(result.columns.map((column, index) => [column, row[index]]));
}

const database = {
    isRemote,
    initialize,
    async get(sql, ...args) {
        await initialize();
        if (!isRemote) return localDatabase.prepare(sql).get(...args);
        const result = await client.execute({ sql, args });
        return remoteRow(result, result.rows[0]);
    },
    async all(sql, ...args) {
        await initialize();
        if (!isRemote) return localDatabase.prepare(sql).all(...args);
        const result = await client.execute({ sql, args });
        return result.rows.map((row) => remoteRow(result, row));
    },
    async run(sql, ...args) {
        await initialize();
        if (!isRemote) return localDatabase.prepare(sql).run(...args);
        const result = await client.execute({ sql, args });
        return {
            changes: Number(result.rowsAffected),
            lastInsertRowid: Number(result.lastInsertRowid || 0)
        };
    },
    async batch(statements) {
        await initialize();
        if (!isRemote) throw new Error('Batch imports are only supported by the remote database adapter.');
        return client.batch(statements.map(({ sql, args = [] }) => ({ sql, args })), 'write');
    },
    close() {
        if (localDatabase?.open) localDatabase.close();
        client?.close();
    },
    get open() {
        return localDatabase?.open ?? true;
    }
};

async function createUser(email, role, password) {
    const { salt, hash } = await hashPassword(password);
    const result = await database.run(
        'INSERT INTO users (email, role, password_salt, password_hash) VALUES (?, ?, ?, ?)',
        email, role, salt, hash
    );
    return Number(result.lastInsertRowid);
}

module.exports = { database, createUser };
