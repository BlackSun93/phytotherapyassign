const http = require('http');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

function loadEnvFile(filePath) {
  try {
    const raw = fsSync.readFileSync(filePath, 'utf-8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        return;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    });
  } catch {
    // Skip when .env does not exist.
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_DASHBOARD_TOKEN = process.env.ADMIN_DASHBOARD_TOKEN || 'change-this-admin-token';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const HARDCODED_DRUGS = Array.from({ length: 20 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return {
    key: `drug-${number}`,
    name: `Drug ${number}`,
    is_active: true,
  };
});

const HARDCODED_DRUGS_BY_KEY = new Map(HARDCODED_DRUGS.map((drug) => [drug.key, drug]));

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function parseJsonBody(req) {
  const chunks = [];
  let totalLength = 0;

  for await (const chunk of req) {
    totalLength += chunk.length;
    if (totalLength > 1024 * 1024) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

async function serveStatic(res, pathname) {
  let relativePath = pathname;
  if (relativePath === '/') {
    relativePath = '/index.html';
  }
  if (relativePath === '/admin') {
    relativePath = '/admin.html';
  }
  if (relativePath === '/team') {
    relativePath = '/team.html';
  }

  const normalized = path
    .normalize(relativePath)
    .replace(/^([.][.][/\\])+/, '')
    .replace(/^[/\\]+/, '');

  const absolutePath = path.join(PUBLIC_DIR, normalized);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const fileContent = await fs.readFile(absolutePath);
    res.writeHead(200, {
      'Content-Type': getMimeType(absolutePath),
      'Content-Length': fileContent.length,
      'Cache-Control': 'no-store',
    });
    res.end(fileContent);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function isUuid(value) {
  return UUID_REGEX.test(String(value || '').trim());
}

function parseIntOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function toCleanString(value) {
  return String(value ?? '').trim();
}

function normalizeDrugKey(value) {
  return toCleanString(value).toLowerCase();
}

function getHardcodedDrugByKey(value) {
  return HARDCODED_DRUGS_BY_KEY.get(normalizeDrugKey(value)) || null;
}

function normalizeStudents(students) {
  if (!Array.isArray(students)) {
    return [];
  }

  return students
    .map((student) => ({
      student_id: toCleanString(student.student_id || student.studentId),
      student_name: toCleanString(student.student_name || student.studentName),
    }))
    .filter((student) => student.student_id && student.student_name);
}

function normalizeSubmissionPayload(input, { partial = false } = {}) {
  const payload = input || {};
  const cleaned = {};
  const errors = [];

  const hasCourseGroup = payload.courseGroup !== undefined || payload.course_group !== undefined;
  if (!partial || hasCourseGroup) {
    const rawCourseGroup = payload.courseGroup ?? payload.course_group;
    if (!partial && (rawCourseGroup === undefined || rawCourseGroup === null || rawCourseGroup === '')) {
      cleaned.course_group = 1;
    } else {
      const courseGroup = parseIntOrNull(rawCourseGroup);
      if (courseGroup === null || courseGroup < 1 || courseGroup > 4) {
        errors.push('Course group must be a number between 1 and 4.');
      } else {
        cleaned.course_group = courseGroup;
      }
    }
  }

  if (!partial || payload.teamNumber !== undefined || payload.team_number !== undefined) {
    const teamNumber = parseIntOrNull(payload.teamNumber ?? payload.team_number);
    if (teamNumber === null || teamNumber < 1 || teamNumber > 20) {
      errors.push('Team number must be a number between 1 and 20.');
    } else {
      cleaned.team_number = teamNumber;
    }
  }

  if (!partial || payload.leaderName !== undefined || payload.leader_name !== undefined) {
    const leaderName = toCleanString(payload.leaderName ?? payload.leader_name);
    if (!leaderName) {
      errors.push('Leader name is required.');
    } else {
      cleaned.leader_name = leaderName;
    }
  }

  if (!partial || payload.leaderEmail !== undefined || payload.leader_email !== undefined) {
    const leaderEmail = toCleanString(payload.leaderEmail ?? payload.leader_email).toLowerCase();
    if (!leaderEmail || !EMAIL_REGEX.test(leaderEmail)) {
      errors.push('A valid leader email is required.');
    } else {
      cleaned.leader_email = leaderEmail;
    }
  }

  if (!partial || payload.leaderPhone !== undefined || payload.leader_phone !== undefined) {
    const leaderPhone = toCleanString(payload.leaderPhone ?? payload.leader_phone);
    if (!leaderPhone) {
      errors.push('Leader phone is required.');
    } else {
      cleaned.leader_phone = leaderPhone;
    }
  }

  if (
    !partial ||
    payload.drugKey !== undefined ||
    payload.drug_key !== undefined ||
    payload.drugId !== undefined ||
    payload.drug_id !== undefined
  ) {
    const rawDrugKey = payload.drugKey ?? payload.drug_key ?? payload.drugId ?? payload.drug_id;
    const selectedDrug = getHardcodedDrugByKey(rawDrugKey);

    if (!selectedDrug) {
      errors.push('Select a valid drug from the hardcoded list.');
    } else {
      cleaned.drug_key = selectedDrug.key;
      cleaned.drug_name = selectedDrug.name;
    }
  }

  if (!partial || payload.students !== undefined) {
    const students = normalizeStudents(payload.students);
    if (students.length === 0) {
      errors.push('Add at least one student (ID + name).');
    } else if (students.length > 25) {
      errors.push('Maximum 25 students per team.');
    } else {
      cleaned.students = students;
    }
  }

  return {
    errors,
    cleaned,
  };
}

async function supabaseRequest({ table, method = 'GET', query = {}, body, prefer }) {
  if (!hasSupabaseConfig()) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const searchParams = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  });

  const url = `${SUPABASE_URL}/rest/v1/${table}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (prefer) {
    headers.Prefer = prefer;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const rawText = await response.text();
  let parsed = null;

  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }
  }

  if (!response.ok) {
    const error = new Error(`Supabase request failed with status ${response.status}`);
    error.status = response.status;
    error.data = parsed;
    throw error;
  }

  return parsed;
}

function getSupabaseErrorMessage(error) {
  if (!error) {
    return 'Unknown error';
  }
  if (typeof error.data === 'string') {
    return error.data;
  }
  if (Array.isArray(error.data) && error.data.length > 0) {
    return error.data[0]?.message || JSON.stringify(error.data[0]);
  }
  if (error.data?.message) {
    return error.data.message;
  }
  return error.message || 'Unknown error';
}

function isHardcodedDrugsMigrationError(message) {
  const normalized = toCleanString(message).toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('column "drug_key"') ||
    normalized.includes('column "drug_name"') ||
    (normalized.includes('column "drug_id"') && normalized.includes('null value')) ||
    normalized.includes('group_submissions_drug_id_fkey')
  );
}

async function getDrugTakenBySubmission(drugKey, excludeSubmissionId = null) {
  const query = {
    select: 'id,team_number,drug_key',
    drug_key: `eq.${normalizeDrugKey(drugKey)}`,
    limit: '1',
  };

  if (excludeSubmissionId) {
    query.id = `neq.${excludeSubmissionId}`;
  }

  const rows = await supabaseRequest({
    table: 'group_submissions',
    query,
  });

  return rows?.[0] || null;
}

function requireAdmin(req, res) {
  const token = toCleanString(req.headers['x-admin-token']);
  if (!token || token !== ADMIN_DASHBOARD_TOKEN) {
    sendJson(res, 401, { error: 'Unauthorized admin request.' });
    return false;
  }
  return true;
}

async function handlePublicDrugs(res) {
  try {
    const submissions = await supabaseRequest({
      table: 'group_submissions',
      query: {
        select: 'id,drug_key,team_number',
      },
    });

    const takenMap = new Map();
    (submissions || []).forEach((submission) => {
      if (submission.drug_key) {
        takenMap.set(normalizeDrugKey(submission.drug_key), {
          submission_id: submission.id,
          team_number: submission.team_number,
        });
      }
    });

    const data = HARDCODED_DRUGS.map((drug) => {
      const takenBy = takenMap.get(drug.key) || null;
      return {
        key: drug.key,
        name: drug.name,
        is_active: Boolean(drug.is_active),
        is_taken: Boolean(takenBy),
        taken_by: takenBy,
      };
    });

    sendJson(res, 200, { drugs: data });
  } catch (error) {
    const message = getSupabaseErrorMessage(error);
    if (isHardcodedDrugsMigrationError(message)) {
      sendJson(res, 500, {
        error: 'Database migration required for hardcoded drugs mode.',
        details: 'Run supabase/migrate_to_hardcoded_drugs.sql in Supabase SQL Editor.',
      });
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to load drugs.',
      details: message,
    });
  }
}

async function handlePublicSubmission(req, res) {
  let requestBody;

  try {
    requestBody = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const { errors, cleaned } = normalizeSubmissionPayload(requestBody, { partial: false });
  if (errors.length > 0) {
    sendJson(res, 400, { error: errors.join(' ') });
    return;
  }

  try {
    const drug = getHardcodedDrugByKey(cleaned.drug_key);
    if (!drug || !drug.is_active) {
      sendJson(res, 400, { error: 'This drug is not available for selection.' });
      return;
    }

    const takenBy = await getDrugTakenBySubmission(cleaned.drug_key);
    if (takenBy) {
      sendJson(res, 409, {
        error: `This drug is already taken by Team ${takenBy.team_number}.`,
      });
      return;
    }

    const insertedRows = await supabaseRequest({
      table: 'group_submissions',
      method: 'POST',
      body: cleaned,
      prefer: 'return=representation',
    });

    sendJson(res, 201, {
      message: 'Group submission saved successfully.',
      submission: insertedRows?.[0] || null,
    });
  } catch (error) {
    const message = getSupabaseErrorMessage(error);

    if (message.includes('group_submissions_drug_key_key') || message.includes('group_submissions_drug_id_key')) {
      sendJson(res, 409, { error: 'This drug was just taken by another team. Please pick another drug.' });
      return;
    }

    if (message.includes('group_submissions_course_group_team_number_key')) {
      sendJson(res, 409, { error: 'This team number was already submitted.' });
      return;
    }

    if (isHardcodedDrugsMigrationError(message)) {
      sendJson(res, 500, {
        error: 'Database migration required for hardcoded drugs mode.',
        details: 'Run supabase/migrate_to_hardcoded_drugs.sql in Supabase SQL Editor.',
      });
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to save submission.',
      details: message,
    });
  }
}

async function handleAdminOverview(res) {
  try {
    const submissions = await supabaseRequest({
      table: 'group_submissions',
      query: {
        select:
          'id,course_group,team_number,leader_name,leader_email,leader_phone,students,drug_key,drug_name,created_at,updated_at',
        order: 'created_at.asc',
      },
    });

    const takenByKey = new Map();
    (submissions || []).forEach((submission) => {
      if (submission.drug_key) {
        takenByKey.set(normalizeDrugKey(submission.drug_key), {
          submission_id: submission.id,
          team_number: submission.team_number,
        });
      }
    });

    const drugs = HARDCODED_DRUGS.map((drug) => ({
      key: drug.key,
      name: drug.name,
      is_active: Boolean(drug.is_active),
      is_taken: takenByKey.has(drug.key),
      taken_by: takenByKey.get(drug.key) || null,
    }));

    sendJson(res, 200, {
      drugs,
      submissions: submissions || [],
    });
  } catch (error) {
    const message = getSupabaseErrorMessage(error);
    if (isHardcodedDrugsMigrationError(message)) {
      sendJson(res, 500, {
        error: 'Database migration required for hardcoded drugs mode.',
        details: 'Run supabase/migrate_to_hardcoded_drugs.sql in Supabase SQL Editor.',
      });
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to load admin data.',
      details: message,
    });
  }
}

async function handleAdminCreateSubmission(req, res) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const { errors, cleaned } = normalizeSubmissionPayload(body, { partial: false });
  if (errors.length > 0) {
    sendJson(res, 400, { error: errors.join(' ') });
    return;
  }

  try {
    const drug = getHardcodedDrugByKey(cleaned.drug_key);
    if (!drug) {
      sendJson(res, 400, { error: 'Drug does not exist.' });
      return;
    }

    const takenBy = await getDrugTakenBySubmission(cleaned.drug_key);
    if (takenBy) {
      sendJson(res, 409, {
        error: `Drug already used by Team ${takenBy.team_number}.`,
      });
      return;
    }

    const inserted = await supabaseRequest({
      table: 'group_submissions',
      method: 'POST',
      body: cleaned,
      prefer: 'return=representation',
    });

    sendJson(res, 201, {
      message: 'Submission created.',
      submission: inserted?.[0] || null,
    });
  } catch (error) {
    const message = getSupabaseErrorMessage(error);
    if (isHardcodedDrugsMigrationError(message)) {
      sendJson(res, 500, {
        error: 'Database migration required for hardcoded drugs mode.',
        details: 'Run supabase/migrate_to_hardcoded_drugs.sql in Supabase SQL Editor.',
      });
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to create submission.',
      details: message,
    });
  }
}

async function handleAdminUpdateSubmission(req, res, id) {
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'Invalid submission ID.' });
    return;
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const { errors, cleaned } = normalizeSubmissionPayload(body, { partial: true });
  if (errors.length > 0) {
    sendJson(res, 400, { error: errors.join(' ') });
    return;
  }

  if (Object.keys(cleaned).length === 0) {
    sendJson(res, 400, { error: 'No valid fields to update.' });
    return;
  }

  try {
    if (cleaned.drug_key) {
      const drug = getHardcodedDrugByKey(cleaned.drug_key);
      if (!drug) {
        sendJson(res, 400, { error: 'Drug does not exist.' });
        return;
      }

      const takenBy = await getDrugTakenBySubmission(cleaned.drug_key, id);
      if (takenBy) {
        sendJson(res, 409, {
          error: `Drug already used by Team ${takenBy.team_number}.`,
        });
        return;
      }
    }

    const updated = await supabaseRequest({
      table: 'group_submissions',
      method: 'PATCH',
      query: {
        id: `eq.${id}`,
      },
      body: cleaned,
      prefer: 'return=representation',
    });

    if (!updated || updated.length === 0) {
      sendJson(res, 404, { error: 'Submission not found.' });
      return;
    }

    sendJson(res, 200, {
      message: 'Submission updated.',
      submission: updated[0],
    });
  } catch (error) {
    const message = getSupabaseErrorMessage(error);
    if (isHardcodedDrugsMigrationError(message)) {
      sendJson(res, 500, {
        error: 'Database migration required for hardcoded drugs mode.',
        details: 'Run supabase/migrate_to_hardcoded_drugs.sql in Supabase SQL Editor.',
      });
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to update submission.',
      details: message,
    });
  }
}

async function handleAdminDeleteSubmission(res, id) {
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'Invalid submission ID.' });
    return;
  }

  try {
    const deleted = await supabaseRequest({
      table: 'group_submissions',
      method: 'DELETE',
      query: {
        id: `eq.${id}`,
      },
      prefer: 'return=representation',
    });

    if (!deleted || deleted.length === 0) {
      sendJson(res, 404, { error: 'Submission not found.' });
      return;
    }

    sendJson(res, 200, { message: 'Submission deleted.' });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Failed to delete submission.',
      details: getSupabaseErrorMessage(error),
    });
  }
}

async function handleApi(req, res, pathname) {
  if (!hasSupabaseConfig()) {
    sendJson(res, 500, {
      error: 'Server is missing Supabase environment variables.',
      required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    });
    return;
  }

  if (pathname === '/api/public/drugs' && req.method === 'GET') {
    await handlePublicDrugs(res);
    return;
  }

  if (pathname === '/api/public/submit' && req.method === 'POST') {
    await handlePublicSubmission(req, res);
    return;
  }

  if (!pathname.startsWith('/api/admin/')) {
    sendJson(res, 404, { error: 'API route not found.' });
    return;
  }

  if (!requireAdmin(req, res)) {
    return;
  }

  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    await handleAdminOverview(res);
    return;
  }

  if (pathname === '/api/admin/submissions' && req.method === 'POST') {
    await handleAdminCreateSubmission(req, res);
    return;
  }

  if (pathname.startsWith('/api/admin/submissions/')) {
    const id = pathname.split('/').pop();
    if (req.method === 'PATCH') {
      await handleAdminUpdateSubmission(req, res, id);
      return;
    }
    if (req.method === 'DELETE') {
      await handleAdminDeleteSubmission(res, id);
      return;
    }
  }

  if (pathname === '/api/admin/drugs' || pathname.startsWith('/api/admin/drugs/')) {
    sendJson(res, 410, { error: 'Drug list is hardcoded and cannot be edited from admin.' });
    return;
  }

  sendJson(res, 404, { error: 'API route not found.' });
}

async function handleRequest(req, res) {
  if (!req.url) {
    sendText(res, 400, 'Bad request');
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    if (req.method !== 'GET') {
      sendText(res, 405, 'Method Not Allowed');
      return;
    }

    await serveStatic(res, pathname);
  } catch (error) {
    sendJson(res, 500, {
      error: 'Unexpected server error.',
      details: error.message,
    });
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;
