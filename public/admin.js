const adminWarningEl = document.getElementById('admin-warning');
const adminStatusEl = document.getElementById('admin-status');
const submissionForm = document.getElementById('admin-submission-form');
const clearSubmissionFormBtn = document.getElementById('clear-submission-form');
const submissionsTable = document.getElementById('submissions-table');
const drugsTable = document.getElementById('drugs-table');
const drugSelect = document.getElementById('admin-drug-id');
const newDrugForm = document.getElementById('new-drug-form');

const token = new URLSearchParams(window.location.search).get('token') || '';

let drugs = [];
let submissions = [];

function setStatus(message, type = 'success') {
  adminStatusEl.textContent = message;
  adminStatusEl.className = `status ${type}`;
}

function ensureToken() {
  if (token) {
    return true;
  }

  adminWarningEl.hidden = false;
  adminWarningEl.textContent = 'Missing admin token. Open this page with ?token=YOUR_ADMIN_DASHBOARD_TOKEN';
  return false;
}

async function adminFetch(path, options = {}) {
  if (!ensureToken()) {
    throw new Error('Missing admin token');
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': token,
      ...(options.headers || {}),
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function parseStudentsText(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [idPart, ...nameParts] = line.split(',');
      return {
        student_id: (idPart || '').trim(),
        student_name: nameParts.join(',').trim(),
      };
    })
    .filter((student) => student.student_id && student.student_name);
}

function studentsToText(students) {
  if (!Array.isArray(students)) {
    return '';
  }

  return students
    .map((student) => `${student.student_id || ''}, ${student.student_name || ''}`)
    .join('\n');
}

function getDrugNameById(drugId) {
  return drugs.find((drug) => drug.id === drugId)?.name || '-';
}

function renderDrugSelect() {
  drugSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select drug';
  placeholder.disabled = true;
  placeholder.selected = true;
  drugSelect.appendChild(placeholder);

  drugs.forEach((drug) => {
    const option = document.createElement('option');
    option.value = drug.id;
    option.textContent = `${drug.name}${drug.is_active ? '' : ' (inactive)'}`;
    drugSelect.appendChild(option);
  });
}

function renderSubmissionsTable() {
  submissionsTable.innerHTML = '';

  submissions.forEach((submission) => {
    const tr = document.createElement('tr');

    const groupTd = document.createElement('td');
    groupTd.textContent = submission.course_group;

    const teamTd = document.createElement('td');
    teamTd.textContent = submission.team_number;

    const leaderTd = document.createElement('td');
    leaderTd.textContent = `${submission.leader_name}\n${submission.leader_email}\n${submission.leader_phone}`;
    leaderTd.style.whiteSpace = 'pre-line';

    const drugTd = document.createElement('td');
    drugTd.textContent = getDrugNameById(submission.drug_id);

    const studentsTd = document.createElement('td');
    studentsTd.textContent = Array.isArray(submission.students) ? submission.students.length : 0;

    const actionsTd = document.createElement('td');

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => fillSubmissionForm(submission));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm('Delete this submission?')) {
        return;
      }

      try {
        await adminFetch(`/api/admin/submissions/${submission.id}`, {
          method: 'DELETE',
        });
        setStatus('Submission deleted.', 'success');
        await loadOverview();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    actionsTd.append(editBtn, deleteBtn);

    tr.append(groupTd, teamTd, leaderTd, drugTd, studentsTd, actionsTd);
    submissionsTable.appendChild(tr);
  });
}

function renderDrugsTable() {
  drugsTable.innerHTML = '';

  const takenDrugIds = new Set(submissions.map((submission) => submission.drug_id));

  drugs.forEach((drug) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = drug.name;
    nameTd.appendChild(nameInput);

    const activeTd = document.createElement('td');
    const activeInput = document.createElement('input');
    activeInput.type = 'checkbox';
    activeInput.checked = Boolean(drug.is_active);
    activeTd.appendChild(activeInput);

    const statusTd = document.createElement('td');
    const statusTag = document.createElement('span');
    if (!drug.is_active) {
      statusTag.className = 'tag inactive';
      statusTag.textContent = 'Inactive';
    } else if (takenDrugIds.has(drug.id)) {
      statusTag.className = 'tag taken';
      statusTag.textContent = 'Taken';
    } else {
      statusTag.className = 'tag available';
      statusTag.textContent = 'Available';
    }
    statusTd.appendChild(statusTag);

    const actionsTd = document.createElement('td');
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-secondary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      try {
        await adminFetch(`/api/admin/drugs/${drug.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: nameInput.value.trim(),
            is_active: activeInput.checked,
          }),
        });
        setStatus('Drug updated.', 'success');
        await loadOverview();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm('Delete this drug?')) {
        return;
      }

      try {
        await adminFetch(`/api/admin/drugs/${drug.id}`, {
          method: 'DELETE',
        });
        setStatus('Drug deleted.', 'success');
        await loadOverview();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    actionsTd.append(saveBtn, deleteBtn);

    tr.append(nameTd, activeTd, statusTd, actionsTd);
    drugsTable.appendChild(tr);
  });
}

function fillSubmissionForm(submission) {
  document.getElementById('submission-id').value = submission.id;
  document.getElementById('admin-course-group').value = submission.course_group;
  document.getElementById('admin-team-number').value = submission.team_number;
  document.getElementById('admin-leader-name').value = submission.leader_name;
  document.getElementById('admin-leader-email').value = submission.leader_email;
  document.getElementById('admin-leader-phone').value = submission.leader_phone;
  document.getElementById('admin-drug-id').value = submission.drug_id;
  document.getElementById('admin-students').value = studentsToText(submission.students);
}

function clearSubmissionForm() {
  submissionForm.reset();
  document.getElementById('submission-id').value = '';
  renderDrugSelect();
}

async function loadOverview() {
  if (!ensureToken()) {
    return;
  }

  const data = await adminFetch('/api/admin/overview', {
    headers: {
      'Cache-Control': 'no-store',
    },
  });

  drugs = data.drugs || [];
  submissions = data.submissions || [];

  renderDrugSelect();
  renderSubmissionsTable();
  renderDrugsTable();
}

submissionForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const submissionId = document.getElementById('submission-id').value.trim();
  const students = parseStudentsText(document.getElementById('admin-students').value);

  if (!students.length) {
    setStatus('Enter at least one student in ID, Name format.', 'error');
    return;
  }

  const payload = {
    courseGroup: Number.parseInt(document.getElementById('admin-course-group').value, 10),
    teamNumber: Number.parseInt(document.getElementById('admin-team-number').value, 10),
    leaderName: document.getElementById('admin-leader-name').value.trim(),
    leaderEmail: document.getElementById('admin-leader-email').value.trim(),
    leaderPhone: document.getElementById('admin-leader-phone').value.trim(),
    drugId: document.getElementById('admin-drug-id').value,
    students,
  };

  try {
    if (submissionId) {
      await adminFetch(`/api/admin/submissions/${submissionId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setStatus('Submission updated.', 'success');
    } else {
      await adminFetch('/api/admin/submissions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatus('Submission created.', 'success');
    }

    clearSubmissionForm();
    await loadOverview();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

clearSubmissionFormBtn.addEventListener('click', () => {
  clearSubmissionForm();
  setStatus('');
});

newDrugForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const nameInput = document.getElementById('new-drug-name');
  const name = nameInput.value.trim();
  if (!name) {
    return;
  }

  try {
    await adminFetch('/api/admin/drugs', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    nameInput.value = '';
    setStatus('Drug added.', 'success');
    await loadOverview();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

loadOverview().catch((error) => {
  setStatus(error.message, 'error');
});
