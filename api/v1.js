/**
 * V1 API Handler - Doctor-Controlled Queue System (No PIN)
 * @version 5.0.0-Production-Ready
 * 
 * ENDPOINTS:
 * - POST /api/v1/queue/create
 * - POST /api/v1/queue/call
 * - POST /api/v1/queue/start
 * - POST /api/v1/queue/advance
 * - GET  /api/v1/queue/status
 * - GET  /api/v1/health
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// CORS Headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Version, Idempotency-Key',
  'Access-Control-Max-Age': '86400',
};

// Queue Status Constants
const QUEUE_STATUS = {
  WAITING: 'WAITING',
  CALLED: 'CALLED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED'
};

// Valid clinics
const VALID_CLINICS = [
  'lab', 'xray', 'vitals', 'ecg', 'audio', 'eyes',
  'internal', 'ent', 'surgery', 'dental', 'psychiatry',
  'derma', 'bones', 'registration'
];

// Idempotency store (in-memory with TTL)
const idempotencyStore = new Map();
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Clean expired idempotency keys
 */
function cleanExpiredIdempotencyKeys() {
  const now = Date.now();
  for (const [key, data] of idempotencyStore.entries()) {
    if (now - data.timestamp > IDEMPOTENCY_TTL) {
      idempotencyStore.delete(key);
    }
  }
}

/**
 * Get idempotency response
 */
function getIdempotencyResponse(key) {
  cleanExpiredIdempotencyKeys();
  const data = idempotencyStore.get(key);
  return data ? data.response : null;
}

/**
 * Store idempotency response
 */
function storeIdempotencyResponse(key, response) {
  idempotencyStore.set(key, {
    response: JSON.parse(JSON.stringify(response)),
    timestamp: Date.now()
  });
}

/**
 * JSON Response Helper
 */
function jsonResponse(res, data, status = 200) {
  res.status(status).json(data);
}

/**
 * Error Response Helper
 */
function errorResponse(res, error, message, status = 400) {
  jsonResponse(res, {
    success: false,
    error,
    message,
    timestamp: new Date().toISOString()
  }, status);
}

/**
 * Success Response Helper
 */
function successResponse(res, data, status = 200) {
  jsonResponse(res, {
    success: true,
    ...data,
    timestamp: new Date().toISOString()
  }, status);
}

/**
 * Validate clinic ID
 */
function isValidClinic(clinicId) {
  return VALID_CLINICS.includes(clinicId);
}

/**
 * Get dynamic medical pathway
 */
function getMedicalPathway(examType, gender) {
  const basePath = ['registration', 'vitals'];
  
  const pathways = {
    'comprehensive': [...basePath, 'lab', 'xray', 'ecg', 'audio', 'eyes', 'internal', 'ent', 'surgery', 'dental', 'psychiatry'],
    'basic': [...basePath, 'lab', 'xray', 'internal'],
    'cardiac': [...basePath, 'ecg', 'internal'],
    'vision': [...basePath, 'eyes'],
    'hearing': [...basePath, 'audio', 'ent'],
    'dental': [...basePath, 'dental'],
    'dermatology': [...basePath, 'derma'],
    'orthopedic': [...basePath, 'xray', 'bones'],
    'psychiatric': [...basePath, 'psychiatry'],
  };
  
  return pathways[examType] || pathways['comprehensive'];
}

/**
 * Generate queue number atomically
 */
async function generateQueueNumber(clinicId) {
  // Use RPC for atomic increment
  const { data, error } = await supabase.rpc('increment_clinic_counter', {
    p_clinic_id: clinicId
  });
  
  if (error) {
    console.error('Error generating queue number:', error);
    // Fallback: manual increment with retry
    return await generateQueueNumberFallback(clinicId);
  }
  
  return data;
}

/**
 * Fallback queue number generation
 */
async function generateQueueNumberFallback(clinicId, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Get current max
      const { data: maxData, error: maxError } = await supabase
        .from('queues')
        .select('queue_number')
        .eq('clinic_id', clinicId)
        .eq('queue_date', new Date().toISOString().split('T')[0])
        .order('queue_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (maxError) throw maxError;
      
      const nextNumber = (maxData?.queue_number || 0) + 1;
      
      return nextNumber;
    } catch (err) {
      console.error(`Fallback attempt ${attempt + 1} failed:`, err);
      if (attempt === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

/**
 * Create queue entry
 */
async function createQueue(req, res) {
  try {
    const { patientId, examType, gender, clinicId = 'registration' } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];
    
    // Check idempotency
    if (idempotencyKey) {
      const cachedResponse = getIdempotencyResponse(idempotencyKey);
      if (cachedResponse) {
        return successResponse(res, cachedResponse);
      }
    }
    
    // Validation
    if (!patientId) {
      return errorResponse(res, 'MISSING_PATIENT_ID', 'Patient ID is required', 400);
    }
    
    if (!isValidClinic(clinicId)) {
      return errorResponse(res, 'INVALID_CLINIC', `Invalid clinic: ${clinicId}`, 400);
    }
    
    // Generate queue number atomically
    const queueNumber = await generateQueueNumber(clinicId);
    const today = new Date().toISOString().split('T')[0];
    
    // Get pathway
    const pathway = getMedicalPathway(examType || 'comprehensive', gender || 'male');
    
    // Create queue entry
    const { data: queue, error } = await supabase
      .from('queues')
      .insert({
        patient_id: patientId,
        clinic_id: clinicId,
        queue_number: queueNumber,
        queue_date: today,
        status: QUEUE_STATUS.WAITING,
        exam_type: examType || 'comprehensive',
        gender: gender || 'male',
        current_step: 0,
        pathway: pathway,
        version: 1,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return errorResponse(res, 'DUPLICATE_QUEUE', 'Queue already exists for this patient today', 409);
      }
      throw error;
    }
    
    const response = {
      queueId: queue.id,
      number: queue.queue_number,
      clinicId: queue.clinic_id,
      status: queue.status,
      path: pathway,
      position: 1
    };
    
    // Store idempotency response
    if (idempotencyKey) {
      storeIdempotencyResponse(idempotencyKey, response);
    }
    
    return successResponse(res, response, 201);
    
  } catch (err) {
    console.error('Create queue error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to create queue', 500);
  }
}

/**
 * Call next patient
 */
async function callNextPatient(req, res) {
  try {
    const { clinicId, doctorId } = req.body;
    
    if (!clinicId) {
      return errorResponse(res, 'MISSING_CLINIC_ID', 'Clinic ID is required', 400);
    }
    
    // Verify doctor belongs to clinic (if doctorId provided)
    if (doctorId) {
      const { data: doctor, error: doctorError } = await supabase
        .from('doctors')
        .select('clinic_id')
        .eq('id', doctorId)
        .single();
      
      if (doctorError || !doctor || doctor.clinic_id !== clinicId) {
        return errorResponse(res, 'UNAUTHORIZED', 'Doctor not authorized for this clinic', 403);
      }
    }
    
    // Get next waiting patient
    const { data: nextPatient, error } = await supabase
      .from('queues')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('queue_date', new Date().toISOString().split('T')[0])
      .eq('status', QUEUE_STATUS.WAITING)
      .order('queue_number', { ascending: true })
      .limit(1)
      .maybeSingle();
    
    if (error) throw error;
    
    if (!nextPatient) {
      return successResponse(res, {
        message: 'No waiting patients',
        queue: null
      });
    }
    
    // Update status to CALLED
    const { data: updated, error: updateError } = await supabase
      .from('queues')
      .update({
        status: QUEUE_STATUS.CALLED,
        called_at: new Date().toISOString(),
        called_by: doctorId,
        version: nextPatient.version + 1
      })
      .eq('id', nextPatient.id)
      .eq('version', nextPatient.version)
      .select()
      .single();
    
    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return errorResponse(res, 'VERSION_MISMATCH', 'Queue was modified by another process', 409);
      }
      throw updateError;
    }
    
    return successResponse(res, {
      queue: {
        id: updated.id,
        number: updated.queue_number,
        patientId: updated.patient_id,
        status: updated.status,
        clinicId: updated.clinic_id
      }
    });
    
  } catch (err) {
    console.error('Call next patient error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to call next patient', 500);
  }
}

/**
 * Start examination
 */
async function startExamination(req, res) {
  try {
    const { queueId, doctorId } = req.body;
    
    if (!queueId) {
      return errorResponse(res, 'MISSING_QUEUE_ID', 'Queue ID is required', 400);
    }
    
    // Get queue
    const { data: queue, error } = await supabase
      .from('queues')
      .select('*')
      .eq('id', queueId)
      .single();
    
    if (error || !queue) {
      return errorResponse(res, 'QUEUE_NOT_FOUND', 'Queue not found', 404);
    }
    
    // Verify doctor belongs to clinic (if doctorId provided)
    if (doctorId) {
      const { data: doctor, error: doctorError } = await supabase
        .from('doctors')
        .select('clinic_id')
        .eq('id', doctorId)
        .single();
      
      if (doctorError || !doctor || doctor.clinic_id !== queue.clinic_id) {
        return errorResponse(res, 'UNAUTHORIZED', 'Doctor not authorized for this clinic', 403);
      }
    }
    
    // Validate status transition
    if (queue.status !== QUEUE_STATUS.CALLED && queue.status !== QUEUE_STATUS.WAITING) {
      return errorResponse(res, 'INVALID_STATUS', `Cannot start examination from status: ${queue.status}`, 400);
    }
    
    // Update status
    const { data: updated, error: updateError } = await supabase
      .from('queues')
      .update({
        status: QUEUE_STATUS.IN_PROGRESS,
        started_at: new Date().toISOString(),
        started_by: doctorId,
        version: queue.version + 1
      })
      .eq('id', queueId)
      .eq('version', queue.version)
      .select()
      .single();
    
    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return errorResponse(res, 'VERSION_MISMATCH', 'Queue was modified by another process', 409);
      }
      throw updateError;
    }
    
    return successResponse(res, {
      queue: {
        id: updated.id,
        number: updated.queue_number,
        patientId: updated.patient_id,
        status: updated.status,
        clinicId: updated.clinic_id,
        currentStep: updated.current_step,
        pathway: updated.pathway
      }
    });
    
  } catch (err) {
    console.error('Start examination error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to start examination', 500);
  }
}

/**
 * Advance patient to next step/clinic
 */
async function advancePatient(req, res) {
  try {
    const { queueId, doctorClinicId, version } = req.body;
    
    if (!queueId) {
      return errorResponse(res, 'MISSING_QUEUE_ID', 'Queue ID is required', 400);
    }
    
    // Get queue
    const { data: queue, error } = await supabase
      .from('queues')
      .select('*')
      .eq('id', queueId)
      .single();
    
    if (error || !queue) {
      return errorResponse(res, 'QUEUE_NOT_FOUND', 'Queue not found', 404);
    }
    
    // Verify doctor belongs to current clinic
    if (doctorClinicId && doctorClinicId !== queue.clinic_id) {
      return errorResponse(res, 'UNAUTHORIZED', 'Doctor not authorized for this clinic', 403);
    }
    
    // Version check for concurrency
    if (version !== undefined && version !== queue.version) {
      return errorResponse(res, 'VERSION_MISMATCH', 'Queue was modified by another process', 409);
    }
    
    // Calculate next step
    const nextStep = (queue.current_step || 0) + 1;
    const pathway = queue.pathway || [];
    
    // Check if completed
    if (nextStep >= pathway.length) {
      // Mark as done
      const { data: updated, error: updateError } = await supabase
        .from('queues')
        .update({
          status: QUEUE_STATUS.DONE,
          completed_at: new Date().toISOString(),
          current_step: nextStep,
          version: queue.version + 1
        })
        .eq('id', queueId)
        .eq('version', queue.version)
        .select()
        .single();
      
      if (updateError) {
        if (updateError.code === 'PGRST116') {
          return errorResponse(res, 'VERSION_MISMATCH', 'Queue was modified by another process', 409);
        }
        throw updateError;
      }
      
      return successResponse(res, {
        completed: true,
        queue: {
          id: updated.id,
          status: updated.status,
          currentStep: updated.current_step
        }
      });
    }
    
    // Move to next clinic
    const nextClinicId = pathway[nextStep];
    const newQueueNumber = await generateQueueNumber(nextClinicId);
    
    // Create new queue entry for next clinic
    const { data: newQueue, error: createError } = await supabase
      .from('queues')
      .insert({
        patient_id: queue.patient_id,
        clinic_id: nextClinicId,
        queue_number: newQueueNumber,
        queue_date: queue.queue_date,
        status: QUEUE_STATUS.WAITING,
        exam_type: queue.exam_type,
        gender: queue.gender,
        current_step: nextStep,
        pathway: pathway,
        previous_queue_id: queueId,
        version: 1,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (createError) throw createError;
    
    // Update current queue
    const { data: updated, error: updateError } = await supabase
      .from('queues')
      .update({
        status: QUEUE_STATUS.DONE,
        next_queue_id: newQueue.id,
        version: queue.version + 1
      })
      .eq('id', queueId)
      .eq('version', queue.version)
      .select()
      .single();
    
    if (updateError) {
      // Rollback: delete new queue
      await supabase.from('queues').delete().eq('id', newQueue.id);
      if (updateError.code === 'PGRST116') {
        return errorResponse(res, 'VERSION_MISMATCH', 'Queue was modified by another process', 409);
      }
      throw updateError;
    }
    
    return successResponse(res, {
      completed: false,
      nextClinic: nextClinicId,
      nextQueueNumber: newQueueNumber,
      queue: {
        id: newQueue.id,
        number: newQueue.queue_number,
        clinicId: newQueue.clinic_id,
        status: newQueue.status,
        currentStep: nextStep
      }
    });
    
  } catch (err) {
    console.error('Advance patient error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to advance patient', 500);
  }
}

/**
 * Get queue status
 */
async function getQueueStatus(req, res) {
  try {
    const { queueId, clinicId, patientId } = req.query;
    
    if (!queueId && !clinicId && !patientId) {
      return errorResponse(res, 'MISSING_PARAMETER', 'queueId, clinicId, or patientId is required', 400);
    }
    
    let query = supabase.from('queues').select('*');
    
    if (queueId) {
      query = query.eq('id', queueId);
    } else if (clinicId) {
      query = query.eq('clinic_id', clinicId)
                   .eq('queue_date', new Date().toISOString().split('T')[0]);
    } else if (patientId) {
      query = query.eq('patient_id', patientId)
                   .eq('queue_date', new Date().toISOString().split('T')[0]);
    }
    
    const { data, error } = await query.order('queue_number', { ascending: true });
    
    if (error) throw error;
    
    if (queueId && (!data || data.length === 0)) {
      return errorResponse(res, 'QUEUE_NOT_FOUND', 'Queue not found', 404);
    }
    
    // Calculate waiting count for clinic query
    let waitingCount = 0;
    if (clinicId && data) {
      waitingCount = data.filter(q => q.status === QUEUE_STATUS.WAITING).length;
    }
    
    return successResponse(res, {
      queue: queueId ? data[0] : null,
      queues: clinicId || patientId ? data : null,
      waitingCount,
      totalCount: data?.length || 0
    });
    
  } catch (err) {
    console.error('Get queue status error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to get queue status', 500);
  }
}

/**
 * Patient login
 */
async function patientLogin(req, res) {
  try {
    const { personalId, gender } = req.body;
    
    if (!personalId) {
      return errorResponse(res, 'MISSING_PERSONAL_ID', 'Personal ID is required', 400);
    }
    
    if (!gender || !['male', 'female'].includes(gender)) {
      return errorResponse(res, 'INVALID_GENDER', 'Gender must be male or female', 400);
    }
    
    // Check if patient exists
    let { data: patient, error } = await supabase
      .from('patients')
      .select('*')
      .eq('personal_id', personalId)
      .maybeSingle();
    
    if (error) throw error;
    
    if (!patient) {
      // Create new patient
      const { data: newPatient, error: createError } = await supabase
        .from('patients')
        .insert({
          personal_id: personalId,
          gender: gender,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (createError) throw createError;
      patient = newPatient;
    }
    
    return successResponse(res, {
      data: {
        id: patient.id,
        personalId: patient.personal_id,
        gender: patient.gender,
        name: patient.name || null
      }
    });
    
  } catch (err) {
    console.error('Patient login error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to login patient', 500);
  }
}

/**
 * Admin login
 */
async function adminLogin(req, res) {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return errorResponse(res, 'MISSING_CREDENTIALS', 'Username and password are required', 400);
    }
    
    const { data: admin, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .maybeSingle();
    
    if (error) throw error;
    
    if (!admin) {
      return errorResponse(res, 'INVALID_CREDENTIALS', 'Invalid username or password', 401);
    }
    
    return successResponse(res, {
      success: true,
      data: {
        id: admin.id,
        username: admin.username,
        role: admin.role || 'admin'
      }
    });
    
  } catch (err) {
    console.error('Admin login error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to login', 500);
  }
}

/**
 * Get clinics
 */
async function getClinics(req, res) {
  try {
    const { data: clinics, error } = await supabase
      .from('clinics')
      .select('*')
      .order('display_order', { ascending: true });
    
    if (error) throw error;
    
    return successResponse(res, {
      clinics: clinics || []
    });
    
  } catch (err) {
    console.error('Get clinics error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to get clinics', 500);
  }
}

/**
 * Get stats
 */
async function getStats(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get counts by status
    const { data: statusCounts, error: statusError } = await supabase
      .from('queues')
      .select('status')
      .eq('queue_date', today);
    
    if (statusError) throw statusError;
    
    const stats = {
      total: statusCounts?.length || 0,
      waiting: statusCounts?.filter(q => q.status === QUEUE_STATUS.WAITING).length || 0,
      inProgress: statusCounts?.filter(q => q.status === QUEUE_STATUS.IN_PROGRESS).length || 0,
      done: statusCounts?.filter(q => q.status === QUEUE_STATUS.DONE).length || 0,
      cancelled: statusCounts?.filter(q => q.status === QUEUE_STATUS.CANCELLED).length || 0
    };
    
    return successResponse(res, { stats });
    
  } catch (err) {
    console.error('Get stats error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to get stats', 500);
  }
}

/**
 * Recover queues (after restart)
 */
async function recoverQueues(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Find IN_PROGRESS queues and reset to WAITING
    const { data: inProgressQueues, error: fetchError } = await supabase
      .from('queues')
      .select('*')
      .eq('queue_date', today)
      .eq('status', QUEUE_STATUS.IN_PROGRESS);
    
    if (fetchError) throw fetchError;
    
    let recovered = 0;
    
    for (const queue of (inProgressQueues || [])) {
      const { error: updateError } = await supabase
        .from('queues')
        .update({
          status: QUEUE_STATUS.WAITING,
          version: queue.version + 1
        })
        .eq('id', queue.id);
      
      if (!updateError) recovered++;
    }
    
    return successResponse(res, {
      message: `Recovered ${recovered} queues`,
      recovered
    });
    
  } catch (err) {
    console.error('Recover queues error:', err);
    return errorResponse(res, 'INTERNAL_ERROR', 'Failed to recover queues', 500);
  }
}

/**
 * Main Handler
 */
export default async function handler(req, res) {
  // Set CORS headers
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  // Set API version header
  res.setHeader('X-API-Version', 'v1');
  
  const { url, method } = req;
  const pathname = url.split('?')[0];
  
  // Block PIN requests - 410 Gone
  if (pathname.toLowerCase().includes('pin')) {
    return res.status(410).json({
      success: false,
      error: 'PIN_REMOVED',
      message: 'PIN system has been permanently removed. Use the doctor-controlled queue system.',
      timestamp: new Date().toISOString()
    });
  }
  
  // Route handlers
  const routes = {
    // Queue endpoints
    'POST:/api/v1/queue/create': createQueue,
    'POST:/api/v1/queue/call': callNextPatient,
    'POST:/api/v1/queue/start': startExamination,
    'POST:/api/v1/queue/advance': advancePatient,
    'GET:/api/v1/queue/status': getQueueStatus,
    
    // Patient endpoints
    'POST:/api/v1/patient/login': patientLogin,
    
    // Admin endpoints
    'POST:/api/v1/admin/login': adminLogin,
    'POST:/api/v1/admin/queue/recover': recoverQueues,
    
    // Clinic endpoints
    'GET:/api/v1/clinics': getClinics,
    
    // Stats endpoints
    'GET:/api/v1/stats/dashboard': getStats,
    'GET:/api/v1/stats/queues': getStats,
    
    // Health check
    'GET:/api/v1/health': (req, res) => successResponse(res, {
      status: 'healthy',
      version: '5.0.0',
      features: {
        pinSystem: false,
        doctorControl: true,
        atomicQueue: true,
        idempotency: true
      }
    }),
    
    'GET:/api/v1/status': (req, res) => successResponse(res, {
      status: 'healthy',
      mode: 'online',
      backend: 'up',
      platform: 'vercel',
      version: '5.0.0-no-pin'
    })
  };
  
  const routeKey = `${method}:${pathname}`;
  const handler = routes[routeKey];
  
  if (handler) {
    return handler(req, res);
  }
  
  // 404 for unknown routes
  return res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: `Endpoint not found: ${method} ${pathname}`,
    timestamp: new Date().toISOString()
  });
}
