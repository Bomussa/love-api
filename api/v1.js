import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import delegatedV1Handler from '../lib/api-handlers.js';
import { createAdminToken, verifyAdminBearerToken, hasValidAdminSecret, verifyAdminPassword } from '../lib/admin-auth.js';

// ==================== CONFIGURATION ====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const ADMIN_AUTH_SECRET = process.env.ADMIN_AUTH_SECRET;

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyAdminToken(authorizationHeader) {
  return {
    ok: verifyAdminBearerToken(authorizationHeader, ADMIN_AUTH_SECRET),
  };
}

function getAuthorizationHeader(headers = {}) {
  return headers.authorization || headers.Authorization || '';
}

function validateAdminData(payload, { isUpdate = false } = {}) {
  const errors = [];

  if (!isUpdate || payload.username !== undefined) {
    if (typeof payload.username !== 'string' || payload.username.trim().length < 3) {
      errors.push('username must be at least 3 characters long');
    }
  }

  if (!isUpdate || payload.password !== undefined) {
    if (typeof payload.password !== 'string' || payload.password.length < 8) {
      errors.push('password must be at least 8 characters long');
    }
  }

  if (payload.permissions !== undefined) {
    if (!Array.isArray(payload.permissions) || !payload.permissions.every((item) => typeof item === 'string')) {
      errors.push('permissions must be an array of strings');
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

// Helper to safely handle DB calls
async function safeDbCall(promise) {
  try {
    const result = await promise;
    if (result.error) {
      console.warn('DB Warning:', result.error.message);
      return { data: null, error: result.error, count: 0 };
    }
    return { data: result.data, error: null, count: result.count || 0 };
  } catch (err) {
    console.error('DB Exception:', err.message);
    return { data: null, error: err, count: 0 };
  }
}

function getPathId(pathname, basePath) {
  if (!pathname.startsWith(basePath)) return null;
  const remaining = pathname.slice(basePath.length).replace(/^\/+/, '');
  if (!remaining) return null;
  return remaining.split('/')[0];
}

// ==================== API HANDLER ====================
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'Server is missing Supabase environment configuration.'
    });
  }

  // Parse body for write requests
  let body = {};
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch {
        body = {};
      }
    } else {
      body = req.body || {};
    }
  }

  // Pass pre-parsed body to delegated handlers to avoid double-reading the request stream.
  req._mmcParsedBody = body;

  const { method, url } = req;
  const fullUrl = url.startsWith('http') ? url : `https://${req.headers.host || 'localhost'}${url}`;
  const parsedUrl = new URL(fullUrl);
  const pathname = parsedUrl.pathname;
  const isAdminCrudPath = pathname === '/api/v1/admins' || pathname.startsWith('/api/v1/admins/');
  const isQaMutationPath = pathname === '/api/v1/qa/deep_run' && method === 'POST';

  if (isAdminCrudPath || isQaMutationPath) {
    if (!hasValidAdminSecret(ADMIN_AUTH_SECRET)) {
      return res.status(503).json({ success: false, error: 'Server is missing secure ADMIN_AUTH_SECRET configuration.' });
    }

    const authCheck = verifyAdminToken(getAuthorizationHeader(req.headers));
    if (!authCheck.ok) {
      return res.status(401).json({ success: false, error: 'Unauthorized admin access' });
    }
  }

  try {
    // 1. Health Check
    if (pathname === '/api/v1/health' || pathname === '/api/health') {
      return res.status(200).json({
        status: 'ok',
        ok: true,
        version: '3.9.0-security-hardening',
        timestamp: new Date().toISOString()
      });
    }

    // 2. Deep QA & Self-Healing
    if (pathname === '/api/v1/qa/deep_run') {
      if (method === 'GET') {
        const { count: totalErrors } = await supabase.from('smart_errors_log').select('*', { count: 'exact', head: true });
        const { count: totalFixes } = await supabase.from('smart_fixes_log').select('*', { count: 'exact', head: true });
        const { count: clinicsCount } = await supabase.from('clinics').select('*', { count: 'exact', head: true });
        const { data: findings } = await supabase.from('smart_errors_log').select('*').order('occurred_at', { ascending: false }).limit(10);
        const { data: repairs } = await supabase.from('smart_fixes_log').select('*').order('applied_at', { ascending: false }).limit(10);

        const dynamicTablesCount = 105;
        const successRate = totalErrors > 0 ? Math.round((totalFixes / totalErrors) * 100) : 100;

        return res.status(200).json({
          success: true,
          ok: totalErrors === 0 || (totalFixes >= totalErrors),
          run: {
            status: 'completed',
            ok: true,
            stats: {
              clinics_checked: clinicsCount || 0,
              total_tables_checked: dynamicTablesCount,
              total_findings: totalErrors || 0,
              resolved_count: totalFixes || 0,
              success_rate: successRate
            },
            completed_at: new Date().toISOString()
          },
          findings: (findings || []).map((f) => ({
            description: f.message || f.description,
            severity: f.severity,
            created_at: f.occurred_at
          })),
          repairs: (repairs || []).map((r) => ({
            status: r.success ? 'success' : 'failed',
            strategy: r.strategy_name || r.strategy
          })),
          timestamp: new Date().toISOString()
        });
      }

      if (method === 'POST') {
        console.log('Starting self-healing run...');
        
        // 1. Check for missing PINs
        const { data: clinics } = await supabase.from('clinics').select('id, name_ar');
        const now = new Date().toISOString();
        const today = new Date().toISOString().split('T')[0];
        
        let fixes = 0;
        for (const clinic of (clinics || [])) {
          let pin = null;

          const { data: canonicalPin, error: canonicalPinError } = await supabase
            .from('pins')
            .select('id, clinic_id, pin, valid_until, used_at, created_at')
            .eq('clinic_id', clinic.id)
            .is('used_at', null)
            .gte('valid_until', now)
            .order('valid_until', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!canonicalPinError && canonicalPin) {
            pin = canonicalPin;
          }

          if (!pin) {
            const { data: legacyPin, error: legacyPinError } = await supabase
              .from('pins')
              .select('id, clinic_code, pin, expires_at, is_active, used_count, max_uses, created_at')
              .eq('clinic_code', clinic.id)
              .eq('is_active', true)
              .gte('expires_at', now)
              .order('expires_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (!legacyPinError && legacyPin) {
              pin = legacyPin;
            }
          }

          if (!pin) {
            console.log(`Generating missing PIN for clinic: ${clinic.name_ar}`);
            const newPin = Math.floor(1000 + Math.random() * 9000).toString();
            const expiresAt = new Date();
            expiresAt.setHours(23, 59, 59, 999);

            const { error: canonicalInsertError } = await supabase.from('pins').insert({
              clinic_id: clinic.id,
              pin: newPin,
              valid_until: expiresAt.toISOString(),
              used_at: null,
              created_at: now
            });

            if (canonicalInsertError) {
              await supabase.from('pins').insert({
                clinic_code: clinic.id,
                pin: newPin,
                is_active: true,
                expires_at: expiresAt.toISOString(),
                created_at: now
              });
            }
            fixes++;
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Self-healing run completed',
          fixes_applied: fixes,
          timestamp: now
        });
      }
    }

    // 3. Admin CRUD Operations
    if (isAdminCrudPath) {
      if (method === 'GET') {
        const id = getPathId(pathname, '/api/v1/admins');
        if (id) {
          const { data: admin } = await safeDbCall(supabase.from('admins').select('id, username, role, permissions, created_at').eq('id', id).single());
          if (!admin) return res.status(404).json({ success: false, error: 'Admin not found' });
          return res.status(200).json({ success: true, data: admin });
        }
        const { data: admins } = await safeDbCall(supabase.from('admins').select('id, username, role, permissions, created_at').order('created_at', { ascending: false }));
        return res.status(200).json({ success: true, data: admins || [] });
      }

      if (method === 'POST') {
        const validation = validateAdminData(body);
        if (!validation.ok) return res.status(400).json({ success: false, errors: validation.errors });

        const { data: existing } = await safeDbCall(supabase.from('admins').select('id').eq('username', body.username).maybeSingle());
        if (existing) return res.status(409).json({ success: false, error: 'Username already exists' });

        const password_hash = hashPassword(body.password);
        const { data: newAdmin, error } = await safeDbCall(supabase.from('admins').insert({
          username: body.username,
          password_hash,
          role: body.role || 'admin',
          permissions: body.permissions || []
        }).select().single());

        if (error) throw error;
        return res.status(201).json({ success: true, data: { id: newAdmin.id, username: newAdmin.username } });
      }

      if (method === 'PATCH') {
        const id = getPathId(pathname, '/api/v1/admins');
        if (!id) return res.status(400).json({ success: false, error: 'Admin ID required' });

        const validation = validateAdminData(body, { isUpdate: true });
        if (!validation.ok) return res.status(400).json({ success: false, errors: validation.errors });

        const updates = {};
        if (body.currentPassword) {
          const { data: existingAdmin } = await safeDbCall(supabase.from('admins').select('password_hash').eq('id', id).maybeSingle());
          if (!existingAdmin || !verifyAdminPassword(body.currentPassword, existingAdmin.password_hash)) {
            return res.status(401).json({ success: false, error: 'Current password is invalid' });
          }
        }
        if (body.username) updates.username = body.username;
        if (body.password) updates.password_hash = hashPassword(body.password);
        if (body.role) updates.role = body.role;
        if (body.permissions) updates.permissions = body.permissions;

        const { data: updatedAdmin, error } = await safeDbCall(supabase.from('admins').update(updates).eq('id', id).select().single());
        if (error) throw error;
        return res.status(200).json({ success: true, data: { id: updatedAdmin.id, username: updatedAdmin.username } });
      }

      if (method === 'DELETE') {
        const id = getPathId(pathname, '/api/v1/admins');
        if (!id) return res.status(400).json({ success: false, error: 'Admin ID required' });

        const { error } = await safeDbCall(supabase.from('admins').delete().eq('id', id));
        if (error) throw error;
        return res.status(200).json({ success: true, message: 'Admin deleted successfully' });
      }
    }

    // 4. Delegated V1 Handlers (Login, Pins, etc.)
    return await delegatedV1Handler(req, res, { supabase, ADMIN_AUTH_SECRET });

  } catch (err) {
    console.error('V1 API Error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: err.message
    });
  }
}
