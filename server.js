const http = require('http');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { URL } = require('url');
const { Pool } = require('pg');

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

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRUG_KEY_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVATION_TTL_MINUTES = 10;
const RESERVATION_HEARTBEAT_SECONDS = 30;

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

let pool = null;

function hasDatabaseConfig() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!pool) {
    const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
  }

  return pool;
}

async function dbQuery(text, values = []) {
  const result = await getPool().query(text, values);
  return result;
}

async function runQuery(client, text, values = []) {
  if (client) {
    return client.query(text, values);
  }

  return dbQuery(text, values);
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
  if (relativePath === '/group') {
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

function slugifyDrugKey(value) {
  const slug = toCleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug;
}

function normalizeBaseDrugKey(value) {
  const normalized = slugifyDrugKey(value);
  const fallback = normalized || 'drug';
  return fallback.slice(0, 64);
}

function buildSuffixedDrugKey(baseKey, suffix) {
  const suffixText = `-${suffix}`;
  const maxBaseLength = Math.max(1, 64 - suffixText.length);
  return `${baseKey.slice(0, maxBaseLength)}${suffixText}`;
}

function parseBooleanOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = toCleanString(value).toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return null;
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
      errors.push('Group number must be a number between 1 and 20.');
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

  const hasDrugKey =
    payload.drugKey !== undefined ||
    payload.drug_key !== undefined ||
    payload.drugId !== undefined ||
    payload.drug_id !== undefined;

  if (!partial || hasDrugKey) {
    const rawDrugKey = payload.drugKey ?? payload.drug_key ?? payload.drugId ?? payload.drug_id;
    const drugKey = normalizeDrugKey(rawDrugKey);
    if (!drugKey) {
      errors.push('Select a valid drug.');
    } else {
      cleaned.drug_key = drugKey;
    }
  }

  if (!partial || payload.students !== undefined) {
    const students = normalizeStudents(payload.students);
    if (students.length === 0) {
      errors.push('Add at least one student (ID + name).');
    } else if (students.length > 25) {
      errors.push('Maximum 25 students per group.');
    } else {
      cleaned.students = students;
    }
  }

  return {
    errors,
    cleaned,
  };
}

function normalizeAdminDrugPayload(input, { partial = false } = {}) {
  const payload = input || {};
  const cleaned = {};
  const errors = [];

  const hasName = payload.name !== undefined;
  if (!partial || hasName) {
    const name = toCleanString(payload.name);
    if (!name) {
      errors.push('Drug name is required.');
    } else {
      cleaned.name = name;
    }
  }

  const hasKey =
    payload.key !== undefined ||
    payload.drugKey !== undefined ||
    payload.drug_key !== undefined ||
    payload.slug !== undefined;

  if (!partial || hasKey) {
    const rawKey = payload.key ?? payload.drugKey ?? payload.drug_key ?? payload.slug;
    const key = normalizeDrugKey(rawKey);
    if (!key) {
      if (!partial && cleaned.name) {
        cleaned.key = slugifyDrugKey(cleaned.name);
      } else {
        errors.push('Drug key is required.');
      }
    } else {
      cleaned.key = key;
    }
  }

  if (cleaned.key && !DRUG_KEY_REGEX.test(cleaned.key)) {
    errors.push('Drug key must use lowercase letters, numbers, and dashes only.');
  }

  const hasActive = payload.isActive !== undefined || payload.is_active !== undefined;
  if (!partial || hasActive) {
    const isActive = parseBooleanOrNull(payload.isActive ?? payload.is_active);
    if (isActive === null) {
      if (!partial) {
        cleaned.is_active = true;
      } else {
        errors.push('isActive must be true or false.');
      }
    } else {
      cleaned.is_active = isActive;
    }
  }

  const hasSort = payload.sortOrder !== undefined || payload.sort_order !== undefined;
  if (!partial || hasSort) {
    const sortOrder = parseIntOrNull(payload.sortOrder ?? payload.sort_order);
    if (sortOrder === null) {
      if (!partial) {
        cleaned.sort_order = 0;
      } else {
        errors.push('sortOrder must be a number.');
      }
    } else {
      cleaned.sort_order = sortOrder;
    }
  }

  return {
    errors,
    cleaned,
  };
}

function normalizeReservationPayload(input, { requireHolderToken = false } = {}) {
  const payload = input || {};
  const errors = [];

  const drugKey = normalizeDrugKey(payload.drugKey ?? payload.drug_key ?? payload.drugId ?? payload.drug_id);
  if (!drugKey) {
    errors.push('Drug key is required.');
  }

  const holderToken = toCleanString(payload.holderToken ?? payload.holder_token);
  if (requireHolderToken && !holderToken) {
    errors.push('Reservation holder token is required.');
  }

  return {
    errors,
    cleaned: {
      drug_key: drugKey,
      holder_token: holderToken,
    },
  };
}

function getDbErrorMessage(error) {
  if (!error) {
    return 'Unknown database error';
  }

  const detail = toCleanString(error.detail);
  if (detail) {
    return `${error.message || 'Database error'} (${detail})`;
  }

  return error.message || 'Database error';
}

function isSchemaMigrationError(error) {
  const code = toCleanString(error?.code);
  if (code === '42P01' || code === '42703') {
    return true;
  }

  const message = `${toCleanString(error?.message)} ${toCleanString(error?.detail)}`.toLowerCase();
  if (!message) {
    return false;
  }

  if (message.includes('drugs') && message.includes('does not exist')) {
    return true;
  }

  if (message.includes('drug_reservations') && message.includes('does not exist')) {
    return true;
  }

  return (
    message.includes('group_submissions') &&
    (message.includes('drug_key') || message.includes('drug_name') || message.includes('does not exist'))
  );
}

function mapSubmissionConstraintError(error) {
  if (!error || error.code !== '23505') {
    return null;
  }

  const constraint = toCleanString(error.constraint);

  if (constraint.includes('group_submissions_drug_key_key')) {
    return {
      status: 409,
      message: 'This drug was just taken by another group. Please pick another drug.',
    };
  }

  if (constraint.includes('group_submissions_course_group_team_number_key')) {
    return {
      status: 409,
      message: 'This group number was already submitted.',
    };
  }

  return null;
}

function mapDrugConstraintError(error) {
  if (!error || error.code !== '23505') {
    return null;
  }

  return {
    status: 409,
    message: 'A drug with similar name already exists. Please retry or slightly change the name.',
  };
}

function sendMigrationError(res) {
  sendJson(res, 500, {
    error: 'Database schema is not ready.',
    details:
      'Run supabase/schema.sql for a new DB, or run supabase/migrate_to_full_management.sql then supabase/migrate_add_reservations.sql for existing DBs.',
  });
}

async function getSubmissionRows(client = null) {
  const result = await runQuery(
    client,
    `
      select
        id,
        course_group,
        team_number,
        leader_name,
        leader_email,
        leader_phone,
        students,
        drug_key,
        drug_name,
        created_at,
        updated_at
      from public.group_submissions
      order by created_at asc
    `,
  );

  return result.rows || [];
}

async function getDrugRows({ activeOnly = false, client = null } = {}) {
  const sql = `
    select
      lower(key) as key,
      name,
      is_active,
      sort_order,
      created_at,
      updated_at
    from public.drugs
    ${activeOnly ? 'where is_active = true' : ''}
    order by sort_order asc, name asc
  `;

  const result = await runQuery(client, sql);
  return result.rows || [];
}

async function getDrugByKey(drugKey, client = null) {
  const key = normalizeDrugKey(drugKey);
  if (!key) {
    return null;
  }

  const result = await runQuery(
    client,
    `
      select
        lower(key) as key,
        name,
        is_active,
        sort_order,
        created_at,
        updated_at
      from public.drugs
      where lower(key) = $1
      limit 1
    `,
    [key],
  );

  return result.rows[0] || null;
}

async function getNextAvailableDrugKey(baseKey, client = null) {
  const normalizedBaseKey = normalizeBaseDrugKey(baseKey);

  const baseKeyDrug = await getDrugByKey(normalizedBaseKey, client);
  if (!baseKeyDrug) {
    return normalizedBaseKey;
  }

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = buildSuffixedDrugKey(normalizedBaseKey, suffix);
    // eslint-disable-next-line no-await-in-loop
    const candidateDrug = await getDrugByKey(candidate, client);
    if (!candidateDrug) {
      return candidate;
    }
  }

  return buildSuffixedDrugKey(normalizedBaseKey, Date.now().toString(36));
}

async function purgeExpiredReservations(client = null) {
  await runQuery(client, 'delete from public.drug_reservations where expires_at <= timezone(\'utc\', now())');
}

async function getReservationRows(client = null) {
  const result = await runQuery(
    client,
    `
      select
        lower(drug_key) as drug_key,
        holder_token,
        expires_at
      from public.drug_reservations
      where expires_at > timezone('utc', now())
      order by created_at asc
    `,
  );

  return result.rows || [];
}

async function getReservationByDrugKey(drugKey, client = null) {
  const key = normalizeDrugKey(drugKey);
  if (!key) {
    return null;
  }

  const result = await runQuery(
    client,
    `
      select
        lower(drug_key) as drug_key,
        holder_token,
        expires_at
      from public.drug_reservations
      where lower(drug_key) = $1
        and expires_at > timezone('utc', now())
      limit 1
    `,
    [key],
  );

  return result.rows[0] || null;
}

function createTakenMap(submissions) {
  const takenMap = new Map();
  submissions.forEach((submission) => {
    if (submission.drug_key) {
      takenMap.set(normalizeDrugKey(submission.drug_key), {
        submission_id: submission.id,
        team_number: submission.team_number,
      });
    }
  });

  return takenMap;
}

function createReservationMap(reservations) {
  const reservationMap = new Map();
  reservations.forEach((reservation) => {
    reservationMap.set(normalizeDrugKey(reservation.drug_key), {
      holder_token: reservation.holder_token,
      expires_at: reservation.expires_at,
    });
  });

  return reservationMap;
}

function combineDrugsWithLocks(drugs, takenMap, reservationMap, currentHolderToken = '') {
  const holderToken = toCleanString(currentHolderToken);

  return drugs.map((drug) => {
    const normalizedKey = normalizeDrugKey(drug.key);
    const takenBy = takenMap.get(normalizedKey) || null;
    const reservation = reservationMap.get(normalizedKey) || null;
    const isReserved = !takenBy && Boolean(reservation);
    const reservedByCurrentHolder =
      isReserved && holderToken && reservation && reservation.holder_token === holderToken;

    return {
      ...drug,
      is_taken: Boolean(takenBy),
      taken_by: takenBy,
      is_reserved: isReserved,
      reserved_until: reservation ? reservation.expires_at : null,
      reserved_by_current_holder: Boolean(reservedByCurrentHolder),
      is_locked: Boolean(takenBy) || isReserved,
    };
  });
}

async function getDrugTakenBySubmission(drugKey, excludeSubmissionId = null, client = null) {
  const values = [normalizeDrugKey(drugKey)];
  let sql = `
    select id, team_number, drug_key
    from public.group_submissions
    where lower(drug_key) = $1
  `;

  if (excludeSubmissionId) {
    sql += ' and id <> $2::uuid';
    values.push(excludeSubmissionId);
  }

  sql += ' order by created_at asc limit 1';

  const result = await runQuery(client, sql, values);
  return result.rows[0] || null;
}

async function handlePublicDrugs(res, requestUrl) {
  try {
    const currentHolderToken = toCleanString(requestUrl?.searchParams?.get('holderToken'));
    await purgeExpiredReservations();

    const [drugs, submissions, reservations] = await Promise.all([
      getDrugRows({ activeOnly: false }),
      getSubmissionRows(),
      getReservationRows(),
    ]);

    const takenMap = createTakenMap(submissions);
    const reservationMap = createReservationMap(reservations);

    sendJson(res, 200, {
      drugs: combineDrugsWithLocks(drugs, takenMap, reservationMap, currentHolderToken),
      reservation_ttl_minutes: RESERVATION_TTL_MINUTES,
      heartbeat_seconds: RESERVATION_HEARTBEAT_SECONDS,
    });
  } catch (error) {
    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to load drugs.',
      details: getDbErrorMessage(error),
    });
  }
}

async function handlePublicUpsertReservation(req, res) {
  let requestBody;

  try {
    requestBody = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const { errors, cleaned } = normalizeReservationPayload(requestBody, { requireHolderToken: false });
  if (errors.length > 0) {
    sendJson(res, 400, { error: errors.join(' ') });
    return;
  }

  const holderToken = cleaned.holder_token || randomUUID();

  try {
    await purgeExpiredReservations();

    const selectedDrug = await getDrugByKey(cleaned.drug_key);
    if (!selectedDrug) {
      sendJson(res, 404, { error: 'Drug not found.' });
      return;
    }

    if (!selectedDrug.is_active) {
      sendJson(res, 409, { error: 'This drug is currently inactive.' });
      return;
    }

    const takenBy = await getDrugTakenBySubmission(cleaned.drug_key);
    if (takenBy) {
      sendJson(res, 409, { error: `This drug is already taken by Group ${takenBy.team_number}.` });
      return;
    }

    const reservationResult = await dbQuery(
      `
        insert into public.drug_reservations (drug_key, holder_token, expires_at)
        values ($1, $2, timezone('utc', now()) + interval '${RESERVATION_TTL_MINUTES} minutes')
        on conflict (drug_key)
        do update
          set expires_at = timezone('utc', now()) + interval '${RESERVATION_TTL_MINUTES} minutes',
              updated_at = timezone('utc', now())
        where public.drug_reservations.holder_token = excluded.holder_token
        returning
          lower(drug_key) as drug_key,
          holder_token,
          expires_at
      `,
      [cleaned.drug_key, holderToken],
    );

    if (reservationResult.rows.length === 0) {
      const currentReservation = await getReservationByDrugKey(cleaned.drug_key);
      if (currentReservation && currentReservation.holder_token !== holderToken) {
        sendJson(res, 409, { error: 'This drug is currently reserved by another group. Please choose another one.' });
        return;
      }

      sendJson(res, 409, { error: 'Failed to reserve this drug. Please try again.' });
      return;
    }

    sendJson(res, 200, {
      message: 'Reservation is active.',
      reservation: reservationResult.rows[0],
      reservation_ttl_minutes: RESERVATION_TTL_MINUTES,
      heartbeat_seconds: RESERVATION_HEARTBEAT_SECONDS,
    });
  } catch (error) {
    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to reserve drug.',
      details: getDbErrorMessage(error),
    });
  }
}

async function handlePublicReleaseReservation(req, res) {
  let requestBody;

  try {
    requestBody = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const { errors, cleaned } = normalizeReservationPayload(requestBody, { requireHolderToken: true });
  if (errors.length > 0) {
    sendJson(res, 400, { error: errors.join(' ') });
    return;
  }

  try {
    await purgeExpiredReservations();

    const result = await dbQuery(
      `
        delete from public.drug_reservations
        where lower(drug_key) = $1 and holder_token = $2
        returning lower(drug_key) as drug_key
      `,
      [cleaned.drug_key, cleaned.holder_token],
    );

    sendJson(res, 200, {
      message: result.rows.length > 0 ? 'Reservation released.' : 'No active reservation found.',
    });
  } catch (error) {
    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to release reservation.',
      details: getDbErrorMessage(error),
    });
  }
}

async function insertSubmission(cleaned, client = null) {
  const values = [
    cleaned.course_group,
    cleaned.team_number,
    cleaned.leader_name,
    cleaned.leader_email,
    cleaned.leader_phone,
    JSON.stringify(cleaned.students),
    cleaned.drug_key,
    cleaned.drug_name,
  ];

  const result = await runQuery(
    client,
    `
      insert into public.group_submissions
        (course_group, team_number, leader_name, leader_email, leader_phone, students, drug_key, drug_name)
      values
        ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      returning
        id,
        course_group,
        team_number,
        leader_name,
        leader_email,
        leader_phone,
        students,
        drug_key,
        drug_name,
        created_at,
        updated_at
    `,
    values,
  );

  return result.rows[0] || null;
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

  const holderToken = toCleanString(requestBody.holderToken ?? requestBody.holder_token);
  if (!holderToken) {
    sendJson(res, 400, { error: 'Reservation token is required. Please re-open the group form and select the drug.' });
    return;
  }

  const client = await getPool().connect();
  let transactionStarted = false;

  try {
    await client.query('begin');
    transactionStarted = true;
    await purgeExpiredReservations(client);

    const selectedDrug = await getDrugByKey(cleaned.drug_key, client);
    if (!selectedDrug) {
      await client.query('rollback');
      sendJson(res, 400, { error: 'This drug does not exist.' });
      return;
    }

    if (!selectedDrug.is_active) {
      await client.query('rollback');
      sendJson(res, 400, { error: 'This drug is not available for selection.' });
      return;
    }

    const reservation = await getReservationByDrugKey(cleaned.drug_key, client);
    if (!reservation) {
      await client.query('rollback');
      sendJson(res, 409, {
        error: 'Drug reservation is missing or expired. Please return to the drug list and select again.',
      });
      return;
    }

    if (reservation.holder_token !== holderToken) {
      await client.query('rollback');
      sendJson(res, 409, { error: 'This drug is currently reserved by another group.' });
      return;
    }

    const takenBy = await getDrugTakenBySubmission(cleaned.drug_key, null, client);
    if (takenBy) {
      await client.query('rollback');
      sendJson(res, 409, { error: `This drug is already taken by Group ${takenBy.team_number}.` });
      return;
    }

    cleaned.drug_name = selectedDrug.name;

    const submission = await insertSubmission(cleaned, client);
    await runQuery(client, 'delete from public.drug_reservations where lower(drug_key) = $1 and holder_token = $2', [
      cleaned.drug_key,
      holderToken,
    ]);
    await client.query('commit');

    sendJson(res, 201, {
      message: 'Group submission saved successfully.',
      submission,
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('rollback');
      } catch {
        // Ignore rollback errors and return original failure.
      }
    }

    const mapped = mapSubmissionConstraintError(error);
    if (mapped) {
      sendJson(res, mapped.status, { error: mapped.message });
      return;
    }

    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to save submission.',
      details: getDbErrorMessage(error),
    });
  } finally {
    client.release();
  }
}

async function handleAdminOverview(res) {
  try {
    await purgeExpiredReservations();

    const [drugs, submissions, reservations] = await Promise.all([
      getDrugRows({ activeOnly: false }),
      getSubmissionRows(),
      getReservationRows(),
    ]);

    const takenMap = createTakenMap(submissions);
    const reservationMap = createReservationMap(reservations);

    sendJson(res, 200, {
      drugs: combineDrugsWithLocks(drugs, takenMap, reservationMap),
      submissions,
    });
  } catch (error) {
    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to load admin data.',
      details: getDbErrorMessage(error),
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
    const selectedDrug = await getDrugByKey(cleaned.drug_key);
    if (!selectedDrug) {
      sendJson(res, 400, { error: 'Drug does not exist.' });
      return;
    }

    const takenBy = await getDrugTakenBySubmission(cleaned.drug_key);
    if (takenBy) {
      sendJson(res, 409, { error: `Drug already used by Group ${takenBy.team_number}.` });
      return;
    }

    cleaned.drug_name = selectedDrug.name;

    const submission = await insertSubmission(cleaned);
    await dbQuery('delete from public.drug_reservations where lower(drug_key) = $1', [cleaned.drug_key]);
    sendJson(res, 201, {
      message: 'Submission created.',
      submission,
    });
  } catch (error) {
    const mapped = mapSubmissionConstraintError(error);
    if (mapped) {
      sendJson(res, mapped.status, { error: mapped.message });
      return;
    }

    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to create submission.',
      details: getDbErrorMessage(error),
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
      const selectedDrug = await getDrugByKey(cleaned.drug_key);
      if (!selectedDrug) {
        sendJson(res, 400, { error: 'Drug does not exist.' });
        return;
      }

      const takenBy = await getDrugTakenBySubmission(cleaned.drug_key, id);
      if (takenBy) {
        sendJson(res, 409, { error: `Drug already used by Group ${takenBy.team_number}.` });
        return;
      }

      cleaned.drug_name = selectedDrug.name;
    }

    const allowedColumns = {
      course_group: 'course_group',
      team_number: 'team_number',
      leader_name: 'leader_name',
      leader_email: 'leader_email',
      leader_phone: 'leader_phone',
      students: 'students',
      drug_key: 'drug_key',
      drug_name: 'drug_name',
    };

    const setClauses = [];
    const values = [];

    Object.entries(cleaned).forEach(([key, value]) => {
      const column = allowedColumns[key];
      if (!column) {
        return;
      }

      const parameterPosition = values.length + 1;
      if (key === 'students') {
        setClauses.push(`${column} = $${parameterPosition}::jsonb`);
        values.push(JSON.stringify(value));
      } else {
        setClauses.push(`${column} = $${parameterPosition}`);
        values.push(value);
      }
    });

    if (setClauses.length === 0) {
      sendJson(res, 400, { error: 'No valid fields to update.' });
      return;
    }

    values.push(id);
    const idParameterPosition = values.length;

    const result = await dbQuery(
      `
        update public.group_submissions
        set ${setClauses.join(', ')}
        where id = $${idParameterPosition}::uuid
        returning
          id,
          course_group,
          team_number,
          leader_name,
          leader_email,
          leader_phone,
          students,
          drug_key,
          drug_name,
          created_at,
          updated_at
      `,
      values,
    );

    if (result.rows.length === 0) {
      sendJson(res, 404, { error: 'Submission not found.' });
      return;
    }

    if (cleaned.drug_key) {
      await dbQuery('delete from public.drug_reservations where lower(drug_key) = $1', [cleaned.drug_key]);
    }

    sendJson(res, 200, {
      message: 'Submission updated.',
      submission: result.rows[0],
    });
  } catch (error) {
    const mapped = mapSubmissionConstraintError(error);
    if (mapped) {
      sendJson(res, mapped.status, { error: mapped.message });
      return;
    }

    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to update submission.',
      details: getDbErrorMessage(error),
    });
  }
}

async function handleAdminDeleteSubmission(res, id) {
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'Invalid submission ID.' });
    return;
  }

  try {
    const result = await dbQuery('delete from public.group_submissions where id = $1::uuid returning id', [id]);
    if (result.rows.length === 0) {
      sendJson(res, 404, { error: 'Submission not found.' });
      return;
    }

    sendJson(res, 200, { message: 'Submission deleted.' });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Failed to delete submission.',
      details: getDbErrorMessage(error),
    });
  }
}

async function handleAdminListDrugs(res) {
  try {
    await purgeExpiredReservations();

    const [submissions, drugs, reservations] = await Promise.all([
      getSubmissionRows(),
      getDrugRows({ activeOnly: false }),
      getReservationRows(),
    ]);

    const takenMap = createTakenMap(submissions);
    const reservationMap = createReservationMap(reservations);

    sendJson(res, 200, {
      drugs: combineDrugsWithLocks(drugs, takenMap, reservationMap),
    });
  } catch (error) {
    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to load drugs.',
      details: getDbErrorMessage(error),
    });
  }
}

async function handleAdminCreateDrug(req, res) {
  let body;

  try {
    body = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const { errors, cleaned } = normalizeAdminDrugPayload(body, { partial: false });
  if (errors.length > 0) {
    sendJson(res, 400, { error: errors.join(' ') });
    return;
  }

  try {
    const generatedKey = await getNextAvailableDrugKey(cleaned.key || cleaned.name);
    if (!generatedKey || !DRUG_KEY_REGEX.test(generatedKey)) {
      sendJson(res, 400, { error: 'Failed to generate a valid drug key from the name.' });
      return;
    }

    const result = await dbQuery(
      `
        insert into public.drugs (key, name, is_active, sort_order)
        values ($1, $2, $3, $4)
        returning
          lower(key) as key,
          name,
          is_active,
          sort_order,
          created_at,
          updated_at
      `,
      [generatedKey, cleaned.name, cleaned.is_active, cleaned.sort_order],
    );

    sendJson(res, 201, {
      message: 'Drug created.',
      drug: result.rows[0],
    });
  } catch (error) {
    const mapped = mapDrugConstraintError(error);
    if (mapped) {
      sendJson(res, mapped.status, { error: mapped.message });
      return;
    }

    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to create drug.',
      details: getDbErrorMessage(error),
    });
  }
}

async function handleAdminUpdateDrug(req, res, keyParam) {
  const key = normalizeDrugKey(keyParam);
  if (!key) {
    sendJson(res, 400, { error: 'Invalid drug key.' });
    return;
  }

  let body;

  try {
    body = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const { errors, cleaned } = normalizeAdminDrugPayload(body, { partial: true });
  if (errors.length > 0) {
    sendJson(res, 400, { error: errors.join(' ') });
    return;
  }

  const setClauses = [];
  const values = [];

  if (cleaned.name !== undefined) {
    values.push(cleaned.name);
    setClauses.push(`name = $${values.length}`);
  }

  if (cleaned.is_active !== undefined) {
    values.push(cleaned.is_active);
    setClauses.push(`is_active = $${values.length}`);
  }

  if (cleaned.sort_order !== undefined) {
    values.push(cleaned.sort_order);
    setClauses.push(`sort_order = $${values.length}`);
  }

  if (setClauses.length === 0) {
    sendJson(res, 400, { error: 'No valid fields to update.' });
    return;
  }

  values.push(key);
  const keyParameterPosition = values.length;

  try {
    const result = await dbQuery(
      `
        update public.drugs
        set ${setClauses.join(', ')}
        where lower(key) = $${keyParameterPosition}
        returning
          lower(key) as key,
          name,
          is_active,
          sort_order,
          created_at,
          updated_at
      `,
      values,
    );

    if (result.rows.length === 0) {
      sendJson(res, 404, { error: 'Drug not found.' });
      return;
    }

    const updatedDrug = result.rows[0];

    if (cleaned.name !== undefined) {
      await dbQuery('update public.group_submissions set drug_name = $1 where lower(drug_key) = $2', [
        updatedDrug.name,
        key,
      ]);
    }

    if (cleaned.is_active === false) {
      await dbQuery('delete from public.drug_reservations where lower(drug_key) = $1', [key]);
    }

    sendJson(res, 200, {
      message: 'Drug updated.',
      drug: updatedDrug,
    });
  } catch (error) {
    const mapped = mapDrugConstraintError(error);
    if (mapped) {
      sendJson(res, mapped.status, { error: mapped.message });
      return;
    }

    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to update drug.',
      details: getDbErrorMessage(error),
    });
  }
}

async function handleAdminDeleteDrug(res, keyParam) {
  const key = normalizeDrugKey(keyParam);
  if (!key) {
    sendJson(res, 400, { error: 'Invalid drug key.' });
    return;
  }

  try {
    const takenBy = await getDrugTakenBySubmission(key);
    if (takenBy) {
      sendJson(res, 409, { error: `Drug is already used by Group ${takenBy.team_number}. Remove that submission first.` });
      return;
    }

    await dbQuery('delete from public.drug_reservations where lower(drug_key) = $1', [key]);

    const result = await dbQuery(
      'delete from public.drugs where lower(key) = $1 returning lower(key) as key, name, is_active, sort_order',
      [key],
    );

    if (result.rows.length === 0) {
      sendJson(res, 404, { error: 'Drug not found.' });
      return;
    }

    sendJson(res, 200, {
      message: 'Drug deleted.',
      drug: result.rows[0],
    });
  } catch (error) {
    if (isSchemaMigrationError(error)) {
      sendMigrationError(res);
      return;
    }

    sendJson(res, 500, {
      error: 'Failed to delete drug.',
      details: getDbErrorMessage(error),
    });
  }
}

async function handleApi(req, res, pathname, requestUrl) {
  if (!hasDatabaseConfig()) {
    sendJson(res, 500, {
      error: 'Server is missing database environment variables.',
      required: ['DATABASE_URL'],
    });
    return;
  }

  if (pathname === '/api/public/drugs' && req.method === 'GET') {
    await handlePublicDrugs(res, requestUrl);
    return;
  }

  if (pathname === '/api/public/reservations' && req.method === 'POST') {
    await handlePublicUpsertReservation(req, res);
    return;
  }

  if (pathname === '/api/public/reservations' && req.method === 'DELETE') {
    await handlePublicReleaseReservation(req, res);
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

  if (pathname === '/api/admin/drugs' && req.method === 'GET') {
    await handleAdminListDrugs(res);
    return;
  }

  if (pathname === '/api/admin/drugs' && req.method === 'POST') {
    await handleAdminCreateDrug(req, res);
    return;
  }

  if (pathname.startsWith('/api/admin/drugs/')) {
    const key = pathname.split('/').pop();

    if (req.method === 'PATCH') {
      await handleAdminUpdateDrug(req, res, key);
      return;
    }

    if (req.method === 'DELETE') {
      await handleAdminDeleteDrug(res, key);
      return;
    }
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
      await handleApi(req, res, pathname, requestUrl);
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
