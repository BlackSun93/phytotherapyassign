const form = document.getElementById('submission-form');
const statusEl = document.getElementById('status');
const submitButton = document.getElementById('submit-button');
const drugSelect = document.getElementById('drug-id');
const studentIdEntryInput = document.getElementById('student-id-entry');
const studentNameEntryInput = document.getElementById('student-name-entry');
const addStudentBtn = document.getElementById('add-student');
const editSelectedBtn = document.getElementById('edit-selected');
const removeSelectedBtn = document.getElementById('remove-selected');
const studentsListEl = document.getElementById('students-list');

const preferredDrugKey =
  new URLSearchParams(window.location.search).get('drugKey') ||
  new URLSearchParams(window.location.search).get('drugId') ||
  '';

let drugs = [];
let students = [];
let selectedStudentIndex = -1;
let editingStudentIndex = -1;

function setStatus(message, type = 'success') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function parseStudentEntry(studentIdValue, studentNameValue) {
  const studentId = (studentIdValue || '').trim();
  const studentName = (studentNameValue || '').trim();
  if (!studentId || !studentName) {
    return null;
  }

  return {
    student_id: studentId,
    student_name: studentName,
  };
}

function updateStudentActionButtons() {
  const hasSelection = selectedStudentIndex >= 0 && selectedStudentIndex < students.length;
  editSelectedBtn.disabled = !hasSelection;
  removeSelectedBtn.disabled = !hasSelection;
}

function resetStudentEditor() {
  editingStudentIndex = -1;
  addStudentBtn.textContent = 'Add Student';
  studentIdEntryInput.value = '';
  studentNameEntryInput.value = '';
}

function renderStudents() {
  studentsListEl.innerHTML = '';

  if (students.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'student-chip empty';
    empty.textContent = 'No students added yet.';
    studentsListEl.appendChild(empty);
    selectedStudentIndex = -1;
    updateStudentActionButtons();
    return;
  }

  students.forEach((student, index) => {
    const item = document.createElement('li');
    item.className = `student-chip${selectedStudentIndex === index ? ' selected' : ''}`;
    item.textContent = `${student.student_id} - ${student.student_name}`;
    item.title = 'Click to select, then use Edit or Remove.';

    item.addEventListener('click', () => {
      selectedStudentIndex = index;
      renderStudents();
    });

    studentsListEl.appendChild(item);
  });

  updateStudentActionButtons();
}

function addOrSaveStudent() {
  const parsed = parseStudentEntry(studentIdEntryInput.value, studentNameEntryInput.value);
  if (!parsed) {
    setStatus('Please enter both student ID and student name.', 'error');
    return;
  }

  if (editingStudentIndex >= 0) {
    students[editingStudentIndex] = parsed;
    selectedStudentIndex = -1;
    resetStudentEditor();
    renderStudents();
    setStatus('Student updated.', 'success');
    return;
  }

  students.push(parsed);
  selectedStudentIndex = -1;
  studentIdEntryInput.value = '';
  studentNameEntryInput.value = '';
  renderStudents();
  setStatus('Student added.', 'success');
}

function editSelectedStudent() {
  if (selectedStudentIndex < 0 || selectedStudentIndex >= students.length) {
    return;
  }

  const selected = students[selectedStudentIndex];
  studentIdEntryInput.value = selected.student_id;
  studentNameEntryInput.value = selected.student_name;
  editingStudentIndex = selectedStudentIndex;
  addStudentBtn.textContent = 'Save Student';
  studentIdEntryInput.focus();
}

function removeSelectedStudent() {
  if (selectedStudentIndex < 0 || selectedStudentIndex >= students.length) {
    return;
  }

  students.splice(selectedStudentIndex, 1);
  selectedStudentIndex = -1;
  if (editingStudentIndex >= 0) {
    resetStudentEditor();
  }
  renderStudents();
  setStatus('Student removed.', 'success');
}

function getAvailableDrugsWithSelection() {
  return drugs.filter((drug) => {
    if (!drug.is_active) {
      return false;
    }
    if (!drug.is_taken) {
      return true;
    }
    return drug.key === preferredDrugKey;
  });
}

function renderDrugOptions() {
  const availableDrugs = getAvailableDrugsWithSelection();
  drugSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = availableDrugs.length ? 'Select drug' : 'No available drugs';
  placeholder.disabled = true;
  placeholder.selected = true;
  drugSelect.appendChild(placeholder);

  availableDrugs.forEach((drug) => {
    const option = document.createElement('option');
    option.value = drug.key;
    option.textContent = drug.name;
    drugSelect.appendChild(option);
  });

  if (availableDrugs.length === 0) {
    setStatus('No available drugs right now. Please return to drug list.', 'error');
    submitButton.disabled = true;
    return;
  }

  const selectedDrug = availableDrugs.find((drug) => drug.key === preferredDrugKey);
  if (selectedDrug) {
    drugSelect.value = selectedDrug.key;
  } else {
    drugSelect.selectedIndex = 1;
    if (preferredDrugKey) {
      setStatus('Selected drug is no longer available. Please choose another one.', 'error');
    }
  }

  submitButton.disabled = false;
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

addStudentBtn.addEventListener('click', addOrSaveStudent);

studentIdEntryInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addOrSaveStudent();
  }
});

studentNameEntryInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addOrSaveStudent();
  }
});

editSelectedBtn.addEventListener('click', editSelectedStudent);
removeSelectedBtn.addEventListener('click', removeSelectedStudent);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('');

  if (students.length === 0) {
    setStatus('Add at least one student before submitting.', 'error');
    return;
  }

  const payload = {
    teamNumber: Number.parseInt(document.getElementById('team-number').value, 10),
    leaderName: document.getElementById('leader-name').value.trim(),
    leaderEmail: document.getElementById('leader-email').value.trim(),
    leaderPhone: document.getElementById('leader-phone').value.trim(),
    drugKey: drugSelect.value,
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
    students = [];
    selectedStudentIndex = -1;
    resetStudentEditor();
    renderStudents();
    await loadDrugs();
  } catch (error) {
    setStatus(error.message, 'error');
    await loadDrugs();
  } finally {
    submitButton.disabled = false;
  }
});

renderStudents();
loadDrugs();
