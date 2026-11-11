const resultsGrid = document.querySelector('#results-grid');
const resultsStatus = document.querySelector('#results-status');
const classFilter = document.querySelector('#result-class-filter');

for (let classLevel = 1; classLevel <= 12; classLevel += 1) {
    const option = document.createElement('option');
    option.value = String(classLevel);
    option.textContent = `Class ${classLevel}`;
    classFilter.append(option);
}

let publishedResults = [];

function renderResults() {
    const selectedClass = classFilter.value;
    const visibleResults = selectedClass === 'all'
        ? publishedResults
        : publishedResults.filter((result) => result.class_level === Number(selectedClass));

    resultsGrid.replaceChildren();
    if (!visibleResults.length) {
        resultsStatus.textContent = selectedClass === 'all'
            ? 'There are no results published yet. Please check back soon.'
            : `There are no results published for Class ${selectedClass} yet.`;
        return;
    }

    resultsStatus.textContent = '';
    for (const result of visibleResults) {
        const card = document.createElement('article');
        card.className = 'result-card';

        const header = document.createElement('div');
        header.className = 'result-card-header';
        const classBadge = document.createElement('span');
        classBadge.className = 'result-class-badge';
        classBadge.textContent = `Class ${result.class_level}`;
        const year = document.createElement('span');
        year.className = 'result-year';
        year.textContent = result.academic_year;
        header.append(classBadge, year);

        const exam = document.createElement('h3');
        exam.textContent = result.exam;

        const passRate = document.createElement('p');
        passRate.className = 'result-pass-rate';
        passRate.textContent = `${result.pass_percentage}%`;
        const passLabel = document.createElement('p');
        passLabel.className = 'result-pass-label';
        passLabel.textContent = 'class pass rate';

        const divider = document.createElement('div');
        divider.className = 'result-divider';
        const passed = document.createElement('div');
        const passedNumber = document.createElement('strong');
        passedNumber.textContent = result.students_passed.toLocaleString();
        const passedLabel = document.createElement('span');
        passedLabel.textContent = 'Passed';
        passed.append(passedNumber, passedLabel);
        const appeared = document.createElement('div');
        const appearedNumber = document.createElement('strong');
        appearedNumber.textContent = result.students_appeared.toLocaleString();
        const appearedLabel = document.createElement('span');
        appearedLabel.textContent = 'Appeared';
        appeared.append(appearedNumber, appearedLabel);
        divider.append(passed, appeared);
        card.append(header, exam, passRate, passLabel, divider);
        resultsGrid.append(card);
    }
}

fetch('/api/results')
    .then(async (response) => {
        if (!response.ok) throw new Error('School results are temporarily unavailable.');
        return response.json();
    })
    .then((results) => {
        publishedResults = results;
        renderResults();
    })
    .catch((error) => {
        resultsStatus.textContent = error.message;
        resultsStatus.classList.add('is-error');
    });

classFilter.addEventListener('change', renderResults);
