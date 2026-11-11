const feed = document.querySelector('#notice-feed');
const status = document.querySelector('#notice-status');

function addNotice(notice) {
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
    const title = document.createElement('h2');
    title.textContent = notice.title;
    const body = document.createElement('p');
    body.textContent = notice.body;
    article.append(meta, title, body);
    feed.append(article);
}

fetch('/api/notices')
    .then(async (response) => {
        if (!response.ok) throw new Error('Could not load school notices. Please try again later.');
        return response.json();
    })
    .then((notices) => {
        feed.replaceChildren();
        if (notices.length === 0) {
            status.textContent = 'There are no school notices at the moment. Please check back soon.';
            return;
        }
        status.textContent = '';
        notices.forEach(addNotice);
    })
    .catch((error) => {
        status.textContent = error.message;
        status.classList.add('is-error');
    });
