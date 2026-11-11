const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { after, before, test } = require('node:test');
const { randomBytes } = require('node:crypto');

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'my-school-test-'));
const previousDataDirectory = process.env.SCHOOL_DATA_DIR;
let serverProcess;
let baseUrl;
let database;
let childOutput = '';

before(async () => {
    process.env.SCHOOL_DATA_DIR = dataDirectory;
    const { createUser, database: testDatabase } = require('../lib/database');
    database = testDatabase;
    await createUser('admin@example.test', 'admin', 'InitialAdminPass123');
    await createUser('student@example.test', 'student', 'InitialStudentPass123');
    database.close();

    const portServer = net.createServer();
    await new Promise((resolve, reject) => {
        portServer.once('error', reject);
        portServer.listen(0, '127.0.0.1', resolve);
    });
    const { port } = portServer.address();
    await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));
    baseUrl = `http://127.0.0.1:${port}`;

    serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port),
            SESSION_SECRET: randomBytes(32).toString('hex')
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    serverProcess.stdout.on('data', (data) => { childOutput += data.toString(); });
    serverProcess.stderr.on('data', (data) => { childOutput += data.toString(); });

    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (serverProcess.exitCode !== null) throw new Error(`Server exited during startup:\n${childOutput}`);
        try {
            const response = await fetch(`${baseUrl}/api/notices`);
            if (response.ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start in time:\n${childOutput}`);
});

after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill('SIGTERM');
        await Promise.race([once(serverProcess, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    if (database && database.open) database.close();
    if (previousDataDirectory === undefined) delete process.env.SCHOOL_DATA_DIR;
    else process.env.SCHOOL_DATA_DIR = previousDataDirectory;
    fs.rmSync(dataDirectory, { recursive: true, force: true });
});

async function login(role, email, password) {
    const response = await fetch(`${baseUrl}/api/login/${role}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    return { response, cookie };
}

async function request(pathname, cookie, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    return fetch(`${baseUrl}${pathname}`, { ...options, headers });
}

test('serves every school page and protects both portals', async () => {
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const pages = ['index.html', 'about.html', 'academics.html', 'admission.html', 'gallery.html', 'notices.html', 'results.html', 'contact.html'];
    for (const page of pages) {
        const response = await request(`/${page}`);
        assert.equal(response.status, 200, page);
        assert.match(response.headers.get('content-type'), /text\/html/);
        const html = await response.text();
        assert.match(html, /href="results\.html"/, `${page} includes Results navigation`);
    }
    const academics = await (await request('/academics.html')).text();
    assert.match(academics, /Classes 1–5/);
    assert.match(academics, /Classes 6–8/);
    assert.match(academics, /Classes 9–10/);
    assert.match(academics, /Classes 11–12/);
    const images = [
        'learning-classroom.jpg', 'campus-life.jpg', 'student-reading.jpg',
        'student-writing.jpg', 'creative-learning.jpg', 'students-collaborating.jpg',
        'school-library.jpg'
    ];
    for (const image of images) {
        const response = await request(`/images/${image}`);
        assert.equal(response.status, 200, image);
        assert.match(response.headers.get('content-type'), /image\/jpeg/, image);
    }
    const adminPortal = await request('/admin', undefined, { redirect: 'manual' });
    assert.equal(adminPortal.status, 302);
    assert.equal(adminPortal.headers.get('location'), '/admin-login.html');
    const studentPortal = await request('/student', undefined, { redirect: 'manual' });
    assert.equal(studentPortal.status, 302);
    assert.equal(studentPortal.headers.get('location'), '/student-login.html');
});

test('enforces role-based login, account management, notices, and password changes', async () => {
    const wrongRole = await login('admin', 'student@example.test', 'InitialStudentPass123');
    assert.equal(wrongRole.response.status, 401);
    const emptyLogin = await request('/api/login/admin', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    assert.equal(emptyLogin.status, 400);

    const formLogin = await fetch(`${baseUrl}/api/login/admin`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'admin@example.test', password: 'InitialAdminPass123' })
    });
    assert.equal(formLogin.status, 303);
    assert.equal(formLogin.headers.get('location'), '/admin');
    assert.match(formLogin.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(formLogin.headers.get('set-cookie'), /SameSite=Strict/i);

    const admin = await login('admin', 'admin@example.test', 'InitialAdminPass123');
    assert.equal(admin.response.status, 200);
    const adminAccount = await request('/api/me', admin.cookie);
    assert.equal((await adminAccount.json()).role, 'admin');

    const invalidStudent = await request('/api/admin/students', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new-student@example.test', password: 'short' })
    });
    assert.equal(invalidStudent.status, 400);

    const studentCreated = await request('/api/admin/students', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new-student@example.test', password: 'NewStudentPassword123' })
    });
    assert.equal(studentCreated.status, 201);

    const duplicateStudent = await request('/api/admin/students', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new-student@example.test', password: 'AnotherStudentPass123' })
    });
    assert.equal(duplicateStudent.status, 409);

    const published = await request('/api/notices', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Events', title: 'Family day', body: 'Please check with the school office for details.' })
    });
    assert.equal(published.status, 201);
    const notice = await published.json();

    const invalidClassResult = await request('/api/results', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            classLevel: 13,
            exam: 'Annual Examination',
            academicYear: '2026-27',
            studentsAppeared: 30,
            studentsPassed: 29
        })
    });
    assert.equal(invalidClassResult.status, 400);

    const invalidTotalsResult = await request('/api/results', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            classLevel: 12,
            exam: 'Annual Examination',
            academicYear: '2026-27',
            studentsAppeared: 30,
            studentsPassed: 31
        })
    });
    assert.equal(invalidTotalsResult.status, 400);

    const noteResult = await request('/api/results', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            classLevel: 12,
            exam: 'Annual Examination',
            academicYear: '2026-27',
            studentsAppeared: 30,
            studentsPassed: 27,
            note: 'Do not publish personal student information.'
        })
    });
    assert.equal(noteResult.status, 400);

    const publishedResult = await request('/api/results', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            classLevel: 12,
            exam: 'Annual Examination',
            academicYear: '2026-27',
            studentsAppeared: 30,
            studentsPassed: 27
        })
    });
    assert.equal(publishedResult.status, 201);
    const resultSummary = await publishedResult.json();
    assert.equal(resultSummary.pass_percentage, 90);

    const publicResultsResponse = await request('/api/results');
    assert.equal(publicResultsResponse.status, 200);
    const publicResults = await publicResultsResponse.json();
    assert.equal(publicResults.length, 1);
    assert.equal(publicResults[0].class_level, 12);
    assert.equal(publicResults[0].pass_percentage, 90);
    assert.equal(Object.keys(publicResults[0]).some((key) => /email|student.?name|student.?id|individual.?marks|note/i.test(key)), false);

    const crossOriginWrite = await request('/api/notices', admin.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
        body: JSON.stringify({ category: 'General', title: 'Should not publish', body: 'Cross-origin write' })
    });
    assert.equal(crossOriginWrite.status, 403);

    const student = await login('student', 'new-student@example.test', 'NewStudentPassword123');
    assert.equal(student.response.status, 200);
    const protectedAccounts = await request('/api/admin/students', student.cookie);
    assert.equal(protectedAccounts.status, 403);
    const forbiddenNotice = await request('/api/notices', student.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'General', title: 'Forbidden', body: 'Students cannot publish notices.' })
    });
    assert.equal(forbiddenNotice.status, 403);
    const forbiddenResult = await request('/api/results', student.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            classLevel: 12,
            exam: 'Annual Examination',
            academicYear: '2026-27',
            studentsAppeared: 30,
            studentsPassed: 30
        })
    });
    assert.equal(forbiddenResult.status, 403);
    const notices = await request('/api/notices', student.cookie);
    assert.equal((await notices.json())[0].title, 'Family day');
    assert.equal((await request('/admin', student.cookie, { redirect: 'manual' })).headers.get('location'), '/student');

    const badPasswordChange = await request('/api/password', student.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'UpdatedStudentPassword123' })
    });
    assert.equal(badPasswordChange.status, 401);

    const changedPassword = await request('/api/password', student.cookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'NewStudentPassword123', newPassword: 'UpdatedStudentPassword123' })
    });
    assert.equal(changedPassword.status, 200);
    assert.equal((await request('/api/me', student.cookie)).status, 401);
    assert.equal((await login('student', 'new-student@example.test', 'UpdatedStudentPassword123')).response.status, 200);

    const removed = await request(`/api/notices/${notice.id}`, admin.cookie, { method: 'DELETE' });
    assert.equal(removed.status, 204);
    const removedResult = await request(`/api/results/${resultSummary.id}`, admin.cookie, { method: 'DELETE' });
    assert.equal(removedResult.status, 204);
    assert.deepEqual(await (await request('/api/results')).json(), []);
    assert.deepEqual(await (await request('/api/notices')).json(), []);
    const logout = await request('/api/logout', admin.cookie, { method: 'POST' });
    assert.equal(logout.status, 200);
    assert.equal((await request('/api/me', admin.cookie)).status, 401);
});
