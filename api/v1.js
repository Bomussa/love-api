import crypto from 'crypto';

// ==================== CONFIGURATION ====================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_SECRET;
const REPAIR_TOKEN = process.env.QA_REPAIR_TOKEN || 'repair-master-2026';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: Missing required environment variables');
}

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

// ==================== DEEP QA & REPAIR LOGIC ====================
async function runDeepQA() {
  const startTime = Date.now();
  const findings = [];
  const stats = { checks: 0, failures: 0, repairs_possible: 0 };

  try {
    // 1. Check Connectivity
    stats.checks++;
    try {
      await supabaseRequest('settings?limit=1');
    } catch (e) {
      findings.push({ type: 'CONNECTIVITY', severity: 'critical', description: 'Cannot connect to Supabase', error: e.message });
      stats.failures++;
    }

    // 2. Check Schema Invariants (Critical Tables)
    const tables = ['settings', 'clinics', 'unified_queue', 'admin_users'];
    for (const table of tables) {
      stats.checks++;
      try {
        await supabaseRequest(`${table}?limit=1`);
      } catch (e) {
        findings.push({ type: 'SCHEMA_MISSING', severity: 'critical', table, description: `Table ${table} is missing or inaccessible` });
        stats.failures++;
      }
    }

    // 3. Check Critical Settings
    const requiredSettings = ['call_interval_seconds', 'move_to_end_seconds', 'exam_duration_seconds'];
    const settings = await supabaseRequest('settings');
    const keys = settings.map(s => s.key);
    for (const key of requiredSettings) {
      stats.checks++;
      if (!keys.includes(key)) {
        findings.push({ type: 'SETTING_MISSING', severity: 'high', key, description: `Critical setting ${key} is missing`, repairable: true });
        stats.failures++;
        stats.repairs_possible++;
      }
    }

    const duration = Date.now() - startTime;
    return {
      success: findings.length === 0,
      score: Math.max(0, 100 - (stats.failures * 20)),
      stats,
      findings,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return { success: false, error: error.message, timestamp: new Date().toISOString() };
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

  try {
    // 1. Health & Deep QA
    if (pathname === '/api/v1/health') {
      return res.status(200).json({ status: 'ok', version: '3.0.0-resilient' });
    }

    if (pathname === '/api/v1/qa/deep_run') {
      const result = await runDeepQA();
      return res.status(200).json(result);
    }

    // 2. Admin Login
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { username, password } = body;
      const users = await supabaseRequest(`admin_users?username=eq.${username}&is_active=eq.true`);
      if (users.length === 0) return res.status(401).json({ success: false, error: 'Invalid credentials' });
      
      const user = users[0];
      const passwordHash = crypto.createHash('sha256').update(password + 'mmc-salt-2026').digest('hex');
      if (user.password_hash === passwordHash || user.password_hash === password) {
        return res.status(200).json({ success: true, data: { id: user.id, username: user.username, role: user.role } });
      }
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // 3. Queue Operations
    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { clinicId, patientId } = body;
      const entry = await supabaseRequest('unified_queue', {
        method: 'POST',
        body: JSON.stringify({ 
          clinic_id: clinicId, 
          patient_id: patientId, 
          status: 'waiting', 
          entered_at: new Date().toISOString(),
          queue_date: new Date().toISOString().split('T')[0]
        })
      });
      return res.status(200).json({ success: true, data: entry[0] });
    }

    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
