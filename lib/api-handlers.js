/**
 * API Handlers - Main API Request Handlers
 * 
 * @module lib/api-handlers
 * @description Comprehensive API handlers with validation, error handling,
 * and security features for the Military Medical Committee System.
 * @version 2.1.0 - PIN system removed
 */

import { initializeKVStores } from './supabase-enhanced.js';
import { createAdminToken, verifyAdminBearerToken as verifyAdminBearer, verifyPasswordHash } from './admin-auth.js';
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

/**
 * Verifies admin bearer token from authorization header
 * @param {string} authorizationHeader - Authorization header value
 * @returns {boolean} Whether token is valid
 */
function verifyAdminBearerToken(authorizationHeader) {
  return verifyAdminBearer(authorizationHeader, process.env.ADMIN_AUTH_SECRET);
}

/**
 * Gets authorization header from request headers
 * @param {Object} headers - Request headers
 * @returns {string} Authorization header value
 */
function getAuthorizationHeader(headers = {}) {
  return headers.authorization || headers.Authorization || '';
}

/**
 * Validates request body against schema
 * @param {Object} body - Request body
 * @param {Array} requiredFields - Required field names
 * @returns {Object} Validation result
 */
function validateBody(body, requiredFields = []) {
  const errors = [];
  
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitizes string input
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/[<>\"']/g, '');
}

/**
 * Main API Handler
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Promise<void>}
 */
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
      console.error('[API_HANDLERS] Body parse error:', error);
      return res.status(400).json(formatError('Invalid request body', 'INVALID_BODY'));
    }
  }

  try {
    // ==================== STATUS & HEALTH ====================

    if ((pathname === '/api/v1/status' || pathname === '/api/v1/health') && method === 'GET') {
      // Check database connectivity
      let dbStatus = 'healthy';
      try {
        const { error } = await supabase.from('clinics').select('id', { count: 'exact', head: true });
        if (error) dbStatus = 'degraded';
      } catch (e) {
        dbStatus = 'unhealthy';
      }

      return res.status(200).json(formatSuccess({
        status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
        mode: 'online',
        backend: 'up',
        platform: 'vercel',
        timestamp: new Date().toISOString(),
        db: dbStatus,
        kv: {
          admin: true,
          pins: false, // PIN system disabled
          queues: true,
          events: true,
          locks: true,
          cache: true,
        },
      }));
    }

    // ==================== CLINICS ====================

    if (pathname === '/api/v1/clinics' && method === 'GET') {
      try {
        const { data, error } = await supabase
          .from('clinics')
          .select('*')
          .order('name_ar', { ascending: true });

        if (error) throw error;

        return res.status(200).json(formatSuccess(data || []));
      } catch (error) {
        console.error('[API_HANDLERS] Get clinics error:', error);
        return res.status(500).json(formatError('Failed to fetch clinics', 'DB_ERROR'));
      }
    }

    // ==================== PATIENT MANAGEMENT ====================

    if ((pathname === '/api/v1/patient/login' || pathname === '/api/v1/patients/login') && method === 'POST') {
      const validation = validateBody(body, ['personalId', 'gender']);
      if (!validation.valid) {
        return res.status(400).json(formatError(validation.errors.join(', '), 'MISSING_FIELDS'));
      }

      const { personalId, gender } = body;

      if (!validatePersonalId(personalId)) {
        return res.status(400).json(formatError('Invalid personal ID format', 'INVALID_PERSONAL_ID'));
      }

      if (!validateGender(gender)) {
        return res.status(400).json(formatError('Invalid gender', 'INVALID_GENDER'));
      }

      const sessionId = generateSessionId();
      const normalizedGender = normalizeGender(gender);

      const sessionData = {
        personalId: sanitizeString(personalId),
        gender: normalizedGender,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        ip: clientIP,
      };

      try {
        await KV_ADMIN.put(`session:${sessionId}`, sessionData, { expirationTtl: 86400 });

        return res.status(200).json(formatSuccess({
          sessionId,
          expiresAt: sessionData.expiresAt,
          personalId: sessionData.personalId,
          gender: sessionData.gender,
        }, 'Login successful'));
      } catch (error) {
        console.error('[API_HANDLERS] Session creation error:', error);
        return res.status(500).json(formatError('Failed to create session', 'SESSION_ERROR'));
      }
    }

    // ==================== QUEUE MANAGEMENT ====================

    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const validation = validateBody(body, ['sessionId', 'clinicId']);
      if (!validation.valid) {
        return res.status(400).json(formatError(validation.errors.join(', '), 'MISSING_FIELDS'));
      }

      const { sessionId, clinicId, patientName, examType } = body;

      if (!validateClinicId(clinicId)) {
        return res.status(400).json(formatError('Invalid clinic ID', 'INVALID_CLINIC_ID'));
      }

      // Verify session
      let sessionData;
      try {
        sessionData = await KV_ADMIN.get(`session:${sessionId}`);
        if (!sessionData) {
          return res.status(401).json(formatError('Invalid session', 'INVALID_SESSION'));
        }
      } catch (error) {
        console.error('[API_HANDLERS] Session verification error:', error);
        return res.status(500).json(formatError('Failed to verify session', 'SESSION_ERROR'));
      }

      // Add to queue logic (simplified for this update)
      try {
        const { data, error } = await supabase.rpc('add_to_queue_atomic', {
          p_patient_id: sessionData.personalId,
          p_clinic_id: clinicId,
          p_exam_type: examType || 'GENERAL'
        });

        if (error) throw error;

        return res.status(200).json(formatSuccess({
          position: data.display_number,
          display_number: data.display_number,
          queueLength: data.queue_length,
        }, 'Successfully entered queue'));
      } catch (error) {
        console.error('[API_HANDLERS] Queue update error:', error);
        return res.status(500).json(formatError('Failed to enter queue', 'QUEUE_ERROR'));
      }
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const clinicId = query.clinicId || query.clinic;
      if (!clinicId) return res.status(400).json(formatError('Missing clinicId', 'MISSING_CLINIC_ID'));

      try {
        const { count: waitingCount } = await supabase
          .from('unified_queue')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinicId)
          .eq('status', 'waiting');

        const { data: currentPatient } = await supabase
          .from('unified_queue')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('status', 'called')
          .order('called_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        return res.status(200).json(formatSuccess({
          clinicId,
          waitingCount: waitingCount || 0,
          currentNumber: currentPatient?.display_number || 0,
          currentPatient: currentPatient || null,
        }));
      } catch (error) {
        return res.status(500).json(formatError('Failed to fetch status', 'DB_ERROR'));
      }
    }

    // ==================== PIN SYSTEM (DEPRECATED/NO-OP) ====================
    
    if (pathname.startsWith('/api/v1/pin/')) {
      // Return safe response for all PIN endpoints to avoid frontend crashes
      return res.status(200).json(formatSuccess({
        success: true,
        message: "PIN system permanently removed. All clinics are now open by default.",
        verified: true,
        valid: true,
        has_active_pin: true,
        pin: "OPEN",
        doctorControl: true
      }));
    }

    // ==================== QUEUE DONE (NO PIN REQUIRED) ====================

    if (pathname === '/api/v1/queue/done' && method === 'POST') {
      const validation = validateBody(body, ['clinicId', 'patientId']);
      if (!validation.valid) {
        return res.status(400).json(formatError(validation.errors.join(', '), 'MISSING_FIELDS'));
      }

      const { clinicId, patientId } = body;
      const nowIso = new Date().toISOString();

      try {
        const { data: completedRows, error: queueError } = await supabase
          .from('unified_queue')
          .update({
            status: 'done',
            completed_at: nowIso
          })
          .eq('clinic_id', clinicId)
          .eq('patient_id', patientId)
          .in('status', ['waiting', 'called', 'in_progress'])
          .select();

        if (queueError) throw queueError;

        return res.status(200).json(formatSuccess({
          completed: true,
          clinicId,
          patientId,
          rows: completedRows,
        }, 'Queue item completed successfully'));
      } catch (error) {
        console.error('[API_HANDLERS] Queue done error:', error);
        return res.status(500).json(formatError('Failed to complete queue item', 'QUEUE_COMPLETE_FAILED'));
      }
    }

    // ==================== ADMIN LOGIN ====================

    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      // Proxy to Supabase edge function (supports bcrypt password_hash)
      try {
        const ef = await fetch('https://rujwuruuosffcxazymit.supabase.co/functions/v1/admin-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await ef.json();
        return res.status(ef.status).json(data);
      } catch (err) {
        return res.status(500).json(formatError('Login service error', 'SERVICE_ERROR'));
      }
    }

    if ((pathname === '/api/v1/doctor/login') && method === 'POST') {
      // Same proxy for doctor login
      try {
        const ef = await fetch('https://rujwuruuosffcxazymit.supabase.co/functions/v1/admin-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await ef.json();
        return res.status(ef.status).json(data);
      } catch (err) {
        return res.status(500).json(formatError('Login service error', 'SERVICE_ERROR'));
      }
    }

    // Default 404
    return res.status(404).json(formatError(`Endpoint ${pathname} not found`, 'NOT_FOUND'));

  } catch (error) {
    console.error('[API_HANDLERS] Global error:', error);
    return handleError(res, error);
  }
}
