import crypto from 'crypto';

// ==================== CONFIGURATION ====================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_SECRET;

// ==================== CORE UTILITIES ====================
async function supabaseRequest(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.method === 'POST' || options.method === 'PATCH' ? 'return=representation' : ''
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Supabase Error: ${JSON.stringify(error)}`);
  }
  return await response.json();
}

// ==================== BUSINESS LOGIC ====================
function generateDailyPIN(clinicId) {
  const today = new Date().toISOString().split('T')[0];
  const secret = process.env.PIN_SECRET || 'mmc-mms-secret-2026';
  const hash = crypto.createHmac('sha256', secret).update(`${clinicId}-${today}`).digest('hex');
  return (parseInt(hash.substring(0, 8), 16) % 9000 + 1000).toString();
}

async function getNextDisplayNumber(clinicId) {
  const today = new Date().toISOString().split('T')[0];
  const data = await supabaseRequest(`queues?clinic_id=eq.${clinicId}&order=display_number.desc&limit=1`);
  
  if (data.length === 0) return 1;
  const lastEntryDate = new Date(data[0].entered_at).toISOString().split('T')[0];
  if (lastEntryDate !== today) return 1;
  
  return (data[0].display_number || 0) + 1;
}

async function getQueueStatus(clinicId, patientId) {
  const data = await supabaseRequest(`queues?clinic_id=eq.${clinicId}&patient_id=eq.${patientId}&order=entered_at.desc&limit=1`);
  if (data.length === 0) return null;

  const patient = data[0];
  const waitingList = await supabaseRequest(`queues?clinic_id=eq.${clinicId}&status=eq.waiting&order=entered_at.asc`);
  const position = waitingList.findIndex(q => q.id === patient.id) + 1;

  return {
    id: patient.id,
    status: patient.status,
    position: position > 0 ? position : 0,
    display_number: patient.display_number,
    entered_at: patient.entered_at,
    called_at: patient.called_at,
    completed_at: patient.completed_at
  };
}

// ==================== API HANDLER ====================
export default async function handler(req, res) {
  const { method, url } = req;
  const parsedUrl = new URL(url, `https://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  
  let body = {};
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (e) { /* ignore */ }
  }

  const sendResponse = (data, status = 200) => res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });
  const sendError = (message, status = 400) => res.status(status).json({ success: false, error: { message, code: status }, timestamp: new Date().toISOString() });

  try {
    // 1. Health Check
    if (pathname === '/api/v1/health') return sendResponse({ status: 'ok' });

    // 2. PIN Management
    if (pathname === '/api/v1/pin/generate' && method === 'POST') {
      const { clinicId } = body;
      if (!clinicId) return sendError('Clinic ID required');
      return sendResponse({ clinicId, pin: generateDailyPIN(clinicId) });
    }

    if (pathname === '/api/v1/pin/validate' && method === 'POST') {
      const { clinicId, pin } = body;
      if (!clinicId || !pin) return sendError('Clinic ID and PIN required');
      return sendResponse({ clinicId, isValid: pin === generateDailyPIN(clinicId) });
    }

    // 3. Patient Login
    if (pathname === '/api/v1/patients/login' && method === 'POST') {
      const { patientId, gender } = body;
      if (!patientId) return sendError('Patient ID required');
      
      const existing = await supabaseRequest(`patients?patient_id=eq.${patientId}`);
      if (existing.length > 0) return sendResponse(existing[0]);

      const newUser = await supabaseRequest('patients', {
        method: 'POST',
        body: JSON.stringify({ patient_id: patientId, gender: gender || 'male', status: 'active', created_at: new Date().toISOString() })
      });
      return sendResponse(newUser[0] || newUser);
    }

    // 4. Queue Operations
    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const { clinicId, patientId } = body;
      if (!clinicId || !patientId) return sendError('Clinic ID and Patient ID required');
      
      const displayNumber = await getNextDisplayNumber(clinicId);
      const entry = await supabaseRequest('queues', {
        method: 'POST',
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: patientId,
          display_number: displayNumber,
          status: 'waiting',
          entered_at: new Date().toISOString()
        })
      });
      return sendResponse(entry[0] || entry);
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const clinicId = parsedUrl.searchParams.get('clinicId');
      const patientId = parsedUrl.searchParams.get('patientId');
      if (!clinicId || !patientId) return sendError('Clinic ID and Patient ID required');
      
      const status = await getQueueStatus(clinicId, patientId);
      return status ? sendResponse(status) : sendError('Not in queue', 404);
    }

    if (pathname === '/api/v1/queue/next' && method === 'POST') {
      const { clinicId, pin } = body;
      if (!clinicId || !pin) return sendError('Clinic ID and PIN required');
      if (pin !== generateDailyPIN(clinicId)) return sendError('Invalid PIN', 401);

      // Complete current
      await supabaseRequest(`queues?clinic_id=eq.${clinicId}&status=eq.serving`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() })
      }).catch(() => {});

      // Call next
      const next = await supabaseRequest(`queues?clinic_id=eq.${clinicId}&status=eq.waiting&order=entered_at.asc&limit=1`);
      if (next.length === 0) return sendResponse({ message: 'Queue empty' });

      const updated = await supabaseRequest(`queues?id=eq.${next[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'serving', called_at: new Date().toISOString() })
      });
      return sendResponse(updated[0] || updated);
    }

    if (pathname === '/api/v1/queue/done' && method === 'POST') {
      const { clinicId, patientId, pin } = body;
      if (!clinicId || !patientId || !pin) return sendError('Clinic ID, Patient ID and PIN required');
      if (pin !== generateDailyPIN(clinicId)) return sendError('Invalid PIN', 401);

      const updated = await supabaseRequest(`queues?clinic_id=eq.${clinicId}&patient_id=eq.${patientId}&status=eq.serving`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() })
      });
      return sendResponse(updated[0] || updated);
    }

    // 5. Pathway
    if (pathname.startsWith('/api/v1/pathway/') && method === 'GET') {
      const patientId = pathname.split('/').pop();
      const patient = await supabaseRequest(`patients?patient_id=eq.${patientId}`);
      if (patient.length === 0) return sendError('Patient not found', 404);

      // Return a mock pathway for now, or integrate with dynamic-pathways logic
      return sendResponse({
        patient_id: patientId,
        pathway: [
          { id: 'xray', name: 'الأشعة' },
          { id: 'lab', name: 'المختبر' }
        ]
      });
    }

    return sendError('Endpoint not found', 404);
  } catch (error) {
    console.error('API Error:', error);
    return sendError(error.message, 500);
  }
}
