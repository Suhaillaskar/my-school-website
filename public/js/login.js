for (const form of document.querySelectorAll('.portal-form[data-role]')) {
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const message = form.querySelector('.form-message');
        button.disabled = true;
        message.textContent = 'Signing in…';
        message.classList.remove('is-error', 'is-success');

        try {
            const response = await fetch(`/api/login/${form.dataset.role}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form)))
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Sign in failed.');
            window.location.assign(result.redirect);
        } catch (error) {
            message.textContent = error.message || 'Unable to reach the server. Please try again.';
            message.classList.add('is-error');
            button.disabled = false;
        }
    });
}

if (new URLSearchParams(window.location.search).has('changed')) {
    const message = document.querySelector('.login-intro');
    message.textContent = 'Your password has been updated. Sign in with your new password.';
}
if (new URLSearchParams(window.location.search).has('error')) {
    const message = document.querySelector('.form-message');
    message.textContent = 'Email or password is incorrect.';
    message.classList.add('is-error');
}
