const gridEl = document.getElementById('drugs-grid');
const statusEl = document.getElementById('status');

function setStatus(message, type = 'success') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function buildStatusTag(drug) {
  if (!drug.is_active) {
    return { text: 'Inactive', cls: 'inactive' };
  }
  if (drug.is_taken) {
    return { text: 'Taken', cls: 'taken' };
  }
  return { text: 'Available', cls: 'available' };
}

function renderDrugs(drugs) {
  gridEl.innerHTML = '';

  if (!drugs.length) {
    setStatus('No drugs found in the database.', 'error');
    return;
  }

  drugs.forEach((drug) => {
    const card = document.createElement('article');
    card.className = 'drug-card';

    const header = document.createElement('div');
    header.className = 'drug-card-head';

    const title = document.createElement('h3');
    title.textContent = drug.name;

    const tagInfo = buildStatusTag(drug);
    const tag = document.createElement('span');
    tag.className = `tag ${tagInfo.cls}`;
    tag.textContent = tagInfo.text;

    header.append(title, tag);

    const details = document.createElement('p');
    details.className = 'muted';

    if (!drug.is_active) {
      details.textContent = 'This drug is currently disabled by admin.';
    } else if (drug.is_taken && drug.taken_by) {
      details.textContent = `Locked by Team ${drug.taken_by.team_number}.`;
    } else {
      details.textContent = 'Click select to continue with this drug.';
    }

    const action = document.createElement('button');
    action.className = 'btn btn-primary';
    action.type = 'button';
    action.textContent = drug.is_active && !drug.is_taken ? 'Select Drug' : 'Unavailable';
    action.disabled = !drug.is_active || drug.is_taken;

    action.addEventListener('click', () => {
      window.location.href = `/team?drugId=${encodeURIComponent(drug.id)}`;
    });

    card.append(header, details, action);
    gridEl.appendChild(card);
  });
}

async function loadDrugs() {
  try {
    const response = await fetch('/api/public/drugs', {
      headers: {
        'Cache-Control': 'no-store',
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load drugs');
    }

    renderDrugs(data.drugs || []);
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

loadDrugs();
