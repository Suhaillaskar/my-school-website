const dashboard = document.querySelector('[data-portal-role]');
const role = dashboard.dataset.portalRole;

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        window.location.assign(role === 'admin' ? '/admin-login.html' : '/student-login.html');
        throw new Error('Your session has ended. Please sign in again.');
    }
    if (response.status === 204) return null;
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
}

function setMessage(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', isError);
    element.classList.toggle('is-success', Boolean(message) && !isError);
}

function renderNotice(feed, notice, admin = false) {
    const article = document.createElement('article');
    article.className = 'feed-notice';
    const meta = document.createElement('div');
    meta.className = 'feed-notice-meta';
    const category = document.createElement('span');
    category.className = 'notice-category';
    category.textContent = notice.category;
    const date = document.createElement('time');
    date.textContent = new Date(`${notice.created_at.replace(' ', 'T')}Z`).toLocaleDateString();
    meta.append(category, date);
    const title = document.createElement('h3');
    title.textContent = notice.title;
    const body = document.createElement('p');
    body.textContent = notice.body;
    article.append(meta, title, body);
    if (admin) {
        const remove = document.createElement('button');
        remove.className = 'notice-delete';
        remove.type = 'button';
        remove.dataset.noticeId = notice.id;
        remove.textContent = 'Remove notice';
        article.append(remove);
    }
    feed.append(article);
}

async function loadNotices() {
    const feed = document.querySelector(role === 'admin' ? '#admin-notice-list' : '#student-notice-feed');
    const status = document.querySelector(role === 'admin' ? '#admin-notice-status' : '#student-notice-status');
    try {
        const notices = await requestJson('/api/notices');
        feed.replaceChildren();
        if (!notices.length) {
            status.textContent = 'No notices have been published yet.';
            return;
        }
        status.textContent = '';
        notices.forEach((notice) => renderNotice(feed, notice, role === 'admin'));
    } catch (error) {
        setMessage(status, error.message, true);
    }
}

async function loadStudents() {
    const list = document.querySelector('#student-list');
    const status = document.querySelector('#student-list-status');
    try {
        const students = await requestJson('/api/admin/students');
        list.replaceChildren();
        if (!students.length) {
            status.textContent = 'No student accounts yet. Create one using the form.';
            return;
        }
        status.textContent = '';
        for (const student of students) {
            const item = document.createElement('li');
            const email = document.createElement('span');
            email.textContent = student.email;
            const created = document.createElement('time');
            created.textContent = new Date(`${student.created_at.replace(' ', 'T')}Z`).toLocaleDateString();
            item.append(email, created);
            list.append(item);
        }
    } catch (error) {
        setMessage(status, error.message, true);
    }
}

function addResultClassOptions(select) {
    for (let classLevel = 1; classLevel <= 12; classLevel += 1) {
        const option = document.createElement('option');
        option.value = String(classLevel);
        option.textContent = `Class ${classLevel}`;
        select.append(option);
    }
}

function renderAdminResult(feed, result) {
    const article = document.createElement('article');
    article.className = 'admin-result-item';

    const summary = document.createElement('div');
    summary.className = 'admin-result-summary';
    const heading = document.createElement('h3');
    heading.textContent = `Class ${result.class_level} · ${result.exam}`;
    const detail = document.createElement('p');
    detail.textContent = `${result.academic_year} · ${result.pass_percentage}% pass rate`;
    summary.append(heading, detail);

    const remove = document.createElement('button');
    remove.className = 'notice-delete';
    remove.type = 'button';
    remove.dataset.resultId = result.id;
    remove.textContent = 'Remove summary';
    article.append(summary, remove);
    feed.append(article);
}

async function loadAdminResults() {
    const feed = document.querySelector('#admin-result-list');
    const status = document.querySelector('#admin-result-status');
    try {
        const results = await requestJson('/api/results');
        feed.replaceChildren();
        if (!results.length) {
            status.textContent = 'No class summaries have been published yet.';
            return;
        }
        status.textContent = '';
        results.forEach((result) => renderAdminResult(feed, result));
    } catch (error) {
        setMessage(status, error.message, true);
    }
}

async function initializePortal() {
    try {
        const account = await requestJson('/api/me');
        if (account.role !== role) {
            window.location.assign(account.role === 'admin' ? '/admin' : '/student');
            return;
        }
        for (const email of dashboard.querySelectorAll('[data-account-email]')) {
            email.textContent = account.email;
        }
        await loadNotices();
        if (role === 'admin') {
            await Promise.all([loadStudents(), loadAdminResults()]);
        }
    } catch (error) {
        if (error.message !== 'Your session has ended. Please sign in again.') {
            setMessage(document.querySelector('.dashboard-status'), error.message, true);
        }
    }
}

document.querySelector('[data-logout]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const result = await requestJson('/api/logout', { method: 'POST' });
        window.location.assign(result.redirect);
    } catch (error) {
        setMessage(document.querySelector('.dashboard-status'), error.message, true);
        button.disabled = false;
    }
});

document.querySelectorAll('[data-password-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const message = form.querySelector('.form-message');
        button.disabled = true;
        try {
            const result = await requestJson('/api/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form)))
            });
            window.location.assign(result.redirect);
        } catch (error) {
            setMessage(message, error.message, true);
            button.disabled = false;
        }
    });
});

if (role === 'admin') {
    const resultClassSelect = document.querySelector('#result-class');
    addResultClassOptions(resultClassSelect);

    document.querySelector('#create-student-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const message = document.querySelector('#student-form-message');
        button.disabled = true;
        try {
            const student = await requestJson('/api/admin/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form)))
            });
            form.reset();
            setMessage(message, `Student account created for ${student.email}. Share the initial password privately.`);
            await loadStudents();
        } catch (error) {
            setMessage(message, error.message, true);
        } finally {
            button.disabled = false;
        }
    });

    document.querySelector('#create-notice-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const message = document.querySelector('#notice-form-message');
        button.disabled = true;
        try {
            await requestJson('/api/notices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form)))
            });
            form.reset();
            setMessage(message, 'Notice published.');
            await loadNotices();
        } catch (error) {
            setMessage(message, error.message, true);
        } finally {
            button.disabled = false;
        }
    });

    document.querySelector('#admin-notice-list').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-notice-id]');
        if (!button) return;
        button.disabled = true;
        try {
            await requestJson(`/api/notices/${button.dataset.noticeId}`, { method: 'DELETE' });
            await loadNotices();
        } catch (error) {
            setMessage(document.querySelector('#admin-notice-status'), error.message, true);
            button.disabled = false;
        }
    });

    document.querySelector('#create-result-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const message = document.querySelector('#result-form-message');
        const formData = Object.fromEntries(new FormData(form));
        formData.classLevel = Number(formData.classLevel);
        formData.studentsAppeared = Number(formData.studentsAppeared);
        formData.studentsPassed = Number(formData.studentsPassed);
        button.disabled = true;
        try {
            await requestJson('/api/results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            form.reset();
            setMessage(message, 'Class summary published on the public Results page.');
            await loadAdminResults();
        } catch (error) {
            setMessage(message, error.message, true);
        } finally {
            button.disabled = false;
        }
    });

    document.querySelector('#admin-result-list').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-result-id]');
        if (!button) return;
        button.disabled = true;
        try {
            await requestJson(`/api/results/${button.dataset.resultId}`, { method: 'DELETE' });
            await loadAdminResults();
        } catch (error) {
            setMessage(document.querySelector('#admin-result-status'), error.message, true);
            button.disabled = false;
        }
    });
}

initializePortal();
