import { supabaseQuery, supabaseInsert, supabaseUpdate, supabaseRpc, supabaseDelete } from './supabase-client.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  const { method, url } = req;
  const parsedUrl = new URL(url, `https://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const body = req.body || {};

  const sendError = (message, status = 400) => {
    return res.status(status).json({
      success: false,
      error: { message, code: status, timestamp: new Date().toISOString() }
    });
  };

  const sendSuccess = (data, status = 200) => {
    return res.status(status).json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  };

  const generateDailyPIN = (clinicId) => {
    const today = new Date().toISOString().split('T')[0];
    const secret = process.env.PIN_SECRET || 'mmc-mms-secret-2026';
    const hash = crypto.createHmac('sha256', secret).update(`${clinicId}-${today}`).digest('hex');
    return (parseInt(hash.substring(0, 8), 16) % 9000 + 1000).toString();
  };

  try {
    // ==================== REPORTS & STATISTICS ====================
    if (pathname === '/api/v1/reports/summary' && method === 'GET') {
      // جلب إحصائيات عامة من مشهد queue_admin_view
      const stats = await supabaseQuery('queue_admin_view');
      return sendSuccess({
        summary: stats,
        generatedAt: new Date().toISOString()
      });
    }

    if (pathname === '/api/v1/reports/export' && method === 'POST') {
      const { format, clinicId, period } = body;
      if (!format) return sendError('Format (PDF/CSV) is required');
      
      // منطق التصدير (محاكاة)
      return sendSuccess({
        message: `Report export in ${format} started for ${clinicId || 'all clinics'}`,
        downloadUrl: `https://api.mmc-mms.com/api/v1/reports/download/${Date.now()}.${format.toLowerCase()}`
      });
    }

    // ==================== DYNAMIC ROUTES ====================
    if (pathname.startsWith('/api/v1/pathway/') && method === 'GET') {
      const patientId = pathname.split('/').pop();
      const patients = await supabaseQuery('patients', { filter: { patient_id: patientId } });
      if (patients.length === 0) return sendError('Patient not found', 404);
      const patient = patients[0];
      const clinics = await supabaseQuery('clinics', { filter: { is_active: true }, order: 'floor.asc' });
      const availableClinics = clinics.filter(c => c.gender_constraint === 'mixed' || c.gender_constraint === patient.gender);
      return sendSuccess({ patientId, gender: patient.gender, pathway: availableClinics.map(c => ({ id: c.id, name: c.name_ar, floor: c.floor, status: 'PENDING' })) });
    }

    // ==================== SSE NOTIFICATIONS ====================
    if (pathname === '/api/v1/events/stream' && method === 'GET') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
      sendEvent({ type: 'CONNECTED', timestamp: new Date().toISOString() });
      const keepAlive = setInterval(() => sendEvent({ type: 'HEARTBEAT', timestamp: new Date().toISOString() }), 30000);
      req.on('close', () => { clearInterval(keepAlive); res.end(); });
      return;
    }

    if (!pathname.startsWith('/api/v1/')) {
      if (pathname.startsWith('/api/')) {
        const newPath = pathname.replace('/api/', '/api/v1/');
        res.setHeader('Location', newPath);
        return res.status(301).end();
      }
      return sendError('Invalid API version', 404);
    }

    // ==================== QUEUE ENGINE ====================
    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const { clinicId, patientId } = body;
      if (!clinicId || !patientId) return sendError('Clinic ID and Patient ID are required');
      const entry = await supabaseInsert('queue', { clinic_id: clinicId, patient_id: patientId, status: 'WAITING', entered_at: new Date().toISOString() });
      return sendSuccess(entry[0]);
    }

    if (pathname === '/api/v1/queue/next' && method === 'POST') {
      const { clinicId, pin } = body;
      if (!clinicId || !pin) return sendError('Clinic ID and PIN are required');
      if (pin !== generateDailyPIN(clinicId)) return sendError('Invalid PIN', 401);
      await supabaseUpdate('queue', { clinic_id: clinicId, status: 'YOUR_TURN' }, { status: 'DONE', completed_at: new Date().toISOString() });
      const nextInQueue = await supabaseQuery('queue', { filter: { clinic_id: clinicId, status: 'WAITING' }, order: 'entered_at.asc', limit: 1 });
      if (nextInQueue.length === 0) return sendSuccess({ message: 'No patients in waiting' });
      const updated = await supabaseUpdate('queue', { id: nextInQueue[0].id }, { status: 'YOUR_TURN', called_at: new Date().toISOString() });
      return sendSuccess(updated[0]);
    }

    // ==================== PIN MANAGEMENT ====================
    if (pathname === '/api/v1/pin/generate' && method === 'POST') {
      const { clinicId } = body;
      if (!clinicId) return sendError('Clinic ID is required');
      return sendSuccess({ clinicId, pin: generateDailyPIN(clinicId) });
    }

    // ==================== PATIENTS ====================
    if (pathname === '/api/v1/patients/login' && method === 'POST') {
      const { patientId, gender } = body;
      if (!patientId) return sendError('Patient ID is required');
      const patients = await supabaseQuery('patients', { filter: { patient_id: patientId } });
      if (patients.length === 0) {
        const newPatient = await supabaseInsert('patients', { patient_id: patientId, gender, status: 'WAITING' });
        return sendSuccess(newPatient[0]);
      }
      return sendSuccess(patients[0]);
    }

    return sendError('Endpoint not found', 404);

  } catch (error) {
    console.error('API Error:', error);
    return sendError(error.message, 500);
  }
}
