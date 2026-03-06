import crypto from 'crypto';

// ==================== CONFIGURATION ====================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_SECRET || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs';
const REPAIR_TOKEN = process.env.QA_REPAIR_TOKEN || 'repair-master-2026';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('⚠️ WARNING: Missing required environment variables - using defaults');
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
  
  try {
    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`Supabase Error (${response.status}): ${JSON.stringify(error)}`);
    }
    
    const text = await response.text();
    return text ? JSON.parse(text) : [];
  } catch (error) {
    console.error(`Supabase Request Error for ${path}:`, error.message);
    throw error;
  }
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
      findings.push({ 
        type: 'CONNECTIVITY', 
        severity: 'critical', 
        description: 'Cannot connect to Supabase', 
        error: e.message 
      });
      stats.failures++;
    }
    
    // 2. Check Schema Invariants (Critical Tables)
    // Fixed: Using correct table names from Supabase schema
    const tables = ['settings', 'clinics', 'unified_queue', 'admins'];
    for (const table of tables) {
      stats.checks++;
      try {
        await supabaseRequest(`${table}?limit=1`);
      } catch (e) {
        findings.push({ 
          type: 'SCHEMA_MISSING', 
          severity: 'critical', 
          table, 
          description: `Table ${table} is missing or inaccessible`,
          error: e.message
        });
        stats.failures++;
      }
    }
    
    // 3. Check Critical Settings
    try {
      const settings = await supabaseRequest('settings');
      const requiredSettings = ['call_interval_seconds', 'move_to_end_seconds', 'exam_duration_seconds'];
      const keys = settings.map(s => s.key || s.id);
      
      for (const key of requiredSettings) {
        stats.checks++;
        if (!keys.includes(key)) {
          findings.push({ 
            type: 'SETTING_MISSING', 
            severity: 'high', 
            key, 
            description: `Critical setting ${key} is missing`, 
            repairable: true 
          });
          stats.failures++;
          stats.repairs_possible++;
        }
      }
    } catch (e) {
      findings.push({
        type: 'SETTINGS_CHECK_FAILED',
        severity: 'high',
        description: 'Failed to check critical settings',
        error: e.message
      });
      stats.failures++;
    }
    
    const duration = Date.now() - startTime;
    const successRate = Math.max(0, 100 - (stats.failures * 20));
    
    return {
      success: findings.length === 0,
      score: successRate,
      stats,
      findings,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message, 
      timestamp: new Date().toISOString() 
    };
  }
}

// ==================== API HANDLER ====================
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  // Handle OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { method, url } = req;
  const parsedUrl = new URL(url, `https://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  
  try {
    // 1. Health Check
    if (pathname === '/api/v1/health' || pathname === '/api/health') {
      return res.status(200).json({ 
        status: 'ok', 
        version: '3.0.0-resilient',
        timestamp: new Date().toISOString()
      });
    }
    
    // 2. Deep QA Run
    if (pathname === '/api/v1/qa/deep_run') {
      const result = await runDeepQA();
      return res.status(result.success ? 200 : 500).json(result);
    }
    
    // 3. Admin Login (Fixed: Using 'admins' table instead of 'admin_users')
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { username, password } = body;
        
        if (!username || !password) {
          return res.status(400).json({ 
            success: false, 
            error: 'Username and password are required' 
          });
        }
        
        // Query the correct table: 'admins'
        const users = await supabaseRequest(`admins?username=eq.${encodeURIComponent(username)}&is_active=eq.true`);
        
        if (users.length === 0) {
          return res.status(401).json({ 
            success: false, 
            error: 'Invalid credentials' 
          });
        }
        
        const user = users[0];
        const passwordHash = crypto.createHash('sha256').update(password + 'mmc-salt-2026').digest('hex');
        
        if (user.password_hash === passwordHash || user.password_hash === password) {
          return res.status(200).json({ 
            success: true, 
            data: { 
              id: user.id, 
              username: user.username, 
              role: user.role,
              full_name: user.full_name,
              email: user.email
            } 
          });
        }
        
        return res.status(401).json({ 
          success: false, 
          error: 'Invalid credentials' 
        });
      } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({ 
          success: false, 
          error: 'Login failed: ' + error.message 
        });
      }
    }
    
    // 4. Queue Operations
    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { clinicId, patientId } = body;
        
        if (!clinicId) {
          return res.status(400).json({ 
            success: false, 
            error: 'clinicId is required' 
          });
        }
        
        const entry = await supabaseRequest('unified_queue', {
          method: 'POST',
          body: JSON.stringify({ 
            clinic_id: clinicId, 
            patient_id: patientId || 'anonymous', 
            status: 'waiting', 
            entered_at: new Date().toISOString(),
            queue_date: new Date().toISOString().split('T')[0]
          })
        });
        
        return res.status(200).json({ 
          success: true, 
          data: entry[0] || entry 
        });
      } catch (error) {
        console.error('Queue enter error:', error);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to enter queue: ' + error.message 
        });
      }
    }
    
    // 5. Get Queue Status
    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      try {
        const clinicId = parsedUrl.searchParams.get('clinicId');
        
        if (!clinicId) {
          return res.status(400).json({ 
            success: false, 
            error: 'clinicId is required' 
          });
        }
        
        const queue = await supabaseRequest(`unified_queue?clinic_id=eq.${encodeURIComponent(clinicId)}&status=neq.done`);
        
        return res.status(200).json({ 
          success: true, 
          data: {
            total: queue.length,
            waiting: queue.filter(q => q.status === 'waiting').length,
            your_turn: queue.filter(q => q.status === 'your_turn').length,
            done: 0
          }
        });
      } catch (error) {
        console.error('Queue status error:', error);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to get queue status: ' + error.message 
        });
      }
    }
    
    // 6. Get Clinics
    if (pathname === '/api/v1/clinics' && method === 'GET') {
      try {
        const clinics = await supabaseRequest('clinics?limit=100');
        
        return res.status(200).json({ 
          success: true, 
          data: clinics 
        });
      } catch (error) {
        console.error('Get clinics error:', error);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to get clinics: ' + error.message 
        });
      }
    }
    
    // Default: Not Found
    return res.status(404).json({ 
      success: false, 
      error: 'Endpoint not found',
      path: pathname,
      method: method
    });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
