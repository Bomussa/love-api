import crypto from 'crypto';

// ==================== CONFIGURATION ====================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_SECRET;
const REPAIR_TOKEN = process.env.QA_REPAIR_TOKEN || 'mmc-mms-repair-secret-2026';

// ==================== UTILITIES ====================
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
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(`Supabase Error: ${JSON.stringify(error)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function generateFingerprint(type, description, metadata = {}) {
  const content = `${type}-${description}-${JSON.stringify(metadata)}`;
  return crypto.createHash('md5').update(content).digest('hex');
}

// ==================== DEEP QA LOGIC ====================
export async function runDeepQA() {
  const startTime = Date.now();
  const run = await supabaseRequest('qa_runs', {
    method: 'POST',
    body: JSON.stringify({ status: 'running', created_at: new Date().toISOString() })
  });
  const runId = run[0].id;
  const findings = [];
  const stats = { clinics_checked: 0, total_findings: 0, contracts_checked: 0 };

  try {
    // 1. Clinic & Route Check
    const clinics = await supabaseRequest('clinics?is_active=eq.true');
    stats.clinics_checked = clinics.length;
    
    for (const clinic of clinics) {
      // Check if route exists for each clinic (in clinics table itself)
      if (!clinic.id) {
        findings.push({
          run_id: runId,
          type: 'DATA_INVARIANT_BROKEN',
          severity: 'critical',
          description: `Clinic ${clinic.name_ar || 'Unknown'} has no ID`,
          fingerprint: generateFingerprint('DATA_INVARIANT_BROKEN', `clinic-no-id-${clinic.name_ar}`),
          metadata: { clinic_id: clinic.id }
        });
      }
    }

    // 2. Settings Drift Check
    const expectedSettings = ['call_interval_seconds', 'move_to_end_seconds', 'exam_duration_seconds'];
    const actualSettings = await supabaseRequest('settings');
    const actualKeys = actualSettings.map(s => s.key);
    for (const key of expectedSettings) {
      if (!actualKeys.includes(key)) {
        findings.push({
          run_id: runId,
          type: 'SETTINGS_DRIFT',
          severity: 'high',
          description: `Missing critical setting: ${key}`,
          fingerprint: generateFingerprint('SETTINGS_DRIFT', `missing-setting-${key}`),
          metadata: { key }
        });
      }
    }

    // 3. Contract Sanity (Basic)
    const endpoints = [
      { path: 'clinics', method: 'GET' },
      { path: 'settings', method: 'GET' },
      { path: 'unified_queue', method: 'GET', params: 'limit=1' }
    ];
    for (const ep of endpoints) {
      try {
        const t0 = Date.now();
        const data = await supabaseRequest(`${ep.path}${ep.params ? '?' + ep.params : ''}`);
        const latency = Date.now() - t0;
        stats.contracts_checked++;
        
        // Simple hash of keys to detect schema drift
        const keys = data.length > 0 ? Object.keys(data[0]).sort().join(',') : '';
        const shapeHash = crypto.createHash('md5').update(keys).digest('hex');
        
        // Check against canonical
        const canonical = await supabaseRequest(`contract_snapshots?endpoint=eq.${ep.path}&method=eq.${ep.method}&is_canonical=eq.true`);
        if (canonical.length > 0 && canonical[0].shape_hash !== shapeHash) {
          findings.push({
            run_id: runId,
            type: 'CONTRACT_DRIFT',
            severity: 'medium',
            description: `Contract drift detected on ${ep.path}`,
            fingerprint: generateFingerprint('CONTRACT_DRIFT', `drift-${ep.path}`),
            metadata: { endpoint: ep.path, expected: canonical[0].shape_hash, actual: shapeHash }
          });
        } else if (canonical.length === 0 && keys) {
          // Store first time as canonical
          await supabaseRequest('contract_snapshots', {
            method: 'POST',
            body: JSON.stringify({ endpoint: ep.path, method: ep.method, shape_hash: shapeHash, is_canonical: true })
          });
        }
      } catch (e) {
        findings.push({
          run_id: runId,
          type: 'CONTRACT_DRIFT',
          severity: 'critical',
          description: `Endpoint ${ep.path} failed: ${e.message}`,
          fingerprint: generateFingerprint('CONTRACT_DRIFT', `fail-${ep.path}`),
          metadata: { endpoint: ep.path, error: e.message }
        });
      }
    }

    // 4. Performance Check
    const totalLatency = Date.now() - startTime;
    if (totalLatency > 5000) { // Threshold 5s for deep run
      findings.push({
        run_id: runId,
        type: 'PERFORMANCE_REGRESSION',
        severity: 'low',
        description: `Deep QA run took ${totalLatency}ms`,
        fingerprint: generateFingerprint('PERFORMANCE_REGRESSION', 'slow-deep-run'),
        metadata: { latency: totalLatency }
      });
    }

    // Save findings
    if (findings.length > 0) {
      await supabaseRequest('qa_findings', {
        method: 'POST',
        body: JSON.stringify(findings)
      });
    }

    stats.total_findings = findings.length;
    const ok = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length === 0;

    // Update run
    await supabaseRequest(`qa_runs?id=eq.${runId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'completed',
        ok,
        stats,
        performance: { duration_ms: Date.now() - startTime },
        completed_at: new Date().toISOString()
      })
    });

    return { run_id: runId, ok, stats, findings };
  } catch (error) {
    await supabaseRequest(`qa_runs?id=eq.${runId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', completed_at: new Date().toISOString() })
    });
    throw error;
  }
}

// ==================== REPAIR LOGIC ====================
export async function executeRepair(findingId, token) {
  if (token !== REPAIR_TOKEN) throw new Error('Unauthorized repair attempt');

  const finding = await supabaseRequest(`qa_findings?id=eq.${findingId}`);
  if (finding.length === 0) throw new Error('Finding not found');
  
  const f = finding[0];
  const repairRun = await supabaseRequest('repair_runs', {
    method: 'POST',
    body: JSON.stringify({
      run_id: f.run_id,
      finding_id: f.id,
      playbook: f.type,
      status: 'in_progress'
    })
  });
  const repairId = repairRun[0].id;

  let success = false;
  let logs = '';

  try {
    switch (f.type) {
      case 'SETTINGS_DRIFT':
        // Sync missing settings
        const key = f.metadata.key;
        const defaults = {
          call_interval_seconds: '120',
          move_to_end_seconds: '240',
          exam_duration_seconds: '300'
        };
        if (defaults[key]) {
          await supabaseRequest('settings', {
            method: 'POST',
            body: JSON.stringify({ key, value: defaults[key], category: 'queue' })
          });
          success = true;
          logs = `Successfully restored default for ${key}`;
        }
        break;
      
      case 'CONTRACT_DRIFT':
        // If it's a known drift we can't auto-fix schema, but we can update the canonical if requested
        logs = 'Contract drift requires manual review of schema changes. No auto-fix applied.';
        break;

      default:
        logs = `No safe playbook defined for ${f.type}`;
    }

    await supabaseRequest(`repair_runs?id=eq.${repairId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: success ? 'success' : 'failed',
        logs,
        completed_at: new Date().toISOString()
      })
    });

    if (success) {
      await supabaseRequest(`qa_findings?id=eq.${f.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_resolved: true, resolved_at: new Date().toISOString(), repair_run_id: repairId })
      });
    }

    return { success, logs };
  } catch (error) {
    await supabaseRequest(`repair_runs?id=eq.${repairId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', logs: error.message, completed_at: new Date().toISOString() })
    });
    throw error;
  }
}
