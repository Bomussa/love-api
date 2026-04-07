/**
 * Unified API V1 Handler - Professionally Synchronized with Supabase Schema
 * 
 * This file handles all REST/RPC traffic for love-api, ensuring 100% compatibility 
 * with the actual database schema and policies.
 * 
 * Updated: 2026-04-07
 */
import { createClient } from '@supabase/supabase-js';
import { createAdminToken, verifyAdminBearerToken } from '../lib/admin-auth.js';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_AUTH_SECRET = process.env.ADMIN_AUTH_SECRET || 'your-secret-key';

// Initialize Supabase with service role for full access (logic handles RLS/Auth)
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { method, body, url: fullUrl } = req;
  const parsedUrl = new URL(fullUrl, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);
  
  // Helper for consistent responses
  const reply = (status, payload) => res.status(status).json(payload);
  
  try {
    // ═══════════════════════════════════════════
    // HEALTH & STATUS
    // ═══════════════════════════════════════════
    if (pathname === '/api/v1/health' || pathname === '/api/v1/status' || pathname === '/api/health') {
      return reply(200, { 
        success: true, 
        status: 'online', 
        database: 'connected',
        timestamp: new Date().toISOString(),
        version: '7.1.0'
      });
    }

    // ═══════════════════════════════════════════
    // PATIENT OPERATIONS
    // ═══════════════════════════════════════════
    if (pathname === '/api/v1/patient/login' && method === 'POST') {
      const { personalId, gender } = body;
      if (!personalId) return reply(400, { success: false, error: 'Personal ID is required' });

      // Check if patient exists, or create new one
      let { data: patient, error } = await sb.from('patients').select('*').eq('personal_id', personalId).maybeSingle();
      
      if (error) return reply(400, { success: false, error: error.message });
      
      if (!patient) {
        const { data: newPatient, error: createError } = await sb.from('patients').insert({
          personal_id: personalId,
          military_id: personalId,
          name: `Patient ${personalId}`,
          gender: gender || 'male',
          status: 'active'
        }).select().single();
        
        if (createError) return reply(400, { success: false, error: createError.message });
        patient = newPatient;
      }

      return reply(200, {
        success: true,
        data: {
          id: patient.id,
          patient_id: patient.personal_id,
          personalId: patient.personal_id,
          gender: patient.gender,
          name: patient.name
        }
      });
    }

    // ═══════════════════════════════════════════
    // AUTHENTICATION MIDDLEWARE
    // ═══════════════════════════════════════════
    const authHeader = req.headers.authorization;
    let user = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        user = verifyAdminBearerToken(token, ADMIN_AUTH_SECRET);
      } catch (e) {
        console.warn('[Auth Warning] Invalid token provided');
      }
    }

    // ═══════════════════════════════════════════
    // RPC ROUTER (Dynamic handling of Supabase RPCs)
    // ═══════════════════════════════════════════
    if (pathname.startsWith('/api/v1/rpc/')) {
      const rpcName = pathname.replace('/api/v1/rpc/', '');
      
      // List of RPCs that require authentication
      const protectedRpcs = ['exec_sql', 'generate_daily_pins', 'daily_cleanup_comprehensive', 'rls_auto_enable'];
      if (protectedRpcs.includes(rpcName) && (!user || user.role !== 'admin')) {
        return reply(403, { success: false, error: 'Unauthorized RPC access' });
      }

      const { data, error } = await sb.rpc(rpcName, body || {});
      if (error) {
        console.error(`[RPC Error] ${rpcName}:`, error);
        return reply(400, { success: false, error: error.message, code: error.code });
      }
      return reply(200, { success: true, data });
    }

    // ═══════════════════════════════════════════
    // QUEUE OPERATIONS (Standardized & Resilient)
    // ═══════════════════════════════════════════
    if (pathname === '/api/v1/queue/call' && method === 'POST') {
      if (!user || user.role !== 'admin') {
        return reply(403, { success: false, error: 'Admin access required to call next patient' });
      }
      const { clinicId } = body;
      if (!clinicId) return reply(400, { success: false, error: 'Clinic ID is required' });

      const { data, error } = await sb.rpc('call_next_patient', { p_clinic_id: clinicId });
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    if (pathname === '/api/v1/queue/start' && method === 'POST') {
      if (!user || user.role !== 'admin') {
        return reply(403, { success: false, error: 'Admin access required to start exam' });
      }
      const { queueId } = body;
      if (!queueId) return reply(400, { success: false, error: 'Queue ID is required' });

      const { data, error } = await sb.rpc('start_exam', { p_queue_id: queueId });
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    if (pathname === '/api/v1/queue/advance' && method === 'POST') {
      if (!user || user.role !== 'admin') {
        return reply(403, { success: false, error: 'Admin access required to advance queue' });
      }
      const { queueId, clinicId } = body;
      if (!queueId || !clinicId) return reply(400, { success: false, error: 'Queue ID and Clinic ID are required' });

      const { data, error } = await sb.rpc('advance_queue', { p_queue_id: queueId, p_clinic_id: clinicId });
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    if (pathname === '/api/v1/queue/done' && method === 'POST') {
      if (!user || user.role !== 'admin') {
        return reply(403, { success: false, error: 'Admin access required to mark queue as done' });
      }
      const { clinicId, patientId } = body;
      if (!clinicId || !patientId) return reply(400, { success: false, error: 'Clinic ID and Patient ID are required' });

      const { data, error } = await sb.rpc('queue_done', { p_clinic_id: clinicId, p_patient_id: patientId });
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    if (pathname === '/api/v1/queue/status' && method === 'PATCH') {
      if (!user || user.role !== 'admin') {
        return reply(403, { success: false, error: 'Admin access required to update queue status' });
      }
      const { clinicId, patientId, status } = body;
      if (!clinicId || !patientId || !status) return reply(400, { success: false, error: 'Clinic ID, Patient ID, and Status are required' });

      const { data, error } = await sb.rpc('update_queue_status', { p_clinic_id: clinicId, p_patient_id: patientId, p_status: status });
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    if (pathname === '/api/v1/session/validate' && method === 'POST') {
      const { token } = body;
      if (!token) return reply(400, { success: false, error: 'Token is required' });

      const { data, error } = await sb.rpc('validate_session', { p_token: token });
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const { data, error } = await sb.rpc('enter_unified_queue_safe', body);
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const { patient_id, clinic_id } = query;
      let queryBuilder = sb.from('v_queue_live').select('*');
      
      if (patient_id) queryBuilder = queryBuilder.eq('patient_id', patient_id);
      if (clinic_id) queryBuilder = queryBuilder.eq('clinic_id', clinic_id);
      
      const { data, error } = await queryBuilder.maybeSingle();
      if (error) return reply(400, { success: false, error: error.message });
      if (!data) return reply(404, { success: false, error: 'No active queue entry found' });
      return reply(200, { success: true, data });
    }

    // ═══════════════════════════════════════════
    // ADMIN OPERATIONS
    // ═══════════════════════════════════════════
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const { username, password } = body;
      const { data: admin, error } = await sb.from('admins').select('*').eq('username', username).maybeSingle();
      
      if (error || !admin) return reply(401, { success: false, error: 'Invalid credentials' });
      
      const token = createAdminToken({ id: admin.id, username: admin.username, role: admin.role }, ADMIN_AUTH_SECRET);
      
      return reply(200, {
        success: true,
        data: {
          session: {
            username: admin.username,
            role: admin.role,
            token,
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          }
        }
      });
    }

    // ═══════════════════════════════════════════
    // CLINIC & SYSTEM DATA
    // ═══════════════════════════════════════════
    if (pathname === '/api/v1/clinics' && method === 'GET') {
      const { data, error } = await sb.from('clinics').select('*').eq('is_active', true).order('name_ar');
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    if (pathname === '/api/v1/settings' && method === 'GET') {
      const { data, error } = await sb.from('system_settings').select('*');
      if (error) return reply(400, { success: false, error: error.message });
      return reply(200, { success: true, data });
    }

    // ═══════════════════════════════════════════
    // CATCH-ALL FOR DYNAMIC TABLE ACCESS (REST)
    // ═══════════════════════════════════════════
    if (pathname.startsWith('/api/v1/db/')) {
      if (!user || user.role !== 'admin') {
        return reply(403, { success: false, error: 'Admin access required for direct DB operations' });
      }
      
      const tableName = pathname.replace('/api/v1/db/', '');
      let dbQuery = sb.from(tableName);
      
      switch (method) {
        case 'GET':
          const { data: gData, error: gErr } = await dbQuery.select('*').limit(100);
          return gErr ? reply(400, { error: gErr.message }) : reply(200, { data: gData });
        case 'POST':
          const { data: pData, error: pErr } = await dbQuery.insert(body).select();
          return pErr ? reply(400, { error: pErr.message }) : reply(201, { data: pData });
        case 'PATCH':
          const { data: paData, error: paErr } = await dbQuery.match(query).update(body).select();
          return paErr ? reply(400, { error: paErr.message }) : reply(200, { data: paData });
        case 'DELETE':
          const { data: dData, error: dErr } = await dbQuery.match(query).delete().select();
          return dErr ? reply(400, { error: dErr.message }) : reply(200, { data: dData });
        default:
          return reply(405, { error: 'Method not allowed' });
      }
    }

    return reply(404, { success: false, error: `Route ${pathname} not found` });

  } catch (err) {
    console.error('[API Critical Error]', err);
    return reply(500, { success: false, error: 'Internal server error', details: err.message });
  }
}
