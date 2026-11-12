const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { database, createUser } = require('./lib/database');
const { hashPassword, isValidPassword, verifyPassword } = require('./lib/passwords');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const PUBLIC_DIRECTORY = path.join(__dirname, 'public');
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const configuredSessionSecret = typeof process.env.SESSION_SECRET === 'string' ? process.env.SESSION_SECRET.trim() : '';
const SESSION_SECRET = configuredSessionSecret || crypto.randomBytes(32).toString('hex');
const loginAttempts = new Map();
const PUBLIC_PAGES = new Set([
    'index.html', 'about.html', 'academics.html', 'admission.html',
    'gallery.html', 'notices.html', 'results.html', 'contact.html',
    'admin-login.html', 'student-login.html'
]);
const ROLES = new Set(['admin', 'student']);

if (process.env.NODE_ENV === 'production' && !process.env.VERCEL && !configuredSessionSecret) {
    console.warn('SESSION_SECRET is unset; using a temporary random value for this process. Set a persistent secret in the hosting environment to avoid signing users out after restarts.');
}
if (process.env.VERCEL && !configuredSessionSecret) {
    throw new Error('Set SESSION_SECRET in Vercel before deploying the production site.');
}
if (configuredSessionSecret && configuredSessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.');
}

app.disable('x-powered-by');
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production';
app.set('trust proxy', trustProxy);
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    });
    next();
});
app.use((req, res, next) => {
    database.initialize().then(() => next(), next);
});
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use('/css', express.static(path.join(PUBLIC_DIRECTORY, 'css'), { fallthrough: false, index: false }));
app.use('/images', express.static(path.join(PUBLIC_DIRECTORY, 'images'), { fallthrough: false, index: false }));
app.use('/js', express.static(path.join(PUBLIC_DIRECTORY, 'js'), { fallthrough: false, index: false }));

app.get('/health', async (req, res) => {
    await database.get('SELECT 1');
    return res.status(200).json({ status: 'ok' });
});

function sessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_TTL_SECONDS * 1000
    };
}

function getCookie(req, name) {
    const prefix = `${name}=`;
    const item = (req.headers.cookie || '').split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix));
    return item ? item.slice(prefix.length) : '';
}

function sessionTokenHash(token) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

async function authenticate(req, res, next) {
    try {
        const token = getCookie(req, 'school_session');
        if (!/^[a-f\d]{64}$/i.test(token)) {
            return res.status(401).json({ error: 'Please sign in to continue.' });
        }
        const tokenHash = sessionTokenHash(token);
        const session = await database.get(`
            SELECT users.id, users.email, users.role, sessions.expires_at
            FROM sessions JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        `, tokenHash, Math.floor(Date.now() / 1000));
        if (!session) {
            const options = sessionCookieOptions();
            delete options.maxAge;
            res.clearCookie('school_session', options);
            return res.status(401).json({ error: 'Please sign in to continue.' });
        }
        req.user = session;
        req.sessionTokenHash = tokenHash;
        return next();
    } catch (error) {
        return next(error);
    }
}

function requirePortalPage(role) {
    return async (req, res, next) => {
        try {
            res.set('Cache-Control', 'no-store');
            const token = getCookie(req, 'school_session');
            const tokenHash = /^[a-f\d]{64}$/i.test(token) ? sessionTokenHash(token) : '';
            const session = tokenHash && await database.get(`
                SELECT users.id, users.email, users.role, sessions.expires_at
                FROM sessions JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            `, tokenHash, Math.floor(Date.now() / 1000));
            if (!session) {
                const options = sessionCookieOptions();
                delete options.maxAge;
                res.clearCookie('school_session', options);
                return res.redirect(role === 'admin' ? '/admin-login.html' : '/student-login.html');
            }
            if (session.role !== role) {
                return res.redirect(session.role === 'admin' ? '/admin' : '/student');
            }
            req.user = session;
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

function requireRole(role) {
    return (req, res, next) => authenticate(req, res, (error) => {
        if (error) return next(error);
        if (res.headersSent) return;
        if (req.user.role !== role) return res.status(403).json({ error: 'You do not have permission to access this page.' });
        return next();
    });
}

function isSameOrigin(req, res) {
    const origin = req.get('origin');
    const host = req.get('host');
    if (origin) {
        let parsedOrigin;
        try {
            parsedOrigin = new URL(origin);
        } catch {
            res.status(403).json({ error: 'Request origin was not accepted.' });
            return false;
        }
        const sameHost = parsedOrigin.host.toLowerCase() === (host || '').toLowerCase();
        const secureProductionOrigin = process.env.NODE_ENV === 'production' && parsedOrigin.protocol === 'https:';
        const sameDevelopmentOrigin = process.env.NODE_ENV !== 'production' && parsedOrigin.protocol === `${req.protocol}:`;
        if (!sameHost || (!secureProductionOrigin && !sameDevelopmentOrigin)) {
            res.status(403).json({ error: 'Request origin was not accepted.' });
            return false;
        }
    }
    return true;
}

function requestLoginLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip;
    const attempts = loginAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
    if (attempts.resetAt <= now) {
        attempts.count = 0;
        attempts.resetAt = now + 15 * 60 * 1000;
    }
    if (attempts.count >= 10) return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
    attempts.count += 1;
    loginAttempts.set(key, attempts);
    if (loginAttempts.size > 5000) {
        for (const [address, entry] of loginAttempts) {
            if (entry.resetAt <= now) loginAttempts.delete(address);
        }
    }
    return next();
}

function validEmail(email) {
    return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validText(value, maxLength) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

async function clearSession(req, res) {
    const token = getCookie(req, 'school_session');
    if (/^[a-f\d]{64}$/i.test(token)) {
        await database.run('DELETE FROM sessions WHERE token_hash = ?', sessionTokenHash(token));
    }
    const options = sessionCookieOptions();
    delete options.maxAge;
    res.clearCookie('school_session', options);
}

function servePage(file) {
    const root = file.startsWith('views/') || file.startsWith(`views${path.sep}`) ? __dirname : PUBLIC_DIRECTORY;
    return (req, res, next) => res.sendFile(path.join(root, file), (error) => error && next(error));
}

app.get('/', (req, res) => res.redirect('/index.html'));
app.get('/:page', (req, res, next) => {
    if (!PUBLIC_PAGES.has(req.params.page)) return next();
    return servePage(req.params.page)(req, res, next);
});

app.get('/admin', requirePortalPage('admin'), (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return servePage('views/admin.html')(req, res, next);
});
app.get('/student', requirePortalPage('student'), (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return servePage('views/student.html')(req, res, next);
});

app.post('/api/login/:role', requestLoginLimit, async (req, res, next) => {
    if (!isSameOrigin(req, res)) return;
    const formSubmission = req.is('application/x-www-form-urlencoded');
    const { role } = req.params;
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!ROLES.has(role) || !validEmail(email) || password.length > 128) {
        if (formSubmission) return res.redirect(303, `/${role === 'admin' ? 'admin' : 'student'}-login.html?error=1`);
        return res.status(400).json({ error: 'Enter a valid email and password.' });
    }
    try {
        const user = await database.get('SELECT id, email, role, password_salt, password_hash FROM users WHERE email = ?', email);
        const passwordMatches = user
            ? await verifyPassword(password, user.password_salt, user.password_hash)
            : await verifyPassword(password, '00000000000000000000000000000000', '00'.repeat(64));
        if (!user || user.role !== role || !passwordMatches) {
            if (formSubmission) return res.redirect(303, `/${role}-login.html?error=1`);
            return res.status(401).json({ error: 'Email or password is incorrect.' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
        await database.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
            sessionTokenHash(token), user.id, expiresAt
        );
        res.cookie('school_session', token, sessionCookieOptions());
        if (formSubmission) return res.redirect(303, role === 'admin' ? '/admin' : '/student');
        return res.json({ redirect: role === 'admin' ? '/admin' : '/student' });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/logout', authenticate, async (req, res) => {
    if (!isSameOrigin(req, res)) return;
    await clearSession(req, res);
    return res.json({ redirect: '/' });
});

app.get('/api/me', authenticate, (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
});

app.get('/api/admin/students', requireRole('admin'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(await database.all(
        "SELECT id, email, created_at FROM users WHERE role = 'student' ORDER BY email COLLATE NOCASE"
    ));
});

app.get('/api/notices', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(await database.all('SELECT id, category, title, body, created_at FROM notices ORDER BY id DESC LIMIT 50'));
});

app.get('/api/results', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(await database.all(`
        SELECT id, class_level, exam, academic_year, students_appeared, students_passed,
               ROUND(100.0 * students_passed / students_appeared, 1) AS pass_percentage,
               created_at
        FROM public_results
        ORDER BY academic_year DESC, class_level ASC, id DESC
        LIMIT 100
    `));
});

app.post('/api/results', requireRole('admin'), async (req, res) => {
    if (!isSameOrigin(req, res)) return;
    const body = req.body || {};
    const { classLevel, exam, academicYear, studentsAppeared, studentsPassed } = body;
    const parsedClass = Number(classLevel);
    const parsedAppeared = Number(studentsAppeared);
    const parsedPassed = Number(studentsPassed);
    if (Object.hasOwn(body, 'note')
        || !Number.isInteger(parsedClass) || parsedClass < 1 || parsedClass > 12
        || !validText(exam, 100)
        || typeof academicYear !== 'string' || !/^\d{4}-(?:\d{2}|\d{4})$/.test(academicYear)
        || !Number.isInteger(parsedAppeared) || parsedAppeared < 1 || parsedAppeared > 100000
        || !Number.isInteger(parsedPassed) || parsedPassed < 0 || parsedPassed > parsedAppeared) {
        return res.status(400).json({ error: 'Enter a valid class (1–12), exam, academic year, and aggregate student totals.' });
    }
    const result = await database.run(`
        INSERT INTO public_results (
            class_level, exam, academic_year, students_appeared, students_passed
        ) VALUES (?, ?, ?, ?, ?)
    `, parsedClass, exam.trim(), academicYear, parsedAppeared, parsedPassed);
    return res.status(201).json({
        id: Number(result.lastInsertRowid),
        class_level: parsedClass,
        exam: exam.trim(),
        academic_year: academicYear,
        students_appeared: parsedAppeared,
        students_passed: parsedPassed,
        pass_percentage: Math.round(1000 * parsedPassed / parsedAppeared) / 10
    });
});

app.delete('/api/results/:id', requireRole('admin'), async (req, res) => {
    if (!isSameOrigin(req, res)) return;
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid result.' });
    const result = await database.run('DELETE FROM public_results WHERE id = ?', Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Result not found.' });
    return res.status(204).end();
});

app.post('/api/admin/students', requireRole('admin'), async (req, res, next) => {
    if (!isSameOrigin(req, res)) return;
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;
    if (!validEmail(email) || !isValidPassword(password)) {
        return res.status(400).json({ error: 'Enter a valid email and a password between 12 and 128 characters.' });
    }
    try {
        const id = await createUser(email, 'student', password);
        return res.status(201).json({ id, email, role: 'student' });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(error.message)) {
            return res.status(409).json({ error: 'An account with that email already exists.' });
        }
        return next(error);
    }
});

app.post('/api/notices', requireRole('admin'), async (req, res) => {
    if (!isSameOrigin(req, res)) return;
    const categories = new Set(['General', 'Admissions', 'Events']);
    const { category, title, body } = req.body || {};
    if (!categories.has(category) || !validText(title, 120) || !validText(body, 2000)) {
        return res.status(400).json({ error: 'Choose a category and provide a title and notice text within the listed limits.' });
    }
    const result = await database.run('INSERT INTO notices (category, title, body) VALUES (?, ?, ?)',
        category, title.trim(), body.trim()
    );
    return res.status(201).json({ id: Number(result.lastInsertRowid), category, title: title.trim(), body: body.trim() });
});

app.delete('/api/notices/:id', requireRole('admin'), async (req, res) => {
    if (!isSameOrigin(req, res)) return;
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid notice.' });
    const result = await database.run('DELETE FROM notices WHERE id = ?', Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Notice not found.' });
    return res.status(204).end();
});

app.post('/api/password', authenticate, async (req, res, next) => {
    if (!isSameOrigin(req, res)) return;
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || currentPassword.length > 128 || !isValidPassword(newPassword)) {
        return res.status(400).json({ error: 'Enter your current password and a new password between 12 and 128 characters.' });
    }
    try {
        const user = await database.get('SELECT password_salt, password_hash FROM users WHERE id = ?', req.user.id);
        if (!await verifyPassword(currentPassword || '', user.password_salt, user.password_hash)) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }
        const { hash, salt } = await hashPassword(newPassword);
        await database.run('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?', salt, hash, req.user.id);
        await database.run('DELETE FROM sessions WHERE user_id = ?', req.user.id);
        const options = sessionCookieOptions();
        delete options.maxAge;
        res.clearCookie('school_session', options);
        return res.json({ redirect: req.user.role === 'admin' ? '/admin-login.html?changed=1' : '/student-login.html?changed=1' });
    } catch (error) {
        return next(error);
    }
});

app.use((req, res) => res.status(404).send('Page not found.'));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    return res.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function startServer() {
    await database.initialize();
    await database.run('DELETE FROM sessions WHERE expires_at <= ?', Math.floor(Date.now() / 1000));
    return app.listen(PORT, HOST, () => {
        console.log(`My School is running at http://${HOST}:${PORT}`);
        if (!process.env.SESSION_SECRET) console.warn('Using a temporary session secret; sessions will expire when the server restarts.');
    });
}

if (require.main === module) {
    startServer().then((server) => {
        const shutdown = () => server.close(() => {
            database.close();
            process.exit(0);
        });
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }).catch((error) => {
        console.error('Could not start My School:', error);
        process.exitCode = 1;
    });
}

module.exports = app;
