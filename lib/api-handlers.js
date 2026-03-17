import { initializeKVStores } from './supabase-enhanced.js';
import { createAdminToken, verifyAdminBearerToken as verifyAdminBearer, hasValidAdminSecret, verifyPasswordHash, resolveAdminLoginStatus } from './admin-auth.js';
import {
  parseBody,
  setCorsHeaders,
  getClientIP,
  checkRateLimit,
  validatePersonalId,
  validateGender,
  normalizeGender,
  validateClinicId,
  generateSessionId,
  generatePIN,
  formatError,
  formatSuccess,
  logRequest,
  handleError,
} from './helpers-enhanced.js';
import { optimizeRoute, createOptimizedRoute } from './routing.js';
import {
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
  generateAnnualReport,
  generateAnnualReport as generateYearlyReport,
} from './reports.js';

// Initialize Supabase-backed KV stores
const {
  KV_ADMIN, KV_PINS, KV_QUEUES, KV_EVENTS, KV_LOCKS, KV_CACHE, supabase,
} = initializeKVStores(process.env);

function verifyAdminBearerToken(authorizationHeader) {
  return verifyAdminBearer(authorizationHeader, process.env.ADMIN_AUTH_SECRET);
}

function getAuthorizationHeader(headers = {}) {
  return headers.authorization || headers.Authorization || '';
}

export default async function handler(req, res) {
  // Set CORS headers
  setCorsHeaders(res, req);

  // Handle OPTIONS for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Get client IP and check rate limit
  const clientIP = getClientIP(req);
  const rateLimit = checkRateLimit(clientIP, 100, 60000);

  if (!rateLimit.allowed) {
    return res.status(429).json(formatError('Too many requests', 'RATE_LIMIT_EXCEEDED', {
      resetAt: new Date(rateLimit.resetAt).toISOString(),
    }));
  }

  // Parse URL and method
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `https://${host}`);
  const { pathname } = url;
  const { method } = req;
  const query = Object.fromEntries(url.searchParams);

  // Log request
  logRequest(req, { pathname, method });

  // Parse body for write requests
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    try {
      if (req._mmcParsedBody && typeof req._mmcParsedBody === 'object') {
        body = req._mmcParsedBody;
      } else if (req.body && typeof req.body === 'object') {
        body = req.body;
      } else {
        body = await parseBody(req);
      }
    } catch (error) {
      return res.status(400).json(formatError('Invalid request body', 'INVALID_BODY'));
    }
  }

  try {
    // ==================== STATUS & HEALTH ====================

    if (pathname === '/api/v1/status' && method === 'GET') {
      return res.status(200).json(formatSuccess({
        status: 'healthy',
        mode: 'online',
        backend: 'up',
        platform: 'vercel',
        timestamp: new Date().toISOString(),
        kv: {
          admin: true,
          pins: true,
          queues: true,
          events: true,
          locks: true,
          cache: true,
        },
      }));
    }

    // ==================== PATIENT MANAGEMENT ====================

    if ((pathname === '/api/v1/patient/login' || pathname === '/api/v1/patients/login') && method === 'POST') {
      const { personalId, gender } = body;

      // Validate inputs
      if (!personalId || !gender) {
        return res.status(400).json(formatError('Missing required fields: personalId, gender', 'MISSING_FIELDS'));
      }

      if (!validatePersonalId(personalId)) {
        return res.status(400).json(formatError('Invalid personal ID format', 'INVALID_PERSONAL_ID'));
      }

      if (!validateGender(gender)) {
        return res.status(400).json(formatError('Invalid gender', 'INVALID_GENDER'));
      }

      // Generate session
      const sessionId = generateSessionId();
      const normalizedGender = normalizeGender(gender);

      const sessionData = {
        personalId,
        gender: normalizedGender,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        ip: clientIP,
      };

      await KV_ADMIN.put(`session:${sessionId}`, sessionData, { expirationTtl: 86400 });

      return res.status(200).json(formatSuccess({
        sessionId,
        expiresAt: sessionData.expiresAt,
      }, 'Login successful'));
    }

    if (pathname.startsWith('/api/v1/patient/') && method === 'GET') {
      const sessionId = pathname.split('/').pop();

      if (!sessionId) {
        return res.status(400).json(formatError('Missing session ID', 'MISSING_SESSION_ID'));
      }

      const sessionData = await KV_ADMIN.get(`session:${sessionId}`);

      if (!sessionData) {
        return res.status(404).json(formatError('Session not found', 'SESSION_NOT_FOUND'));
      }

      // Check expiration
      if (new Date(sessionData.expiresAt) < new Date()) {
        return res.status(401).json(formatError('Session expired', 'SESSION_EXPIRED'));
      }

      return res.status(200).json(formatSuccess({
        personalId: sessionData.personalId,
        gender: sessionData.gender,
        createdAt: sessionData.createdAt,
        expiresAt: sessionData.expiresAt,
      }));
    }

    // ==================== QUEUE MANAGEMENT ====================

    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const { sessionId, clinicId } = body;

      if (!sessionId || !clinicId) {
        return res.status(400).json(formatError('Missing required fields: sessionId, clinicId', 'MISSING_FIELDS'));
      }

      if (!validateClinicId(clinicId)) {
        return res.status(400).json(formatError('Invalid clinic ID', 'INVALID_CLINIC_ID'));
      }

      // Verify session
      const sessionData = await KV_ADMIN.get(`session:${sessionId}`);
      if (!sessionData) {
        return res.status(401).json(formatError('Invalid session', 'INVALID_SESSION'));
      }

      // Get queue
      const queueKey = `queue:${clinicId}`;
      const queue = await KV_QUEUES.get(queueKey) || { patients: [], current: 0, lastUpdated: null };

      // Check if already in queue
      const existingIndex = queue.patients.findIndex((p) => p.sessionId === sessionId);
      if (existingIndex !== -1) {
        return res.status(200).json(formatSuccess({
          position: existingIndex + 1,
          queueLength: queue.patients.length,
          estimatedWait: (existingIndex + 1) * 5,
          alreadyInQueue: true,
        }));
      }

      // Add patient
      const position = queue.patients.length + 1;
      queue.patients.push({
        sessionId,
        personalId: sessionData.personalId,
        position,
        enteredAt: new Date().toISOString(),
      });

      queue.lastUpdated = new Date().toISOString();

      await KV_QUEUES.put(queueKey, queue);

      // Emit event
      await KV_EVENTS.put(`event:${clinicId}:${Date.now()}`, {
        type: 'PATIENT_ENTERED',
        clinicId,
        sessionId,
        position,
        timestamp: new Date().toISOString(),
      }, { expirationTtl: 3600 });

      return res.status(200).json(formatSuccess({
        position,
        queueLength: queue.patients.length,
        estimatedWait: position * 5,
      }, 'Successfully entered queue'));
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const clinicId = query.clinicId || query.clinic;

      if (!clinicId) {
        return res.status(400).json(formatError('Missing required parameter: clinicId|clinic', 'MISSING_CLINIC_ID'));
      }

      if (!validateClinicId(clinicId)) {
        return res.status(400).json(formatError('Invalid clinic ID', 'INVALID_CLINIC_ID'));
      }

      const queueKey = `queue:${clinicId}`;
      const queue = await KV_QUEUES.get(queueKey) || { patients: [], current: 0, lastUpdated: null };

      return res.status(200).json(formatSuccess({
        clinicId,
        queueLength: queue.patients.length,
        currentNumber: queue.current,
        patients: queue.patients.map((p) => ({
          position: p.position,
          enteredAt: p.enteredAt,
        })),
        lastUpdated: queue.lastUpdated,
      }));
    }

    if (pathname === '/api/v1/queue/call' && method === 'POST') {
      const { clinicId } = body;

      if (!clinicId) {
        return res.status(400).json(formatError('Missing required field: clinicId', 'MISSING_CLINIC_ID'));
      }

      if (!validateClinicId(clinicId)) {
        return res.status(400).json(formatError('Invalid clinic ID', 'INVALID_CLINIC_ID'));
      }

      const queueKey = `queue:${clinicId}`;
      const queue = await KV_QUEUES.get(queueKey) || { patients: [], current: 0, lastUpdated: null };

      if (queue.patients.length === 0) {
        return res.status(200).json(formatSuccess({
          clinicId,
          currentNumber: queue.current,
          message: 'Queue is empty',
        }));
      }

      // Call next patient
      const nextPatient = queue.patients.shift();
      queue.current = nextPatient.position;
      queue.lastUpdated = new Date().toISOString();

      await KV_QUEUES.put(queueKey, queue);

      // Emit event
      await KV_EVENTS.put(`event:${clinicId}:${Date.now()}`, {
        type: 'PATIENT_CALLED',
        clinicId,
        sessionId: nextPatient.sessionId,
        position: nextPatient.position,
        timestamp: new Date().toISOString(),
      }, { expirationTtl: 3600 });

      return res.status(200).json(formatSuccess({
        clinicId,
        currentNumber: queue.current,
        patient: nextPatient,
      }, 'Patient called successfully'));
    }

    // ==================== PIN MANAGEMENT ====================

    if (pathname === '/api/v1/pin/verify' && method === 'POST') {
      const { pin, clinicId } = body;

      if (!pin || !clinicId) {
        return res.status(400).json(formatError('Missing required fields: pin, clinicId', 'MISSING_FIELDS'));
      }

      const storedPinData = await KV_PINS.get(`pin:${clinicId}`);

      if (!storedPinData) {
        return res.status(404).json(formatError('PIN not found for this clinic', 'PIN_NOT_FOUND'));
      }

      if (storedPinData.pin !== pin) {
        return res.status(401).json(formatError('Invalid PIN', 'INVALID_PIN'));
      }

      if (new Date(storedPinData.expiresAt) < new Date()) {
        return res.status(401).json(formatError('PIN expired', 'PIN_EXPIRED'));
      }

      return res.status(200).json(formatSuccess({
        verified: true,
        clinicId,
      }, 'PIN verified successfully'));
    }


    if (pathname === '/api/v1/queue/done' && method === 'POST') {
      const { clinicId, patientId, pin } = body;

      if (!clinicId || !patientId || !pin) {
        return res.status(400).json(formatError('Missing required fields: clinicId, patientId, pin', 'MISSING_FIELDS'));
      }

      const nowIso = new Date().toISOString();
      let pinRecord = null;
      let pinMode = null;

      const { data: canonicalPin, error: canonicalPinError } = await supabase
        .from('pins')
        .select('id, clinic_id, pin, valid_until, used_at')
        .eq('clinic_id', clinicId)
        .eq('pin', pin)
        .maybeSingle();

      if (
        !canonicalPinError
        && canonicalPin
        && !canonicalPin.used_at
        && (!canonicalPin.valid_until || new Date(canonicalPin.valid_until) >= new Date())
      ) {
        pinRecord = canonicalPin;
        pinMode = 'canonical';
      }

      if (!pinRecord) {
        const { data: legacyPin, error: legacyPinError } = await supabase
          .from('pins')
          .select('id, clinic_code, pin, expires_at, used_count, max_uses, is_active')
          .eq('clinic_code', clinicId)
          .eq('pin', pin)
          .maybeSingle();

        const legacyValid =
          !legacyPinError
          && legacyPin
          && legacyPin.is_active !== false
          && Number(legacyPin.used_count || 0) < Number(legacyPin.max_uses || 1)
          && (!legacyPin.expires_at || new Date(legacyPin.expires_at) >= new Date());

        if (legacyValid) {
          pinRecord = legacyPin;
          pinMode = 'legacy';
        }
      }

      if (!pinRecord) {
        return res.status(401).json(formatError('Invalid PIN', 'INVALID_PIN'));
      }

      const { data: completedRows, error: queueError } = await supabase
        .from('queues')
        .update({
          status: 'completed',
          completed_at: nowIso,
          completed_by_pin: pin,
        })
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .in('status', ['waiting', 'serving', 'called'])
        .select('id, clinic_id, patient_id, status, completed_at');

      if (queueError) {
        return res.status(500).json(formatError('Failed to complete queue item', 'QUEUE_COMPLETE_FAILED'));
      }

      if (!completedRows || completedRows.length === 0) {
        return res.status(404).json(formatError('Active queue entry not found', 'QUEUE_ENTRY_NOT_FOUND'));
      }

      if (pinMode === 'canonical') {
        await supabase
          .from('pins')
          .update({ used_at: nowIso })
          .eq('id', pinRecord.id);
      } else {
        await supabase
          .from('pins')
          .update({
            used_count: Number(pinRecord.used_count || 0) + 1,
            last_used_at: nowIso,
          })
          .eq('id', pinRecord.id);
      }

      return res.status(200).json(formatSuccess({
        completed: true,
        clinicId,
        patientId,
        rows: completedRows,
      }, 'Queue item completed successfully'));
    }

    // ==================== ADMIN OPERATIONS ====================

    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const { username, password } = body;

      if (!username || !password) {
        return res.status(400).json(formatError('Missing username or password', 'MISSING_CREDENTIALS'));
      }

      const { data: admin, error: adminError } = await supabase
        .from('admins')
        .select('*')
        .eq('username', username)
        .maybeSingle();

      if (adminError) {
        return res.status(500).json(formatError('Database error during authentication', 'DB_ERROR'));
      }

      const loginStatus = resolveAdminLoginStatus({
        username,
        password,
        admin,
        allowLegacyBackdoor: process.env.ENABLE_LEGACY_ADMIN_BACKDOOR === 'true' || process.env.ALLOW_LEGACY_ADMIN_BACKDOOR === 'true',
      });

      if (loginStatus !== 200) {
        return res.status(loginStatus).json(formatError('Invalid username or password', 'INVALID_CREDENTIALS'));
      }

      if (!hasValidAdminSecret(process.env.ADMIN_AUTH_SECRET)) {
        return res.status(503).json(formatError('Server admin token configuration is missing or weak', 'ADMIN_SECRET_MISSING'));
      }

      const nowMs = Date.now();
      const token = createAdminToken({
        id: admin?.id || username,
        username,
        role: admin?.role || 'SUPER_ADMIN',
      }, process.env.ADMIN_AUTH_SECRET, nowMs);

      return res.status(200).json(formatSuccess({
        success: true,
        session: {
          username,
          role: admin?.role || 'SUPER_ADMIN',
          token,
          expiresAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString()
        }
      }, 'Login successful'));
    }

    if (pathname.startsWith('/api/v1/admin/')) {
      const authHeader = getAuthorizationHeader(req.headers);
      if (!verifyAdminBearerToken(authHeader)) {
        return res.status(401).json(formatError('Unauthorized admin access', 'UNAUTHORIZED'));
      }

      // Admin specific routes
      if (pathname === '/api/v1/admin/reports/daily' && method === 'GET') {
        const report = await generateDailyReport(query.date || new Date().toISOString().split('T')[0]);
        return res.status(200).json(formatSuccess(report));
      }

      // Add more admin routes as needed...
    }

    // Default 404
    return res.status(404).json(formatError('Route not found', 'NOT_FOUND'));

  } catch (error) {
    return handleError(error, res);
  }
}
// Trigger redeploy
