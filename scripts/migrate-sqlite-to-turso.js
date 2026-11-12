const fs = require('node:fs');
const path = require('node:path');
const LocalDatabase = require('better-sqlite3');
const { database } = require('../lib/database');

async function main() {
    if (!database.isRemote) {
        throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before running this migration.');
    }

    const sourceFile = path.resolve(process.argv[2] || process.env.SCHOOL_SQLITE_FILE || '');
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
        throw new Error('Provide the path to the existing school.sqlite file.');
    }

    const source = new LocalDatabase(sourceFile, { readonly: true, fileMustExist: true });
    try {
        const users = source.prepare(
            'SELECT id, email, role, password_salt, password_hash, created_at FROM users ORDER BY id'
        ).all();
        const notices = source.prepare(
            'SELECT id, category, title, body, created_at FROM notices ORDER BY id'
        ).all();
        const results = source.prepare(`
            SELECT id, class_level, exam, academic_year, students_appeared, students_passed, created_at
            FROM public_results ORDER BY id
        `).all();

        for (const table of ['users', 'notices', 'public_results']) {
            const existing = await database.get(`SELECT COUNT(*) AS count FROM ${table}`);
            if (Number(existing.count) !== 0) {
                throw new Error(`Turso table "${table}" is not empty. Migration stopped without importing data.`);
            }
        }

        const statements = [
            ...users.map((user) => ({
                sql: `INSERT INTO users (id, email, role, password_salt, password_hash, created_at)
                      VALUES (?, ?, ?, ?, ?, ?)`,
                args: [user.id, user.email, user.role, user.password_salt, user.password_hash, user.created_at]
            })),
            ...notices.map((notice) => ({
                sql: `INSERT INTO notices (id, category, title, body, created_at)
                      VALUES (?, ?, ?, ?, ?)`,
                args: [notice.id, notice.category, notice.title, notice.body, notice.created_at]
            })),
            ...results.map((result) => ({
                sql: `INSERT INTO public_results (
                          id, class_level, exam, academic_year, students_appeared, students_passed, created_at
                      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    result.id, result.class_level, result.exam, result.academic_year,
                    result.students_appeared, result.students_passed, result.created_at
                ]
            }))
        ];

        if (statements.length) await database.batch(statements);
        console.log(`Migrated ${users.length} accounts, ${notices.length} notices, and ${results.length} results.`);
        console.log('Existing sessions were not migrated; users will need to sign in again.');
    } finally {
        source.close();
        database.close();
    }
}

main().catch((error) => {
    console.error(`SQLite to Turso migration failed: ${error.message}`);
    process.exitCode = 1;
});
