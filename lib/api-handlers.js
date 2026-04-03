/**
 * @fileoverview API Handlers - Doctor-Controlled Queue System (No PIN)
 * @description Main API handler for the Medical Committee Queue Management System.
 *              This version completely removes the PIN system and implements
 *              a doctor-controlled, sequential, dynamic queue flow.
 * 
 * @module lib/api-handlers
 * @version 4.0.0
 * @author Senior Full-Stack Engineer
 * @since 2025-04-01
 * 
 * @requires @supabase/supabase-js
 * 
 * @example
 * // Usage in API route:
 * import handler from './lib/api-handlers.js';
 * export default handler;
 * 
 * @security
 * - All admin routes require valid JWT bearer token
 * - Rate limiting: 100 requests per minute per IP
 * - CORS enabled for mmc-mms.com and www.mmc-mms.com
 * 
 * @performance
 * - Optimistic locking for concurrent queue operations
 * - Atomic number generation via PostgreSQL RPC
 * - Connection pooling via Supabase client
 */

import { initializeKVStores } from './supabase-enhanced.js';
import { 
  createAdminToken, 
  verifyAdminBearerToken as verifyAdminBearer, 
  hasValidAdminSecret, 
  verifyPasswordHash, 
  resolveAdminLoginStatus 
} from './admin-auth.js';
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
} from './reports.js';

// Initialize Supabase-backed KV stores
const { KV_ADMIN, KV_QUEUES, KV_EVENTS, KV_LOCKS, KV_CACHE, supabase } = initializeKVStores(process.env);

/**
 * Verify admin bearer token from authorization header
 * @param {string} authorizationHeader - The Authorization header value
 * @returns {boolean} True if token is valid
 */
function verifyAdminBearerToken(authorizationHeader) {
  return verifyAdminBearer(authorizationHeader, process.env.ADMIN_AUTH_SECRET);
}

/**
 * Get authorization header from request headers
 * @param {Object} headers - Request headers
 * @returns {string} Authorization header value
 */
function getAuthorizationHeader(headers = {}) {
  return headers.authorization || headers.Authorization || '';
}

/**
 * Global guard to block any PIN-related requests
 * @param {string} pathname - Request pathname
 * @param {Object} res - Response object
 * @returns {boolean} True if request should be blocked
 */
function blockPinRequests(pathname, res) {
  if (pathname.includes('pin')) {
    res.status(410).json(formatError(
      'PIN system has been removed. Use the new doctor-controlled queue system.',
      'PIN_REMOVED',
      { migrationGuide: '/docs/migration-no-pin' }
    ));
    return true;
  }
  return false;
}

/**
 * Log queue action to audit trail
 * 
 * @function logQueueAction
 * @param {Object} supabase - Supabase client instance
 * @param {Object} params - Log parameters
 * @param {string} params.queueId - Queue entry UUID
 * @param {string} params.patientId - Patient identifier
 * @param {string} params.action - Action performed (CREATED, CALLED, STARTED, etc.)
 * @param {string} [params.doctorId] - Doctor UUID who performed the action
 * @param {string} [params.clinicId] - Clinic UUID where action occurred
 * @param {number} [params.fromStep] - Previous step in patient journey
 * @param {number} [params.toStep] - New step in patient journey
 * @param {Object} [params.details={}] - Additional context data
 * @returns {Promise<void>}
 * 
 * @example
 * await logQueueAction(supabase, {
 *   queueId: 'uuid',
 *   patientId: 'patient-123',
 *   action: 'CALLED',
 *   doctorId: 'doctor-uuid',
 *   clinicId: 'clinic-uuid'
 * });
 * 
 * @security
 * - Errors are logged but not thrown to prevent disrupting main flow
 * - All actions are timestamped server-side
 */
async function logQueueAction(supabase, { queueId, patientId, action, doctorId, clinicId, fromStep, toStep, details = {} }) {
  try {
    await supabase.from('queue_logs').insert({
      queue_id: queueId,
      patient_id: patientId,
      action,
      doctor_id: doctorId,
      clinic_id: clinicId,
      from_step: fromStep,
      to_step: toStep,
      details,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Failed to log queue action:', err);
  }
}

/**
 * Get next queue number for a clinic atomically
 * 
 * @function getNextQueueNumber
 * @param {Object} supabase - Supabase client instance
 * @param {string} clinicId - Clinic UUID (must be valid UUID format)
 * @returns {Promise<number>} Next sequential queue number for the clinic
 * @throws {Error} If RPC call fails - no fallback to prevent duplicate numbers
 * 
 * @example
 * const nextNum = await getNextQueueNumber(supabase, '550e8400-e29b-41d4-a716-446655440000');
 * console.log(nextNum); // 42
 * 
 * @security
 * - Uses PostgreSQL RPC for atomic increment
 * - No fallback to prevent race conditions under high concurrency
 * 
 * @performance
 * - O(1) operation via database function
 * - No table locks held during operation
 */
async function getNextQueueNumber(supabase, clinicId) {
  const { data, error } = await supabase.rpc('get_next_queue_number', {
    p_clinic_id: clinicId
  });
  
  if (error) {
    console.error('Failed to get next queue number:', error);
    // Fallback removed: unsafe for concurrent access
    // This prevents duplicate queue numbers under high concurrency
    throw new Error(`Failed to get next queue number: ${error.message}. Please retry.`);
  }
  
  return data || 1;
}

/**
 * Find optimal clinic path based on exam type, gender, and current load
 * 
 * @function findOptimalPath
 * @param {Object} supabase - Supabase client instance
 * @param {string} examType - Type of examination (e.g., 'comprehensive', 'general')
 * @param {string} gender - Patient gender ('male', 'female', or 'both')
 * @returns {Promise<string[]>} Array of clinic IDs sorted by load (least loaded first)
 * @throws {Error} If no available clinics found or all clinics at capacity
 * 
 * @example
 * const path = await findOptimalPath(supabase, 'comprehensive', 'male');
 * console.log(path); // ['clinic-uuid-1', 'clinic-uuid-2']
 * 
 * @algorithm
 * 1. Query clinics matching exam type and gender restrictions
 * 2. Filter clinics with available capacity (current_load < capacity)
 * 3. Sort by current_load ascending (least loaded first)
 * 4. Return array of clinic IDs
 * 
 * @performance
 * - Single database query with filters
 * - O(n log n) sorting where n = number of clinics
 */
async function findOptimalPath(supabase, examType, gender) {
  // Get available clinics for exam type and gender
  const { data: clinics, error } = await supabase
    .from('clinics')
    .select('id, capacity, current_load, exam_type, gender_restriction')
    .or(`exam_type.eq.${examType},exam_type.is.null`)
    .or(`gender_restriction.eq.${gender},gender_restriction.eq.both,gender_restriction.is.null`)
    .order('current_load', { ascending: true });

  if (error || !clinics || clinics.length === 0) {
    throw new Error('No available clinics found for this exam type');
  }

  // Filter clinics with available capacity
  const availableClinics = clinics.filter(c => c.current_load < c.capacity);
  
  if (availableClinics.length === 0) {
    throw new Error('All clinics are at full capacity');
  }

  // Return sorted clinic IDs (least loaded first)
  return availableClinics.map(c => c.id);
}

/**
 * Main API handler for all /api/v1/* routes
 * 
 * @function handler
 * @param {Object} req - HTTP request object
 * @param {Object} req.headers - Request headers
 * @param {string} req.method - HTTP method (GET, POST, etc.)
 * @param {string} req.url - Request URL
 * @param {Object} req.body - Parsed request body
 * @param {Object} res - HTTP response object
 * @returns {Promise<void>}
 * 
 * @routes
 * - GET /api/v1/status - System health check
 * - POST /api/v1/patient/login - Patient authentication
 * - POST /api/v1/queue/create - Create new queue entry
 * - POST /api/v1/queue/call - Call next patient
 * - POST /api/v1/queue/start - Start examination
 * - POST /api/v1/queue/advance - Advance to next clinic
 * - GET /api/v1/queue/status - Get queue status
 * - GET /api/v1/queue/position - Get patient position
 * - POST /api/v1/admin/login - Admin authentication
 * - GET /api/v1/admin/* - Admin routes (require auth)
 * 
 * @security
 * - Rate limiting: 100 req/min per IP
 * - Admin routes require valid JWT
 * - CORS enabled for approved origins
 * 
 * @example
 * // POST /api/v1/queue/create
 * const response = await handler({
 *   method: 'POST',
 *   url: '/api/v1/queue/create',
 *   body: { sessionId: '...', examType: 'comprehensive', gender: 'male' }
 * }, res);
 */
export default async function handler(req, res) {
  // Set CORS headers
  setCorsHeaders(res, req);

  // Handle OPTIONS for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Block any PIN-related requests
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `https://${host}`);
  if (blockPinRequests(url.pathname, res)) {
    return;
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
        version: '4.0.0-no-pin',
        features: {
          pinSystem: false,
          doctorControl: true,
          dynamicRouting: true,
          optimisticLocking: true,
          idempotency: true
        },
        timestamp: new Date().toISOString(),
        kv: {
          admin: true,
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

    // ==================== QUEUE CREATION (ATOMIC) ====================

    if (pathname === '/api/v1/queue/create' && method === 'POST') {
      const { sessionId, examType, gender, idempotencyKey } = body;

      // Validate required fields
      if (!sessionId || !examType || !gender) {
        return res.status(400).json(formatError(
          'Missing required fields: sessionId, examType, gender', 
          'MISSING_FIELDS'
        ));
      }

      // Verify session
      const sessionData = await KV_ADMIN.get(`session:${sessionId}`);
      if (!sessionData) {
        return res.status(401).json(formatError('Invalid session', 'INVALID_SESSION'));
      }

      // Check idempotency
      if (idempotencyKey) {
        const { data: existingQueue } = await supabase
          .from('queue')
          .select('id, display_number, status, path')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();
        
        if (existingQueue) {
          return res.status(200).json(formatSuccess({
            queueId: existingQueue.id,
            number: existingQueue.display_number,
            status: existingQueue.status,
            path: existingQueue.path,
          }, 'Queue already exists (idempotent)'));
        }
      }

      try {
        // Find optimal clinic path
        const path = await findOptimalPath(supabase, examType, gender);
        
        if (path.length === 0) {
          return res.status(503).json(formatError('No available clinics', 'NO_CLINICS_AVAILABLE'));
        }

        // Get first clinic for initial queue number
        const firstClinicId = path[0];
        
        // Get next queue number atomically
        const nextNumber = await getNextQueueNumber(supabase, firstClinicId);

        // Create queue entry
        const { data: queueEntry, error: insertError } = await supabase
          .from('queue')
          .insert({
            patient_id: sessionData.personalId,
            current_clinic_id: firstClinicId,
            exam_type: examType,
            status: 'WAITING',
            current_step: 0,
            path: path,
            display_number: nextNumber,
            idempotency_key: idempotencyKey || null,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        // Increment clinic load
        await supabase.rpc('increment_clinic_load', { p_clinic_id: firstClinicId });

        // Log creation
        await logQueueAction(supabase, {
          queueId: queueEntry.id,
          patientId: sessionData.personalId,
          action: 'CREATED',
          clinicId: firstClinicId,
          toStep: 0,
          details: { examType, path }
        });

        return res.status(201).json(formatSuccess({
          queueId: queueEntry.id,
          number: queueEntry.display_number,
          status: queueEntry.status,
          path: queueEntry.path,
          currentClinic: firstClinicId,
        }, 'Queue created successfully'));

      } catch (error) {
        console.error('Queue creation error:', error);
        return res.status(500).json(formatError(
          'Failed to create queue: ' + error.message,
          'QUEUE_CREATE_FAILED'
        ));
      }
    }

    // ==================== CALL ENGINE (WAITING -> CALLED) ====================

    if (pathname === '/api/v1/queue/call' && method === 'POST') {
      const { clinicId, doctorId } = body;

      if (!clinicId) {
        return res.status(400).json(formatError('Missing required field: clinicId', 'MISSING_CLINIC_ID'));
      }

      if (!validateClinicId(clinicId)) {
        return res.status(400).json(formatError('Invalid clinic ID', 'INVALID_CLINIC_ID'));
      }

      // Mark any timed-out called patients as missed
      await supabase.rpc('mark_missed_patients');

      // Get next waiting patient
      const { data: nextPatient, error: fetchError } = await supabase
        .from('queue')
        .select('*')
        .eq('current_clinic_id', clinicId)
        .eq('status', 'WAITING')
        .order('display_number', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (fetchError || !nextPatient) {
        return res.status(200).json(formatSuccess({
          clinicId,
          called: false,
          message: 'No waiting patients',
        }));
      }

      // Update patient status to CALLED
      const { data: updatedQueue, error: updateError } = await supabase
        .from('queue')
        .update({
          status: 'CALLED',
          called_at: new Date().toISOString(),
          doctor_id: doctorId || null,
          version: nextPatient.version + 1,
        })
        .eq('id', nextPatient.id)
        .eq('version', nextPatient.version) // Optimistic locking
        .select()
        .single();

      if (updateError) {
        return res.status(409).json(formatError(
          'Patient was modified by another process',
          'CONCURRENT_MODIFICATION'
        ));
      }

      // Log the call action
      await logQueueAction(supabase, {
        queueId: updatedQueue.id,
        patientId: updatedQueue.patient_id,
        action: 'CALLED',
        doctorId: doctorId,
        clinicId: clinicId,
        fromStep: updatedQueue.current_step,
        toStep: updatedQueue.current_step,
      });

      return res.status(200).json(formatSuccess({
        clinicId,
        called: true,
        patient: {
          id: updatedQueue.id,
          number: updatedQueue.display_number,
          calledAt: updatedQueue.called_at,
        },
      }, 'Patient called successfully'));
    }

    // ==================== START (CALLED -> IN_PROGRESS) ====================

    if (pathname === '/api/v1/queue/start' && method === 'POST') {
      const { queueId, doctorId } = body;

      if (!queueId) {
        return res.status(400).json(formatError('Missing required field: queueId', 'MISSING_QUEUE_ID'));
      }

      // Get current queue state
      const { data: queueEntry, error: fetchError } = await supabase
        .from('queue')
        .select('*')
        .eq('id', queueId)
        .maybeSingle();

      if (fetchError || !queueEntry) {
        return res.status(404).json(formatError('Queue entry not found', 'QUEUE_NOT_FOUND'));
      }

      // Validate state transition
      if (queueEntry.status !== 'CALLED') {
        return res.status(400).json(formatError(
          `Cannot start: patient is in ${queueEntry.status} state`,
          'INVALID_STATE_TRANSITION'
        ));
      }

      // Update to IN_PROGRESS
      const { data: updatedQueue, error: updateError } = await supabase
        .from('queue')
        .update({
          status: 'IN_PROGRESS',
          activated_at: new Date().toISOString(),
          doctor_id: doctorId || queueEntry.doctor_id,
          version: queueEntry.version + 1,
        })
        .eq('id', queueId)
        .eq('version', queueEntry.version)
        .select()
        .single();

      if (updateError) {
        return res.status(409).json(formatError(
          'Concurrent modification detected',
          'CONCURRENT_MODIFICATION'
        ));
      }

      // Log the start action
      await logQueueAction(supabase, {
        queueId: updatedQueue.id,
        patientId: updatedQueue.patient_id,
        action: 'STARTED',
        doctorId: doctorId,
        clinicId: updatedQueue.current_clinic_id,
        fromStep: updatedQueue.current_step,
        toStep: updatedQueue.current_step,
      });

      return res.status(200).json(formatSuccess({
        queueId: updatedQueue.id,
        status: updatedQueue.status,
        startedAt: updatedQueue.activated_at,
      }, 'Patient examination started'));
    }

    // ==================== ADVANCE (IN_PROGRESS -> next clinic or DONE) ====================

    if (pathname === '/api/v1/queue/advance' && method === 'POST') {
      const { queueId, doctorId } = body;

      if (!queueId) {
        return res.status(400).json(formatError('Missing required field: queueId', 'MISSING_QUEUE_ID'));
      }

      // Get current queue state
      const { data: queueEntry, error: fetchError } = await supabase
        .from('queue')
        .select('*')
        .eq('id', queueId)
        .maybeSingle();

      if (fetchError || !queueEntry) {
        return res.status(404).json(formatError('Queue entry not found', 'QUEUE_NOT_FOUND'));
      }

      // Validate state
      if (queueEntry.status !== 'IN_PROGRESS') {
        return res.status(400).json(formatError(
          `Cannot advance: patient is in ${queueEntry.status} state`,
          'INVALID_STATE_TRANSITION'
        ));
      }

      // Validate doctor control (optional - can be enforced strictly)
      if (doctorId && queueEntry.doctor_id && queueEntry.doctor_id !== doctorId) {
        return res.status(403).json(formatError(
          'Only the assigned doctor can advance this patient',
          'UNAUTHORIZED_DOCTOR'
        ));
      }

      const currentStep = queueEntry.current_step;
      const path = queueEntry.path || [];
      const isLastStep = currentStep >= path.length - 1;

      if (isLastStep) {
        // Complete the queue
        const { data: updatedQueue, error: updateError } = await supabase
          .from('queue')
          .update({
            status: 'DONE',
            completed_at: new Date().toISOString(),
            version: queueEntry.version + 1,
          })
          .eq('id', queueId)
          .eq('version', queueEntry.version)
          .select()
          .single();

        if (updateError) {
          return res.status(409).json(formatError('Concurrent modification', 'CONCURRENT_MODIFICATION'));
        }

        // Decrement clinic load
        await supabase.rpc('decrement_clinic_load', { 
          p_clinic_id: queueEntry.current_clinic_id 
        });

        // Log completion
        await logQueueAction(supabase, {
          queueId: updatedQueue.id,
          patientId: updatedQueue.patient_id,
          action: 'COMPLETED',
          doctorId: doctorId,
          clinicId: updatedQueue.current_clinic_id,
          fromStep: currentStep,
          toStep: currentStep,
          details: { completed: true }
        });

        return res.status(200).json(formatSuccess({
          queueId: updatedQueue.id,
          status: 'DONE',
          completedAt: updatedQueue.completed_at,
          message: 'All examinations completed',
        }));
      } else {
        // Move to next clinic
        const nextStep = currentStep + 1;
        const nextClinicId = path[nextStep];

        // Decrement old clinic load
        await supabase.rpc('decrement_clinic_load', { 
          p_clinic_id: queueEntry.current_clinic_id 
        });

        // Get new queue number for next clinic
        const nextNumber = await getNextQueueNumber(supabase, nextClinicId);

        // Update to next clinic
        const { data: updatedQueue, error: updateError } = await supabase
          .from('queue')
          .update({
            current_clinic_id: nextClinicId,
            display_number: nextNumber,
            status: 'WAITING',
            current_step: nextStep,
            called_at: null,
            activated_at: null,
            doctor_id: null,
            version: queueEntry.version + 1,
          })
          .eq('id', queueId)
          .eq('version', queueEntry.version)
          .select()
          .single();

        if (updateError) {
          return res.status(409).json(formatError('Concurrent modification', 'CONCURRENT_MODIFICATION'));
        }

        // Increment new clinic load
        await supabase.rpc('increment_clinic_load', { p_clinic_id: nextClinicId });

        // Log advancement
        await logQueueAction(supabase, {
          queueId: updatedQueue.id,
          patientId: updatedQueue.patient_id,
          action: 'ADVANCED',
          doctorId: doctorId,
          clinicId: nextClinicId,
          fromStep: currentStep,
          toStep: nextStep,
          details: { previousClinic: queueEntry.current_clinic_id }
        });

        return res.status(200).json(formatSuccess({
          queueId: updatedQueue.id,
          status: 'WAITING',
          currentStep: nextStep,
          currentClinic: nextClinicId,
          number: nextNumber,
          message: 'Advanced to next clinic',
        }));
      }
    }

    // ==================== QUEUE STATUS ====================

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const clinicId = query.clinicId || query.clinic;

      if (!clinicId) {
        return res.status(400).json(formatError('Missing required parameter: clinicId', 'MISSING_CLINIC_ID'));
      }

      // Get queue for clinic
      const { data: queues, error } = await supabase
        .from('queue')
        .select('id, display_number, status, current_step, called_at, activated_at')
        .eq('current_clinic_id', clinicId)
        .in('status', ['WAITING', 'CALLED', 'IN_PROGRESS'])
        .order('display_number', { ascending: true });

      if (error) {
        return res.status(500).json(formatError('Failed to fetch queue status', 'DB_ERROR'));
      }

      // Get current serving number
      const serving = queues?.find(q => q.status === 'IN_PROGRESS');
      const called = queues?.filter(q => q.status === 'CALLED');
      const waiting = queues?.filter(q => q.status === 'WAITING');

      return res.status(200).json(formatSuccess({
        clinicId,
        currentServing: serving?.display_number || null,
        calledCount: called?.length || 0,
        waitingCount: waiting?.length || 0,
        called: called?.map(q => ({ number: q.display_number, calledAt: q.called_at })) || [],
        waiting: waiting?.map(q => ({ number: q.display_number })) || [],
      }));
    }

    // ==================== GET QUEUE POSITION ====================

    if (pathname === '/api/v1/queue/position' && method === 'GET') {
      const clinicId = query.clinic;
      const patientId = query.user;

      if (!clinicId || !patientId) {
        return res.status(400).json(formatError('Missing required parameters: clinic, user', 'MISSING_PARAMS'));
      }

      const { data: queueEntry, error } = await supabase
        .from('queue')
        .select('*')
        .eq('current_clinic_id', clinicId)
        .eq('patient_id', patientId)
        .in('status', ['WAITING', 'CALLED', 'IN_PROGRESS'])
        .maybeSingle();

      if (error || !queueEntry) {
        return res.status(404).json(formatError('Queue entry not found', 'QUEUE_NOT_FOUND'));
      }

      // Count patients ahead
      const { count: aheadCount } = await supabase
        .from('queue')
        .select('*', { count: 'exact', head: true })
        .eq('current_clinic_id', clinicId)
        .eq('status', 'WAITING')
        .lt('display_number', queueEntry.display_number);

      // Get current serving number
      const { data: serving } = await supabase
        .from('queue')
        .select('display_number')
        .eq('current_clinic_id', clinicId)
        .eq('status', 'IN_PROGRESS')
        .maybeSingle();

      return res.status(200).json(formatSuccess({
        display_number: queueEntry.display_number,
        current_number: serving?.display_number || 0,
        ahead: aheadCount || 0,
        total_waiting: (aheadCount || 0) + 1,
        status: queueEntry.status,
        estimated_wait_minutes: (aheadCount || 0) * 5,
      }));
    }

    // ==================== QUEUE STATS ====================

    if (pathname === '/api/v1/stats/queues' && method === 'GET') {
      const { data: stats, error } = await supabase
        .from('queue_stats')
        .select('*');

      if (error) {
        return res.status(500).json(formatError('Failed to fetch queue stats', 'DB_ERROR'));
      }

      return res.status(200).json(formatSuccess({ stats }));
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

      const loginStatus = resolveAdminLoginStatus({ username, password, admin });

      if (loginStatus !== 200) {
        return res.status(loginStatus).json(formatError('Invalid username or password', 'INVALID_CREDENTIALS'));
      }

      if (!hasValidAdminSecret(process.env.ADMIN_AUTH_SECRET)) {
        return res.status(503).json(formatError('Server admin token configuration is missing', 'ADMIN_SECRET_MISSING'));
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

      if (pathname === '/api/v1/admin/queue/logs' && method === 'GET') {
        const { data: logs, error } = await supabase
          .from('queue_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) {
          return res.status(500).json(formatError('Failed to fetch logs', 'DB_ERROR'));
        }

        return res.status(200).json(formatSuccess({ logs }));
      }

      if (pathname === '/api/v1/admin/queue/recover' && method === 'POST') {
        // Recovery: Resume any IN_PROGRESS queues that might have been stuck
        const { data: stuckQueues, error: fetchError } = await supabase
          .from('queue')
          .select('*')
          .eq('status', 'IN_PROGRESS')
          .lt('activated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()); // 30 min timeout

        if (fetchError) {
          return res.status(500).json(formatError('Failed to fetch stuck queues', 'DB_ERROR'));
        }

        const recovered = [];
        for (const queue of (stuckQueues || [])) {
          const { data: updated } = await supabase
            .from('queue')
            .update({ status: 'CALLED', version: queue.version + 1 })
            .eq('id', queue.id)
            .eq('version', queue.version)
            .select()
            .single();
          
          if (updated) {
            recovered.push(updated.id);
            await logQueueAction(supabase, {
              queueId: updated.id,
              patientId: updated.patient_id,
              action: 'RECOVERED',
              clinicId: updated.current_clinic_id,
              details: { reason: 'timeout_recovery' }
            });
          }
        }

        return res.status(200).json(formatSuccess({
          recovered: recovered.length,
          queueIds: recovered,
        }, 'Recovery completed'));
      }
    }

    // Default 404
    return res.status(404).json(formatError('Route not found', 'NOT_FOUND'));

  } catch (error) {
    console.error('API Handler Error:', error);
    return handleError(error, res);
  }
}
