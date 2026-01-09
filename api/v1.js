import crypto from 'crypto';

// ==================== SUPABASE CLIENT FUNCTIONS ====================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_SECRET;

async function supabaseQuery(table, options = {}) {
  const { select = '*', filter = {}, limit, order } = options;
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}`;
  
  Object.entries(filter).forEach(([key, value]) => {
    url += `&${key}=eq.${value}`;
  });
  if (limit) url += `&limit=${limit}`;
  if (order) url += `&order=${order}`;
  
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Supabase query failed: ${JSON.stringify(error)}`);
  }
  return await response.json();
}

async function supabaseInsert(table, data) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Supabase insert failed: ${JSON.stringify(error)}`);
  }
  return await response.json();
}

async function supabaseUpdate(table, filter, data) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?`;
  Object.entries(filter).forEach(([key, value], index) => {
    if (index > 0) url += '&';
    url += `${key}=eq.${value}`;
  });
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Supabase update failed: ${JSON.stringify(error)}`);
  }
  return await response.json();
}

// ==================== PIN GENERATION & VALIDATION ====================
function generateDailyPIN(clinicId) {
  const today = new Date().toISOString().split('T')[0];
  const secret = process.env.PIN_SECRET || 'mmc-mms-secret-2026';
  const hash = crypto.createHmac('sha256', secret).update(`${clinicId}-${today}`).digest('hex');
  return (parseInt(hash.substring(0, 8), 16) % 9000 + 1000).toString();
}

function validateDailyPIN(clinicId, pin) {
  return pin === generateDailyPIN(clinicId);
}

// ==================== QUEUE ENGINE LOGIC ====================
async function getNextDisplayNumber(clinicId) {
  const today = new Date().toISOString().split('T')[0];
  const queue = await supabaseQuery('queues', {
    filter: { clinic_id: clinicId },
    order: 'display_number.desc',
    limit: 1
  });
  
  if (queue.length === 0) return 1;
  
  // Check if the last entry was today
  const lastEntryDate = new Date(queue[0].entered_at).toISOString().split('T')[0];
  if (lastEntryDate !== today) return 1;
  
  return (queue[0].display_number || 0) + 1;
}

async function getQueueStatus(clinicId, patientId) {
  const queue = await supabaseQuery('queues', {
    filter: { clinic_id: clinicId, patient_id: patientId },
    order: 'entered_at.desc',
    limit: 1
  });
  
  if (queue.length === 0) return null;
  
  const patient = queue[0];
  const allInQueue = await supabaseQuery('queues', {
    filter: { clinic_id: clinicId, status: 'waiting' },
    order: 'entered_at.asc'
  });
  
  const position = allInQueue.findIndex(q => q.id === patient.id) + 1;
  
  return {
    id: patient.id,
    status: patient.status,
    position: position > 0 ? position : 0,
    enteredAt: patient.entered_at,
    calledAt: patient.called_at,
    completedAt: patient.completed_at
  };
}

// ==================== MAIN HANDLER ====================
export default async function handler(req, res) {
  const { method, url } = req;
  const parsedUrl = new URL(url, `https://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  
  // Parse body for POST/PATCH requests
  let body = {};
  if (method === 'POST' || method === 'PATCH') {
    try {
      if (typeof req.body === 'string') {
        body = JSON.parse(req.body);
      } else if (req.body) {
        body = req.body;
      }
    } catch (e) {
      // Body parsing failed, continue with empty body
    }
  }

  const sendError = (message, status = 400) => {
    res.status(status).json({
      success: false,
      error: { message, code: status, timestamp: new Date().toISOString() }
    });
  };

  const sendSuccess = (data, status = 200) => {
    res.status(status).json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  };

  try {
    // ==================== HEALTH CHECK ====================
    if (pathname === '/api/v1/health' && method === 'GET') {
      return sendSuccess({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // ==================== PIN MANAGEMENT ====================
    if (pathname === '/api/v1/pin/generate' && method === 'POST') {
      const { clinicId } = body;
      if (!clinicId) return sendError('Clinic ID is required');
      
      const pin = generateDailyPIN(clinicId);
      
      // Store PIN in database for audit trail
      try {
        await supabaseInsert('clinic_pins', {
          clinic_id: clinicId,
          pin_hash: crypto.createHash('sha256').update(pin).digest('hex'),
          generated_at: new Date().toISOString(),
          expires_at: new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString()
        });
      } catch (e) {
        // PIN storage failed, but still return the PIN
      }
      
      return sendSuccess({ clinicId, pin });
    }

    if (pathname === '/api/v1/pin/validate' && method === 'POST') {
      const { clinicId, pin } = body;
      if (!clinicId || !pin) return sendError('Clinic ID and PIN are required');
      
      const isValid = validateDailyPIN(clinicId, pin);
      return sendSuccess({ clinicId, isValid });
    }

    // ==================== PATIENTS ====================
    if (pathname === '/api/v1/patients/login' && method === 'POST') {
      const { patientId, gender } = body;
      if (!patientId) return sendError('Patient ID is required');
      
      let patient;
      const existing = await supabaseQuery('patients', { filter: { patient_id: patientId } });
      
      if (existing.length === 0) {
        const result = await supabaseInsert('patients', {
          patient_id: patientId,
          gender: gender || 'other',
          status: 'active',
          created_at: new Date().toISOString()
        });
        patient = result[0] || result;
      } else {
        patient = existing[0];
      }
      
      return sendSuccess(patient);
    }

    if (pathname.startsWith('/api/v1/patients/') && method === 'GET') {
      const patientId = pathname.split('/').pop();
      if (!patientId) return sendError('Patient ID is required');
      
      const patients = await supabaseQuery('patients', { filter: { patient_id: patientId } });
      if (patients.length === 0) return sendError('Patient not found', 404);
      
      return sendSuccess(patients[0]);
    }

    // ==================== QUEUE OPERATIONS ====================
    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const { clinicId, patientId, examType } = body;
      if (!clinicId || !patientId) return sendError('Clinic ID and Patient ID are required');
      
      const entry = await supabaseInsert('queues', {
        clinic_id: clinicId,
        patient_id: patientId,
        display_number: await getNextDisplayNumber(clinicId),
        status: 'waiting',
        entered_at: new Date().toISOString()
      });
      
      return sendSuccess(entry[0] || entry);
    }

    if (pathname === '/api/v1/queue/done' && method === 'POST') {
      const { clinicId, patientId, pin } = body;
      if (!clinicId || !patientId || !pin) return sendError('Clinic ID, Patient ID and PIN are required');
      
      if (!validateDailyPIN(clinicId, pin)) {
        return sendError('Invalid PIN', 401);
      }
      
      const updated = await supabaseUpdate('queues', { clinic_id: clinicId, patient_id: patientId, status: 'serving' }, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by_pin: pin
      });
      
      return sendSuccess(updated[0] || updated);
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const { clinicId, patientId } = parsedUrl.searchParams;
      if (!clinicId || !patientId) return sendError('Clinic ID and Patient ID are required');
      
      const status = await getQueueStatus(clinicId, patientId);
      if (!status) return sendError('Patient not in queue', 404);
      
      return sendSuccess(status);
    }

    if (pathname === '/api/v1/queue/next' && method === 'POST') {
      const { clinicId, pin } = body;
      if (!clinicId || !pin) return sendError('Clinic ID and PIN are required');
      
      if (!validateDailyPIN(clinicId, pin)) {
        return sendError('Invalid PIN', 401);
      }
      
      // Mark current serving as completed
      const current = await supabaseQuery('queues', {
        filter: { clinic_id: clinicId, status: 'serving' },
        limit: 1
      });
      
      if (current.length > 0) {
        await supabaseUpdate('queues', { id: current[0].id }, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by_pin: pin
        });
      }
      
      // Get next waiting patient
      const nextPatients = await supabaseQuery('queues', {
        filter: { clinic_id: clinicId, status: 'waiting' },
        order: 'entered_at.asc',
        limit: 1
      });
      
      if (nextPatients.length === 0) {
        return sendSuccess({ message: 'No patients in waiting queue' });
      }
      
      const updated = await supabaseUpdate('queues', { id: nextPatients[0].id }, {
        status: 'serving',
        called_at: new Date().toISOString()
      });
      
      return sendSuccess(updated[0] || updated);
    }

    if (pathname === '/api/v1/queue/cancel' && method === 'POST') {
      const { queueId } = body;
      if (!queueId) return sendError('Queue ID is required');
      
      const updated = await supabaseUpdate('queue', { id: queueId }, {
        status: 'CANCELLED',
        cancelled_at: new Date().toISOString()
      });
      
      return sendSuccess(updated[0] || updated);
    }

    if (pathname === '/api/v1/queue/clinic' && method === 'GET') {
      const { clinicId } = parsedUrl.searchParams;
      if (!clinicId) return sendError('Clinic ID is required');
      
      const queue = await supabaseQuery('queues', {
        filter: { clinic_id: clinicId },
        order: 'entered_at.asc'
      });
      
      return sendSuccess({ clinicId, queue, count: queue.length });
    }

    // ==================== CLINICS ====================
    if (pathname === '/api/v1/clinics' && method === 'GET') {
      const clinics = await supabaseQuery('clinics', { filter: { is_active: true } });
      return sendSuccess(clinics);
    }

    if (pathname.startsWith('/api/v1/clinics/') && method === 'GET') {
      const clinicId = pathname.split('/').pop();
      const clinics = await supabaseQuery('clinics', { filter: { id: clinicId } });
      if (clinics.length === 0) return sendError('Clinic not found', 404);
      return sendSuccess(clinics[0]);
    }

    // ==================== DYNAMIC ROUTES ====================
    if (pathname.startsWith('/api/v1/pathway/') && method === 'GET') {
      const patientId = pathname.split('/').pop();
      const patients = await supabaseQuery('patients', { filter: { patient_id: patientId } });
      if (patients.length === 0) return sendError('Patient not found', 404);
      
      const patient = patients[0];
      const clinics = await supabaseQuery('clinics', { filter: { is_active: true }, order: 'floor.asc' });
      const availableClinics = clinics.filter(c => 
        c.gender_constraint === 'mixed' || c.gender_constraint === patient.gender
      );
      
      return sendSuccess({
        patientId,
        gender: patient.gender,
        pathway: availableClinics.map(c => ({
          id: c.id,
          name: c.name_ar,
          floor: c.floor,
          status: 'PENDING'
        }))
      });
    }

    // ==================== REPORTS & STATISTICS ====================
    if (pathname === '/api/v1/reports/summary' && method === 'GET') {
      const { clinicId } = parsedUrl.searchParams;
      
      let query = 'queues';
      let filter = {};
      if (clinicId) filter.clinic_id = clinicId;
      
      const queue = await supabaseQuery(query, filter);
      
      const summary = {
        total: queue.length,
        waiting: queue.filter(q => q.status === 'waiting').length,
        serving: queue.filter(q => q.status === 'serving').length,
        completed: queue.filter(q => q.status === 'completed').length,
        skipped: queue.filter(q => q.status === 'skipped').length,
        generatedAt: new Date().toISOString()
      };
      
      return sendSuccess(summary);
    }

    if (pathname === '/api/v1/reports/export' && method === 'POST') {
      const { format, clinicId, period } = body;
      if (!format) return sendError('Format (PDF/CSV) is required');
      
      return sendSuccess({
        message: `Report export in ${format} started for ${clinicId || 'all clinics'}`,
        downloadUrl: `https://api.mmc-mms.com/api/v1/reports/download/${Date.now()}.${format.toLowerCase()}`
      });
    }

    // ==================== SSE NOTIFICATIONS ====================
    if (pathname === '/api/v1/events/stream' && method === 'GET') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      const sendEvent = (data) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (e) {
          // Client disconnected
        }
      };
      
      sendEvent({ type: 'CONNECTED', timestamp: new Date().toISOString() });
      
      const keepAlive = setInterval(() => {
        sendEvent({ type: 'HEARTBEAT', timestamp: new Date().toISOString() });
      }, 30000);
      
      req.on('close', () => {
        clearInterval(keepAlive);
        res.end();
      });
      
      return;
    }

    // ==================== LEGACY API REDIRECT ====================
    if (!pathname.startsWith('/api/v1/')) {
      if (pathname.startsWith('/api/')) {
        const newPath = pathname.replace('/api/', '/api/v1/');
        res.setHeader('Location', newPath);
        return res.status(301).end();
      }
      return sendError('Invalid API version', 404);
    }

    return sendError('Endpoint not found', 404);

  } catch (error) {
    console.error('API Error:', error);
    return sendError(error.message || 'Internal Server Error', 500);
  }
}
