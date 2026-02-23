const adminStatusEl = document.getElementById('admin-status');

const submissionForm = document.getElementById('admin-submission-form');
const clearSubmissionFormBtn = document.getElementById('clear-submission-form');
const submissionsTable = document.getElementById('submissions-table');
const submissionDrugSelect = document.getElementById('admin-drug-id');

const drugForm = document.getElementById('admin-drug-form');
const saveDrugBtn = document.getElementById('save-drug-btn');
const drugsTable = document.getElementById('drugs-table');
const drugOriginalKeyInput = document.getElementById('drug-original-key');
const drugNameInput = document.getElementById('admin-drug-name');
const drugSortInput = document.getElementById('admin-drug-sort');
const drugActiveInput = document.getElementById('admin-drug-active');

let drugs = [];
let submissions = [];

function setStatus(message, type = 'success') {
  adminStatusEl.textContent = message;
  adminStatusEl.className = `status ${type}`;
}

async function adminFetch(path, options = {}) {
  const hasBody = options.body !== undefined;

  const response = await fetch(path, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
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

  return students.map((student) => `${student.student_id || ''}, ${student.student_name || ''}`).join('\n');
}

function getDrugNameByKey(drugKey) {
  return drugs.find((drug) => drug.key === drugKey)?.name || '-';
}

function renderSubmissionDrugSelect(selectedDrugKey = '') {
  submissionDrugSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select drug';
  placeholder.disabled = true;
  placeholder.selected = true;
  submissionDrugSelect.appendChild(placeholder);

  drugs.forEach((drug) => {
    const option = document.createElement('option');
    option.value = drug.key;
    option.textContent = `${drug.name}${drug.is_taken ? ` (taken by Group ${drug.taken_by?.team_number ?? '-'})` : ''}${
      !drug.is_active ? ' (inactive)' : ''
    }`;
    submissionDrugSelect.appendChild(option);
  });

  if (selectedDrugKey) {
    submissionDrugSelect.value = selectedDrugKey;
  }
}

function renderSubmissionsTable() {
  submissionsTable.innerHTML = '';

  if (!submissions.length) {
    const empty = document.createElement('tr');
    empty.innerHTML = '<td colspan="5">No submissions yet.</td>';
    submissionsTable.appendChild(empty);
    return;
  }

  submissions.forEach((submission) => {
    const tr = document.createElement('tr');

    const groupTd = document.createElement('td');
    groupTd.textContent = submission.team_number;

    const leaderTd = document.createElement('td');
    leaderTd.textContent = `${submission.leader_name}\n${submission.leader_email}\n${submission.leader_phone}`;
    leaderTd.style.whiteSpace = 'pre-line';

    const drugTd = document.createElement('td');
    drugTd.textContent = submission.drug_name || getDrugNameByKey(submission.drug_key);

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
        await adminFetch(`/api/admin/submissions/${submission.id}`, { method: 'DELETE' });
        setStatus('Submission deleted.', 'success');
        await loadOverview();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    actionsTd.append(editBtn, deleteBtn);
    tr.append(groupTd, leaderTd, drugTd, studentsTd, actionsTd);
    submissionsTable.appendChild(tr);
  });
}

function fillSubmissionForm(submission) {
  document.getElementById('submission-id').value = submission.id;
  document.getElementById('admin-group-number').value = submission.team_number;
  document.getElementById('admin-leader-name').value = submission.leader_name;
  document.getElementById('admin-leader-email').value = submission.leader_email;
  document.getElementById('admin-leader-phone').value = submission.leader_phone;
  document.getElementById('admin-students').value = studentsToText(submission.students);
  renderSubmissionDrugSelect(submission.drug_key || '');
}

function clearSubmissionForm() {
  submissionForm.reset();
  document.getElementById('submission-id').value = '';
  renderSubmissionDrugSelect();
}

function updateDrugSubmitButtonLabel() {
  const isEditMode = Boolean(drugOriginalKeyInput.value.trim());
  saveDrugBtn.textContent = isEditMode ? 'Update Drug' : 'Add Drug';
}

function renderDrugsTable() {
  drugsTable.innerHTML = '';

  if (!drugs.length) {
    const empty = document.createElement('tr');
    empty.innerHTML = '<td colspan="5">No drugs yet.</td>';
    drugsTable.appendChild(empty);
    return;
  }

  drugs.forEach((drug) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = drug.name;

    const activeTd = document.createElement('td');
    activeTd.textContent = drug.is_active ? 'Yes' : 'No';

    const takenTd = document.createElement('td');
    takenTd.textContent = drug.is_taken ? `Yes (Group ${drug.taken_by?.team_number ?? '-'})` : 'No';

    const sortTd = document.createElement('td');
    sortTd.textContent = String(drug.sort_order ?? 0);

    const actionsTd = document.createElement('td');

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => fillDrugForm(drug));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.disabled = Boolean(drug.is_taken);
    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm(`Delete drug "${drug.name}"?`)) {
        return;
      }

      try {
        await adminFetch(`/api/admin/drugs/${encodeURIComponent(drug.key)}`, { method: 'DELETE' });
        clearDrugForm();
        setStatus('Drug deleted.', 'success');
        await loadOverview();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    actionsTd.append(editBtn, deleteBtn);
    tr.append(nameTd, activeTd, takenTd, sortTd, actionsTd);
    drugsTable.appendChild(tr);
  });
}

function fillDrugForm(drug) {
  drugOriginalKeyInput.value = drug.key;
  drugNameInput.value = drug.name;
  drugSortInput.value = drug.sort_order ?? 0;
  drugActiveInput.checked = Boolean(drug.is_active);
  updateDrugSubmitButtonLabel();
}

function clearDrugForm() {
  drugForm.reset();
  drugOriginalKeyInput.value = '';
  drugNameInput.value = '';
  drugSortInput.value = '';
  drugActiveInput.checked = true;
  updateDrugSubmitButtonLabel();
}

async function loadOverview() {
  const data = await adminFetch('/api/admin/overview', {
    headers: {
      'Cache-Control': 'no-store',
    },
  });

  drugs = data.drugs || [];
  submissions = data.submissions || [];

  renderSubmissionDrugSelect();
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
    teamNumber: Number.parseInt(document.getElementById('admin-group-number').value, 10),
    leaderName: document.getElementById('admin-leader-name').value.trim(),
    leaderEmail: document.getElementById('admin-leader-email').value.trim(),
    leaderPhone: document.getElementById('admin-leader-phone').value.trim(),
    drugKey: document.getElementById('admin-drug-id').value,
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

drugForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const originalKey = drugOriginalKeyInput.value.trim();
  const payload = {
    name: drugNameInput.value.trim(),
    sortOrder: Number.parseInt(drugSortInput.value || '0', 10),
    isActive: Boolean(drugActiveInput.checked),
  };

  try {
    if (originalKey) {
      await adminFetch(`/api/admin/drugs/${encodeURIComponent(originalKey)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setStatus('Drug updated.', 'success');
    } else {
      await adminFetch('/api/admin/drugs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatus('Drug created.', 'success');
    }

    clearDrugForm();
    await loadOverview();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

clearSubmissionFormBtn.addEventListener('click', () => {
  clearSubmissionForm();
  setStatus('');
});

clearDrugForm();
clearSubmissionForm();
loadOverview().catch((error) => {
  setStatus(error.message, 'error');
});
