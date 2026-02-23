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

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

let drugs = [];
let students = [];
let selectedStudentIndex = -1;
let editingStudentIndex = -1;
let selectedDrugKey = preferredDrugKey;
let heartbeatTimer = null;
let reservation = {
  drugKey: '',
  holderToken: '',
  expiresAt: null,
};

function setStatus(message, type = 'success') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function reservationStorageKey(drugKey) {
  return `phytotherapy-reservation:${drugKey}`;
}

function getStoredReservationToken(drugKey) {
  if (!drugKey) {
    return '';
  }

  try {
    return window.sessionStorage.getItem(reservationStorageKey(drugKey)) || '';
  } catch {
    return '';
  }
}

function setStoredReservationToken(drugKey, holderToken) {
  if (!drugKey || !holderToken) {
    return;
  }

  try {
    window.sessionStorage.setItem(reservationStorageKey(drugKey), holderToken);
  } catch {
    // Ignore storage errors.
  }
}

function clearStoredReservationToken(drugKey) {
  if (!drugKey) {
    return;
  }

  try {
    window.sessionStorage.removeItem(reservationStorageKey(drugKey));
  } catch {
    // Ignore storage errors.
  }
}

function getDrugListUrl() {
  const tokenCandidate = reservation.holderToken || getStoredReservationToken(selectedDrugKey || preferredDrugKey);
  if (!tokenCandidate) {
    return '/api/public/drugs';
  }

  return `/api/public/drugs?holderToken=${encodeURIComponent(tokenCandidate)}`;
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

function isSelectableDrug(drug) {
  if (!drug.is_active) {
    return false;
  }

  if (drug.is_taken) {
    return false;
  }

  if (!drug.is_reserved) {
    return true;
  }

  return Boolean(drug.reserved_by_current_holder);
}

function getSelectableDrugs() {
  return drugs.filter((drug) => isSelectableDrug(drug));
}

function syncSubmitEnabled() {
  const selectedKey = drugSelect.value;
  const hasReservation =
    Boolean(reservation.holderToken) && Boolean(selectedKey) && reservation.drugKey === selectedKey;
  submitButton.disabled = !hasReservation;
}

function renderDrugOptions() {
  const selectableDrugs = getSelectableDrugs();
  drugSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = selectableDrugs.length ? 'Select drug' : 'No available drugs';
  placeholder.disabled = true;
  placeholder.selected = true;
  drugSelect.appendChild(placeholder);

  selectableDrugs.forEach((drug) => {
    const option = document.createElement('option');
    option.value = drug.key;
    option.textContent = drug.name;
    drugSelect.appendChild(option);
  });

  const stillAvailable = selectableDrugs.find((drug) => drug.key === selectedDrugKey);
  if (stillAvailable) {
    drugSelect.value = selectedDrugKey;
  } else {
    selectedDrugKey = '';
  }

  if (!selectableDrugs.length) {
    setStatus('No available drugs right now. Please return to the drug list.', 'error');
  }

  syncSubmitEnabled();
}

async function loadDrugs() {
  try {
    const response = await fetch(getDrugListUrl(), {
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

function startHeartbeat() {
  stopHeartbeat();

  heartbeatTimer = window.setInterval(async () => {
    if (!reservation.drugKey || !reservation.holderToken) {
      return;
    }

    const refreshed = await reserveDrug(reservation.drugKey, {
      silent: true,
      allowStoredToken: false,
      releaseCurrentFirst: false,
    });

    if (!refreshed) {
      stopHeartbeat();
      clearStoredReservationToken(reservation.drugKey);
      reservation = {
        drugKey: '',
        holderToken: '',
        expiresAt: null,
      };
      syncSubmitEnabled();
      await loadDrugs();
      setStatus('Your reservation expired or was lost. Please select the drug again.', 'error');
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function releaseReservation(drugKey, holderToken, { silent = true } = {}) {
  if (!drugKey || !holderToken) {
    return true;
  }

  try {
    await fetch('/api/public/reservations', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        drugKey,
        holderToken,
      }),
    });

    clearStoredReservationToken(drugKey);
    return true;
  } catch (error) {
    if (!silent) {
      setStatus(error.message || 'Failed to release reservation.', 'error');
    }

    return false;
  }
}

async function reserveDrug(
  drugKey,
  {
    silent = false,
    allowStoredToken = true,
    releaseCurrentFirst = true,
  } = {},
) {
  if (!drugKey) {
    return false;
  }

  const previousReservation = { ...reservation };

  if (releaseCurrentFirst && previousReservation.drugKey && previousReservation.drugKey !== drugKey) {
    stopHeartbeat();
    await releaseReservation(previousReservation.drugKey, previousReservation.holderToken, { silent: true });
    reservation = {
      drugKey: '',
      holderToken: '',
      expiresAt: null,
    };
  }

  let holderToken = '';
  if (reservation.drugKey === drugKey && reservation.holderToken) {
    holderToken = reservation.holderToken;
  } else if (allowStoredToken) {
    holderToken = getStoredReservationToken(drugKey);
  }

  try {
    const response = await fetch('/api/public/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        drugKey,
        holderToken,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Failed to reserve drug');
    }

    reservation = {
      drugKey: result.reservation.drug_key,
      holderToken: result.reservation.holder_token,
      expiresAt: result.reservation.expires_at,
    };

    selectedDrugKey = reservation.drugKey;
    drugSelect.value = reservation.drugKey;
    setStoredReservationToken(reservation.drugKey, reservation.holderToken);
    startHeartbeat();
    syncSubmitEnabled();

    if (!silent) {
      setStatus('Drug reserved for 10 minutes. Keep this page open until submit.', 'success');
    }

    return true;
  } catch (error) {
    reservation = {
      drugKey: '',
      holderToken: '',
      expiresAt: null,
    };
    syncSubmitEnabled();

    if (!silent) {
      setStatus(error.message, 'error');
    }

    return false;
  }
}

async function switchSelectedDrugReservation(drugKey) {
  if (!drugKey) {
    selectedDrugKey = '';
    syncSubmitEnabled();
    return;
  }

  const reserved = await reserveDrug(drugKey, { silent: false });
  if (!reserved) {
    selectedDrugKey = '';
    drugSelect.value = '';
  }

  await loadDrugs();
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

drugSelect.addEventListener('change', async (event) => {
  const nextDrugKey = event.target.value;
  selectedDrugKey = nextDrugKey;
  await switchSelectedDrugReservation(nextDrugKey);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('');

  if (students.length === 0) {
    setStatus('Add at least one student before submitting.', 'error');
    return;
  }

  const selectedKey = drugSelect.value;
  if (!selectedKey || reservation.drugKey !== selectedKey || !reservation.holderToken) {
    setStatus('Please select a drug and wait until reservation is active.', 'error');
    return;
  }

  const payload = {
    teamNumber: Number.parseInt(document.getElementById('team-number').value, 10),
    leaderName: document.getElementById('leader-name').value.trim(),
    leaderEmail: document.getElementById('leader-email').value.trim(),
    leaderPhone: document.getElementById('leader-phone').value.trim(),
    drugKey: selectedKey,
    holderToken: reservation.holderToken,
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

    clearStoredReservationToken(reservation.drugKey);
    stopHeartbeat();
    reservation = {
      drugKey: '',
      holderToken: '',
      expiresAt: null,
    };

    setStatus('Submission saved and drug locked successfully.', 'success');
    form.reset();
    students = [];
    selectedDrugKey = '';
    selectedStudentIndex = -1;
    resetStudentEditor();
    renderStudents();
    await loadDrugs();
  } catch (error) {
    setStatus(error.message, 'error');
    await loadDrugs();
  } finally {
    syncSubmitEnabled();
  }
});

window.addEventListener('pagehide', () => {
  if (!reservation.drugKey || !reservation.holderToken) {
    return;
  }

  const payload = JSON.stringify({
    drugKey: reservation.drugKey,
    holderToken: reservation.holderToken,
  });

  try {
    fetch('/api/public/reservations', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
      keepalive: true,
    });
  } catch {
    // Ignore cleanup errors on page close.
  }

  clearStoredReservationToken(reservation.drugKey);
  stopHeartbeat();
});

async function initialize() {
  renderStudents();
  await loadDrugs();

  if (!preferredDrugKey) {
    return;
  }

  selectedDrugKey = preferredDrugKey;
  const reserved = await reserveDrug(preferredDrugKey, { silent: true });

  if (!reserved) {
    selectedDrugKey = '';
    setStatus('Selected drug is no longer available. Please choose another one.', 'error');
  } else {
    setStatus('Selected drug reserved for your group. Complete submission within 10 minutes.', 'success');
  }

  await loadDrugs();
}

initialize();
