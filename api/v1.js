import crypto from 'crypto';

// ==================== CONFIGURATION ====================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_SECRET;
const REPAIR_TOKEN = process.env.QA_REPAIR_TOKEN || 'mmc-mms-repair-secret-2026';

// ==================== CORE UTILITIES ====================
async function supabaseRequest(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.method === 'POST' || options.method === 'PATCH' || options.method === 'DELETE' ? 'return=representation' : ''
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(`Supabase Error: ${JSON.stringify(error)}`);
  }
  
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function supabaseRPC(functionName, params = {}) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${functionName}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(`Supabase RPC Error: ${JSON.stringify(error)}`);
  }

  return await response.json();
}

// ==================== BUSINESS LOGIC ====================
function generateDailyPIN(clinicId) {
  const today = new Date().toISOString().split('T')[0];
  const secret = process.env.PIN_SECRET || 'mmc-mms-secret-2026';
  const hash = crypto.createHmac('sha256', secret).update(`${clinicId}-${today}`).digest('hex');
  return (parseInt(hash.substring(0, 8), 16) % 90 + 10).toString();
}

async function getNextDisplayNumber(clinicId) {
  const today = new Date().toISOString().split('T')[0];
  const data = await supabaseRequest(`unified_queue?clinic_id=eq.${clinicId}&order=display_number.desc&limit=1`);
  if (data.length === 0) return 1;
  const lastEntryDate = new Date(data[0].entered_at).toISOString().split('T')[0];
  if (lastEntryDate !== today) return 1;
  return (data[0].display_number || 0) + 1;
}

async function getQueueStatus(clinicId, patientId) {
  const data = await supabaseRequest(`unified_queue?clinic_id=eq.${clinicId}&patient_id=eq.${patientId}&order=entered_at.desc&limit=1`);
  if (data.length === 0) return null;
  const patient = data[0];
  const waitingList = await supabaseRequest(`unified_queue?clinic_id=eq.${clinicId}&status=eq.waiting&order=entered_at.asc`);
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

async function getSettings() {
  try {
    const data = await supabaseRequest('settings?order=key.asc');
    const settings = {};
    data.forEach(s => { settings[s.key] = s.value; });
    return {
      callIntervalSeconds: parseInt(settings.call_interval_seconds) || 120,
      moveToEndSeconds: parseInt(settings.move_to_end_seconds) || 240,
      examDurationSeconds: parseInt(settings.exam_duration_seconds) || 300,
      autoCallEnabled: settings.auto_call_enabled === 'true',
      soundEnabled: settings.sound_enabled === 'true',
      notificationsEnabled: settings.notifications_enabled === 'true'
    };
  } catch (error) {
    return { callIntervalSeconds: 120, moveToEndSeconds: 240, examDurationSeconds: 300, autoCallEnabled: false, soundEnabled: true, notificationsEnabled: true };
  }
}

async function updateSetting(key, value) {
  const existing = await supabaseRequest(`settings?key=eq.${key}`);
  if (existing.length > 0) {
    return await supabaseRequest(`settings?key=eq.${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ value: value.toString(), updated_at: new Date().toISOString() })
    });
  } else {
    return await supabaseRequest('settings', {
      method: 'POST',
      body: JSON.stringify({ key, value: value.toString(), category: 'queue', created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    });
  }
}

// ==================== DEEP QA & REPAIR LOGIC ====================
function generateFingerprint(type, description, metadata = {}) {
  const content = `${type}-${description}-${JSON.stringify(metadata)}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

async function runDeepQA() {
  const startTime = Date.now();
  const run = await supabaseRequest('qa_runs', {
    method: 'POST',
    body: JSON.stringify({ status: 'running', created_at: new Date().toISOString() })
  });
  const runId = run[0].id;
  const findings = [];
  const stats = { clinics_checked: 0, total_findings: 0, contracts_checked: 0 };

  try {
    const clinics = await supabaseRequest('clinics?is_active=eq.true');
    stats.clinics_checked = clinics.length;
    for (const clinic of clinics) {
      if (!clinic.id) {
        findings.push({
          run_id: runId, type: 'DATA_INVARIANT_BROKEN', severity: 'critical',
          description: `Clinic ${clinic.name_ar || 'Unknown'} has no ID`,
          fingerprint: generateFingerprint('DATA_INVARIANT_BROKEN', `clinic-no-id-${clinic.name_ar}`),
          metadata: { clinic_id: clinic.id }
        });
      }
    }

    const expectedSettings = ['call_interval_seconds', 'move_to_end_seconds', 'exam_duration_seconds'];
    const actualSettings = await supabaseRequest('settings');
    const actualKeys = actualSettings.map(s => s.key);
    for (const key of expectedSettings) {
      if (!actualKeys.includes(key)) {
        findings.push({
          run_id: runId, type: 'SETTINGS_DRIFT', severity: 'high',
          description: `Missing critical setting: ${key}`,
          fingerprint: generateFingerprint('SETTINGS_DRIFT', `missing-setting-${key}`),
          metadata: { key }
        });
      }
    }

    const endpoints = [
      { path: 'clinics', method: 'GET' },
      { path: 'settings', method: 'GET' },
      { path: 'unified_queue', method: 'GET', params: 'limit=1' }
    ];
    for (const ep of endpoints) {
      try {
        const t0 = Date.now();
        const data = await supabaseRequest(`${ep.path}${ep.params ? '?' + ep.params : ''}`);
        stats.contracts_checked++;
        const keys = data.length > 0 ? Object.keys(data[0]).sort().join(',') : '';
        const shapeHash = crypto.createHash('md5').update(keys).digest('hex');
        const canonical = await supabaseRequest(`contract_snapshots?endpoint=eq.${ep.path}&method=eq.${ep.method}&is_canonical=eq.true`);
        if (canonical.length > 0 && canonical[0].shape_hash !== shapeHash) {
          findings.push({
            run_id: runId, type: 'CONTRACT_DRIFT', severity: 'medium',
            description: `Contract drift detected on ${ep.path}`,
            fingerprint: generateFingerprint('CONTRACT_DRIFT', `drift-${ep.path}`),
            metadata: { endpoint: ep.path, expected: canonical[0].shape_hash, actual: shapeHash }
          });
        } else if (canonical.length === 0 && keys) {
          await supabaseRequest('contract_snapshots', {
            method: 'POST',
            body: JSON.stringify({ endpoint: ep.path, method: ep.method, shape_hash: shapeHash, is_canonical: true })
          });
        }
      } catch (e) {
        findings.push({
          run_id: runId, type: 'CONTRACT_DRIFT', severity: 'critical',
          description: `Endpoint ${ep.path} failed: ${e.message}`,
          fingerprint: generateFingerprint('CONTRACT_DRIFT', `fail-${ep.path}`),
          metadata: { endpoint: ep.path, error: e.message }
        });
      }
    }

    const totalLatency = Date.now() - startTime;
    if (totalLatency > 5000) {
      findings.push({
        run_id: runId, type: 'PERFORMANCE_REGRESSION', severity: 'low',
        description: `Deep QA run took ${totalLatency}ms`,
        fingerprint: generateFingerprint('PERFORMANCE_REGRESSION', 'slow-deep-run'),
        metadata: { latency: totalLatency }
      });
    }

    if (findings.length > 0) {
      await supabaseRequest('qa_findings', { method: 'POST', body: JSON.stringify(findings) });
    }

    stats.total_findings = findings.length;
    const ok = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length === 0;

    await supabaseRequest(`qa_runs?id=eq.${runId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', ok, stats, performance: { duration_ms: Date.now() - startTime }, completed_at: new Date().toISOString() })
    });

    return { run_id: runId, ok, stats, findings };
  } catch (error) {
    await supabaseRequest(`qa_runs?id=eq.${runId}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', completed_at: new Date().toISOString() }) });
    throw error;
  }
}

async function executeRepair(findingId, token) {
  if (token !== REPAIR_TOKEN) throw new Error('Unauthorized repair attempt');
  const finding = await supabaseRequest(`qa_findings?id=eq.${findingId}`);
  if (finding.length === 0) throw new Error('Finding not found');
  const f = finding[0];
  const repairRun = await supabaseRequest('repair_runs', { method: 'POST', body: JSON.stringify({ run_id: f.run_id, finding_id: f.id, playbook: f.type, status: 'in_progress' }) });
  const repairId = repairRun[0].id;
  let success = false;
  let logs = '';

  try {
    if (f.type === 'SETTINGS_DRIFT') {
      const key = f.metadata.key;
      const defaults = { call_interval_seconds: '120', move_to_end_seconds: '240', exam_duration_seconds: '300' };
      if (defaults[key]) {
        await supabaseRequest('settings', { method: 'POST', body: JSON.stringify({ key, value: defaults[key], category: 'queue' }) });
        success = true;
        logs = `Successfully restored default for ${key}`;
      }
    } else {
      logs = `No safe playbook defined for ${f.type}`;
    }

    await supabaseRequest(`repair_runs?id=eq.${repairId}`, { method: 'PATCH', body: JSON.stringify({ status: success ? 'success' : 'failed', logs, completed_at: new Date().toISOString() }) });
    if (success) {
      await supabaseRequest(`qa_findings?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ is_resolved: true, resolved_at: new Date().toISOString(), repair_run_id: repairId }) });
    }
    return { success, logs };
  } catch (error) {
    await supabaseRequest(`repair_runs?id=eq.${repairId}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', logs: error.message, completed_at: new Date().toISOString() }) });
    throw error;
  }
}

// ==================== API HANDLER ====================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { method, url } = req;
  const parsedUrl = new URL(url, `https://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  let body = {};
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) { }
  }

  const sendResponse = (data, status = 200) => res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });
  const sendError = (message, status = 400) => res.status(status).json({ success: false, error: { message, code: status }, timestamp: new Date().toISOString() });

  try {
    if (pathname === '/api/v1/health') return sendResponse({ status: 'ok', version: '2.0.0' });

    // QA & Repair Endpoints
    if (pathname === '/api/v1/qa/deep_run' && method === 'GET') return sendResponse(await runDeepQA());
    if (pathname === '/api/v1/repair/execute' && method === 'POST') {
      const { findingId, token } = body;
      if (!findingId || !token) return sendError('Finding ID and Token required');
      return sendResponse(await executeRepair(findingId, token));
    }

    // Original Endpoints
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const { username, password } = body;
      const users = await supabaseRequest(`admins?username=ilike.${encodeURIComponent(username)}&is_active=eq.true`);
      if (users.length === 0) return sendError('Invalid credentials', 401);
      const user = users[0];
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      if (user.password_hash === passwordHash || user.password_hash === password) {
        return sendResponse({ id: user.id, username: user.username, role: user.role || 'SUPER_ADMIN' });
      }
      return sendError('Invalid credentials', 401);
    }

    if (pathname === '/api/v1/settings' && method === 'GET') return sendResponse(await getSettings());
    if (pathname === '/api/v1/settings' && method === 'PATCH') {
      const { callIntervalSeconds, moveToEndSeconds, examDurationSeconds } = body;
      if (callIntervalSeconds !== undefined) await updateSetting('call_interval_seconds', callIntervalSeconds);
      if (moveToEndSeconds !== undefined) await updateSetting('move_to_end_seconds', moveToEndSeconds);
      if (examDurationSeconds !== undefined) await updateSetting('exam_duration_seconds', examDurationSeconds);
      return sendResponse(await getSettings());
    }

    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const { clinicId, patientId } = body;
      const displayNumber = await getNextDisplayNumber(clinicId);
      const entry = await supabaseRequest('unified_queue', {
        method: 'POST',
        body: JSON.stringify({ clinic_id: clinicId, patient_id: patientId, display_number: displayNumber, status: 'waiting', entered_at: new Date().toISOString(), queue_date: new Date().toISOString().split('T')[0] })
      });
      return sendResponse(entry[0] || entry);
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const clinicId = parsedUrl.searchParams.get('clinicId');
      const patientId = parsedUrl.searchParams.get('patientId');
      const status = await getQueueStatus(clinicId, patientId);
      return status ? sendResponse(status) : sendError('Not in queue', 404);
    }

    return sendError('Endpoint not found', 404);
  } catch (error) {
    console.error('API Error:', error);
    return sendError(error.message, 500);
  }
}
