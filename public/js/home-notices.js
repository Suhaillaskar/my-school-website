const noticeList = document.querySelector('#home-notices');
const noticeStatus = document.querySelector('#home-notice-status');

function renderHomeNotice(notice) {
    const article = document.createElement('article');
    article.className = 'home-notice';

    const number = document.createElement('span');
    number.className = 'home-notice-number';
    number.textContent = String(notice.id).padStart(2, '0');

    const content = document.createElement('div');
    const category = document.createElement('span');
    category.className = 'notice-category';
    category.textContent = notice.category;

    const title = document.createElement('h3');
    title.textContent = notice.title;
    content.append(category, title);

    const arrow = document.createElement('span');
    arrow.className = 'home-notice-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';

    article.append(number, content, arrow);
    noticeList.append(article);
}

fetch('/api/notices')
    .then(async (response) => {
        if (!response.ok) throw new Error('School notices are temporarily unavailable.');
        return response.json();
    })
    .then((notices) => {
        noticeList.replaceChildren();
        if (!notices.length) {
            noticeStatus.textContent = 'No notices have been published yet. Please check back soon.';
            return;
        }
        noticeStatus.remove();
        notices.slice(0, 3).forEach(renderHomeNotice);
    })
    .catch((error) => {
        noticeStatus.textContent = error.message;
        noticeStatus.classList.add('is-error');
    });
