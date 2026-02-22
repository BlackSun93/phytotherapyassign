const MAX_STUDENTS = 25;
const DEFAULT_STUDENT_ROWS = 10;

const form = document.getElementById('submission-form');
const statusEl = document.getElementById('status');
const drugsLegendEl = document.getElementById('drugs-legend');
const studentsListEl = document.getElementById('students-list');
const addStudentBtn = document.getElementById('add-student');
const submitButton = document.getElementById('submit-button');
const drugSelect = document.getElementById('drug-id');

let drugs = [];

function setStatus(message, type = 'success') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function createStudentRow(student = { student_id: '', student_name: '' }) {
  const row = document.createElement('div');
  row.className = 'student-row';

  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.placeholder = 'Student ID';
  idInput.value = student.student_id || '';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Student Name';
  nameInput.value = student.student_name || '';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-danger';
  removeBtn.textContent = 'Remove';

  removeBtn.addEventListener('click', () => {
    row.remove();
    if (studentsListEl.children.length === 0) {
      studentsListEl.appendChild(createStudentRow());
    }
  });

  row.append(idInput, nameInput, removeBtn);
  return row;
}

function getStudentsFromForm() {
  return Array.from(studentsListEl.querySelectorAll('.student-row'))
    .map((row) => {
      const inputs = row.querySelectorAll('input');
      return {
        student_id: inputs[0].value.trim(),
        student_name: inputs[1].value.trim(),
      };
    })
    .filter((student) => student.student_id && student.student_name);
}

function renderDrugOptions() {
  const availableDrugs = drugs.filter((drug) => drug.is_active && !drug.is_taken);

  drugSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = availableDrugs.length ? 'Select available drug' : 'No available drugs';
  placeholder.disabled = true;
  placeholder.selected = true;
  drugSelect.appendChild(placeholder);

  availableDrugs.forEach((drug) => {
    const option = document.createElement('option');
    option.value = drug.id;
    option.textContent = drug.name;
    drugSelect.appendChild(option);
  });

  drugsLegendEl.innerHTML = '';
  drugs.forEach((drug) => {
    const box = document.createElement('div');
    const status = !drug.is_active ? 'inactive' : drug.is_taken ? 'taken' : 'available';
    box.className = `legend-item ${status}`;

    const title = document.createElement('strong');
    title.textContent = drug.name;

    const details = document.createElement('p');
    if (!drug.is_active) {
      details.textContent = 'Inactive';
    } else if (drug.is_taken && drug.taken_by) {
      details.textContent = `Taken by Group ${drug.taken_by.course_group}, Team ${drug.taken_by.team_number}`;
    } else {
      details.textContent = 'Available';
    }

    box.append(title, details);
    drugsLegendEl.appendChild(box);
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

    drugs = data.drugs || [];
    renderDrugOptions();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function resetStudentRows() {
  studentsListEl.innerHTML = '';
  for (let i = 0; i < DEFAULT_STUDENT_ROWS; i += 1) {
    studentsListEl.appendChild(createStudentRow());
  }
}

addStudentBtn.addEventListener('click', () => {
  if (studentsListEl.children.length >= MAX_STUDENTS) {
    setStatus(`Maximum ${MAX_STUDENTS} students allowed.`, 'error');
    return;
  }
  studentsListEl.appendChild(createStudentRow());
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('');

  const students = getStudentsFromForm();
  if (students.length === 0) {
    setStatus('Add at least one student with ID and name.', 'error');
    return;
  }

  const payload = {
    courseGroup: Number.parseInt(document.getElementById('course-group').value, 10),
    teamNumber: Number.parseInt(document.getElementById('team-number').value, 10),
    leaderName: document.getElementById('leader-name').value.trim(),
    leaderEmail: document.getElementById('leader-email').value.trim(),
    leaderPhone: document.getElementById('leader-phone').value.trim(),
    drugId: drugSelect.value,
    students,
  };

  submitButton.disabled = true;

  try {
    const response = await fetch('/api/public/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Submission failed');
    }

    setStatus('Submission saved and drug locked successfully.', 'success');
    form.reset();
    resetStudentRows();
    await loadDrugs();
  } catch (error) {
    setStatus(error.message, 'error');
    await loadDrugs();
  } finally {
    submitButton.disabled = false;
  }
});

resetStudentRows();
loadDrugs();
