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
    'Prefer': options.method === 'POST' ? 'return=representation' : 
              options.method === 'PATCH' ? 'return=representation' :
              options.method === 'DELETE' ? 'return=representation' : ''
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Supabase Error: ${JSON.stringify(error)}`);
  }
  
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

// دالة مساعدة لاستدعاء RPC functions في Supabase
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
    const error = await response.json();
    throw new Error(`Supabase RPC Error: ${JSON.stringify(error)}`);
  }

  return await response.json();
}

// ==================== BUSINESS LOGIC ====================
function generateDailyPIN(clinicId) {
  const today = new Date().toISOString().split('T')[0];
  const secret = process.env.PIN_SECRET || 'mmc-mms-secret-2026';
  const hash = crypto.createHmac('sha256', secret).update(`${clinicId}-${today}`).digest('hex');
  // PIN من رقمين فقط (10-99) ويتغير يومياً تلقائياً
  return (parseInt(hash.substring(0, 8), 16) % 90 + 10).toString();
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

// ==================== SETTINGS HELPERS ====================
async function getSettings() {
  try {
    const data = await supabaseRequest('settings?order=key.asc');
    const settings = {};
    data.forEach(s => {
      settings[s.key] = s.value;
    });
    return {
      callIntervalSeconds: parseInt(settings.call_interval_seconds) || 120,
      moveToEndSeconds: parseInt(settings.move_to_end_seconds) || 240,
      examDurationSeconds: parseInt(settings.exam_duration_seconds) || 300,
      autoCallEnabled: settings.auto_call_enabled === 'true',
      soundEnabled: settings.sound_enabled === 'true',
      notificationsEnabled: settings.notifications_enabled === 'true'
    };
  } catch (error) {
    return {
      callIntervalSeconds: 120,
      moveToEndSeconds: 240,
      examDurationSeconds: 300,
      autoCallEnabled: false,
      soundEnabled: true,
      notificationsEnabled: true
    };
  }
}

async function updateSetting(key, value) {
  try {
    // Check if setting exists
    const existing = await supabaseRequest(`settings?key=eq.${key}`);
    if (existing.length > 0) {
      const updated = await supabaseRequest(`settings?key=eq.${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value: value.toString(), updated_at: new Date().toISOString() })
      });
      return updated;
    } else {
      // Create new setting
      const created = await supabaseRequest('settings', {
        method: 'POST',
        body: JSON.stringify({ 
          key, 
          value: value.toString(), 
          category: 'queue',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      });
      return created;
    }
  } catch (error) {
    console.error('Error updating setting:', error);
    throw error;
  }
}

// ==================== ADMIN AUTH ====================
async function validateAdminCredentials(username, password) {
  try {
    const users = await supabaseRequest(`admin_users?username=eq.${username}&is_active=eq.true`);
    if (users.length === 0) return null;
    
    const user = users[0];
    // Simple password check (in production, use bcrypt)
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    if (user.password_hash === passwordHash || user.password_hash === password) {
      // Update last login
      await supabaseRequest(`admin_users?id=eq.${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_login: new Date().toISOString() })
      });
      return {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        permissions: user.permissions
      };
    }
    return null;
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

// ==================== API HANDLER ====================
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method, url } = req;
  const parsedUrl = new URL(url, `https://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  
  let body = {};
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (e) { /* ignore */ }
  }

  const sendResponse = (data, status = 200) => res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });
  const sendError = (message, status = 400) => res.status(status).json({ success: false, error: { message, code: status }, timestamp: new Date().toISOString() });

  try {
    // ==================== HEALTH CHECK ====================
    if (pathname === '/api/v1/health') return sendResponse({ status: 'ok', version: '2.0.0' });

    // ==================== ADMIN AUTH ====================
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const { username, password } = body;
      if (!username || !password) return sendError('Username and password required');
      
      const user = await validateAdminCredentials(username, password);
      if (!user) return sendError('Invalid credentials', 401);
      
      return sendResponse(user);
    }

    // ==================== ADMIN USERS MANAGEMENT ====================
    // Get all admin users
    if (pathname === '/api/v1/admin/users' && method === 'GET') {
      const users = await supabaseRequest('admin_users?order=created_at.desc');
      const safeUsers = users.map(u => ({
        id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        permissions: u.permissions,
        is_active: u.is_active,
        last_login: u.last_login,
        created_at: u.created_at
      }));
      return sendResponse(safeUsers);
    }

    // Create admin user
    if (pathname === '/api/v1/admin/users' && method === 'POST') {
      const { username, password, full_name, role, permissions } = body;
      if (!username || !password || !full_name) return sendError('Username, password and full name required');
      
      // Check if username exists
      const existing = await supabaseRequest(`admin_users?username=eq.${username}`);
      if (existing.length > 0) return sendError('Username already exists');
      
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      const newUser = await supabaseRequest('admin_users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password_hash: passwordHash,
          full_name,
          role: role || 'viewer',
          permissions: permissions || { view: true, edit: false, delete: false, admin: false },
          is_active: true,
          created_at: new Date().toISOString()
        })
      });
      
      return sendResponse({
        id: newUser[0].id,
        username: newUser[0].username,
        full_name: newUser[0].full_name,
        role: newUser[0].role,
        permissions: newUser[0].permissions
      });
    }

    // Update admin user
    if (pathname.match(/^\/api\/v1\/admin\/users\/\d+$/) && method === 'PATCH') {
      const userId = pathname.split('/').pop();
      const { full_name, role, permissions, is_active, password } = body;
      
      const updateData = { updated_at: new Date().toISOString() };
      if (full_name !== undefined) updateData.full_name = full_name;
      if (role !== undefined) updateData.role = role;
      if (permissions !== undefined) updateData.permissions = permissions;
      if (is_active !== undefined) updateData.is_active = is_active;
      if (password) updateData.password_hash = crypto.createHash('sha256').update(password).digest('hex');
      
      const updated = await supabaseRequest(`admin_users?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData)
      });
      
      return sendResponse(updated[0] || { id: userId, ...updateData });
    }

    // Delete admin user
    if (pathname.match(/^\/api\/v1\/admin\/users\/\d+$/) && method === 'DELETE') {
      const userId = pathname.split('/').pop();
      await supabaseRequest(`admin_users?id=eq.${userId}`, { method: 'DELETE' });
      return sendResponse({ deleted: true, id: userId });
    }

    // ==================== CLINICS MANAGEMENT ====================
    // Get all clinics
    if (pathname === '/api/v1/admin/clinics' && method === 'GET') {
      const clinics = await supabaseRequest('clinics?order=sort_order.asc,name_ar.asc');
      return sendResponse(clinics);
    }

    // Create clinic
    if (pathname === '/api/v1/admin/clinics' && method === 'POST') {
      const { name_ar, name_en, floor_ar, floor_en, is_active, sort_order, exam_types } = body;
      if (!name_ar) return sendError('Arabic name required');
      
      const newClinic = await supabaseRequest('clinics', {
        method: 'POST',
        body: JSON.stringify({
          name_ar,
          name_en: name_en || name_ar,
          floor_ar: floor_ar || 'الدور الأرضي',
          floor_en: floor_en || 'Ground Floor',
          is_active: is_active !== false,
          sort_order: sort_order || 0,
          exam_types: exam_types || [],
          created_at: new Date().toISOString()
        })
      });
      
      return sendResponse(newClinic[0]);
    }

    // Update clinic
    if (pathname.match(/^\/api\/v1\/admin\/clinics\/[\w-]+$/) && method === 'PATCH') {
      const clinicId = pathname.split('/').pop();
      const { name_ar, name_en, floor_ar, floor_en, is_active, sort_order, exam_types } = body;
      
      const updateData = { updated_at: new Date().toISOString() };
      if (name_ar !== undefined) updateData.name_ar = name_ar;
      if (name_en !== undefined) updateData.name_en = name_en;
      if (floor_ar !== undefined) updateData.floor_ar = floor_ar;
      if (floor_en !== undefined) updateData.floor_en = floor_en;
      if (is_active !== undefined) updateData.is_active = is_active;
      if (sort_order !== undefined) updateData.sort_order = sort_order;
      if (exam_types !== undefined) updateData.exam_types = exam_types;
      
      const updated = await supabaseRequest(`clinics?id=eq.${clinicId}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData)
      });
      
      return sendResponse(updated[0] || { id: clinicId, ...updateData });
    }

    // Delete clinic
    if (pathname.match(/^\/api\/v1\/admin\/clinics\/[\w-]+$/) && method === 'DELETE') {
      const clinicId = pathname.split('/').pop();
      await supabaseRequest(`clinics?id=eq.${clinicId}`, { method: 'DELETE' });
      return sendResponse({ deleted: true, id: clinicId });
    }

    // ==================== QUEUE MANAGEMENT (ADMIN) ====================
    // Get all queues for today
    if (pathname === '/api/v1/admin/queues' && method === 'GET') {
      const clinicId = parsedUrl.searchParams.get('clinicId');
      const status = parsedUrl.searchParams.get('status');
      const today = new Date().toISOString().split('T')[0];
      
      let query = `queues?entered_at=gte.${today}T00:00:00&order=entered_at.asc`;
      if (clinicId) query += `&clinic_id=eq.${clinicId}`;
      if (status) query += `&status=eq.${status}`;
      
      const queues = await supabaseRequest(query);
      return sendResponse(queues);
    }

    // Update queue entry
    if (pathname.match(/^\/api\/v1\/admin\/queues\/\d+$/) && method === 'PATCH') {
      const queueId = pathname.split('/').pop();
      const { status, display_number } = body;
      
      const updateData = { updated_at: new Date().toISOString() };
      if (status !== undefined) {
        updateData.status = status;
        if (status === 'serving') updateData.called_at = new Date().toISOString();
        if (status === 'completed') updateData.completed_at = new Date().toISOString();
      }
      if (display_number !== undefined) updateData.display_number = display_number;
      
      const updated = await supabaseRequest(`queues?id=eq.${queueId}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData)
      });
      
      return sendResponse(updated[0] || { id: queueId, ...updateData });
    }

    // Delete queue entry
    if (pathname.match(/^\/api\/v1\/admin\/queues\/\d+$/) && method === 'DELETE') {
      const queueId = pathname.split('/').pop();
      await supabaseRequest(`queues?id=eq.${queueId}`, { method: 'DELETE' });
      return sendResponse({ deleted: true, id: queueId });
    }

    // Move patient to end of queue
    if (pathname === '/api/v1/admin/queues/move-to-end' && method === 'POST') {
      const { queueId, clinicId } = body;
      if (!queueId || !clinicId) return sendError('Queue ID and Clinic ID required');
      
      // Get max display number
      const maxNum = await supabaseRequest(`queues?clinic_id=eq.${clinicId}&order=display_number.desc&limit=1`);
      const newNumber = (maxNum[0]?.display_number || 0) + 1;
      
      const updated = await supabaseRequest(`queues?id=eq.${queueId}`, {
        method: 'PATCH',
        body: JSON.stringify({ 
          display_number: newNumber, 
          status: 'waiting',
          updated_at: new Date().toISOString()
        })
      });
      
      return sendResponse(updated[0]);
    }

    // ==================== PIN MANAGEMENT ====================
    // Get all PINs for today
    if (pathname === '/api/v1/admin/pins' && method === 'GET') {
      const clinics = await supabaseRequest('clinics?is_active=eq.true&order=sort_order.asc');
      const pins = clinics.map(c => ({
        clinic_id: c.id,
        clinic_name_ar: c.name_ar,
        clinic_name_en: c.name_en,
        pin: generateDailyPIN(c.id),
        date: new Date().toISOString().split('T')[0]
      }));
      return sendResponse(pins);
    }

    // Regenerate PIN (creates new secret for clinic)
    if (pathname === '/api/v1/admin/pins/regenerate' && method === 'POST') {
      const { clinicId } = body;
      if (!clinicId) return sendError('Clinic ID required');
      
      // Generate new PIN with timestamp to make it unique - PIN من رقمين فقط (10-99)
      const timestamp = Date.now();
      const secret = process.env.PIN_SECRET || 'mmc-mms-secret-2026';
      const hash = crypto.createHmac('sha256', secret).update(`${clinicId}-${timestamp}`).digest('hex');
      const newPin = (parseInt(hash.substring(0, 8), 16) % 90 + 10).toString();
      
      return sendResponse({ clinicId, pin: newPin, regenerated: true });
    }

    // ==================== REPORTS ====================
    // Get statistics
    if (pathname === '/api/v1/admin/reports/stats' && method === 'GET') {
      const period = parsedUrl.searchParams.get('period') || 'today';
      let startDate, endDate;
      const now = new Date();
      
      switch (period) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0)).toISOString();
          endDate = new Date().toISOString();
          break;
        case 'week':
          startDate = new Date(now.setDate(now.getDate() - 7)).toISOString();
          endDate = new Date().toISOString();
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1)).toISOString();
          endDate = new Date().toISOString();
          break;
        default:
          startDate = new Date(now.setHours(0, 0, 0, 0)).toISOString();
          endDate = new Date().toISOString();
      }
      
      const allQueues = await supabaseRequest(`queues?entered_at=gte.${startDate}&entered_at=lte.${endDate}`);
      const patients = await supabaseRequest(`patients?created_at=gte.${startDate}&created_at=lte.${endDate}`);
      const clinics = await supabaseRequest('clinics?is_active=eq.true');
      
      // Calculate stats
      const totalPatients = patients.length;
      const totalVisits = allQueues.length;
      const completed = allQueues.filter(q => q.status === 'completed').length;
      const waiting = allQueues.filter(q => q.status === 'waiting').length;
      const serving = allQueues.filter(q => q.status === 'serving').length;
      
      // Calculate average wait time
      const completedWithTimes = allQueues.filter(q => q.completed_at && q.entered_at);
      let avgWaitMinutes = 0;
      if (completedWithTimes.length > 0) {
        const totalWait = completedWithTimes.reduce((sum, q) => {
          return sum + (new Date(q.completed_at) - new Date(q.entered_at));
        }, 0);
        avgWaitMinutes = Math.round(totalWait / completedWithTimes.length / 60000);
      }
      
      // Stats by clinic
      const clinicStats = clinics.map(c => {
        const clinicQueues = allQueues.filter(q => q.clinic_id === c.id);
        return {
          clinic_id: c.id,
          clinic_name_ar: c.name_ar,
          clinic_name_en: c.name_en,
          total: clinicQueues.length,
          completed: clinicQueues.filter(q => q.status === 'completed').length,
          waiting: clinicQueues.filter(q => q.status === 'waiting').length,
          serving: clinicQueues.filter(q => q.status === 'serving').length
        };
      });
      
      // Gender distribution
      const males = patients.filter(p => p.gender === 'male').length;
      const females = patients.filter(p => p.gender === 'female').length;
      
      return sendResponse({
        period,
        startDate,
        endDate,
        summary: {
          totalPatients,
          totalVisits,
          completed,
          waiting,
          serving,
          avgWaitMinutes,
          completionRate: totalVisits > 0 ? Math.round((completed / totalVisits) * 100) : 0
        },
        genderDistribution: { males, females },
        clinicStats
      });
    }

    // ==================== SETTINGS ====================
    // Get all settings
    if (pathname === '/api/v1/settings' && method === 'GET') {
      const settings = await getSettings();
      return sendResponse(settings);
    }

    // Update settings
    if (pathname === '/api/v1/settings' && method === 'PATCH') {
      const { 
        callIntervalSeconds, 
        moveToEndSeconds, 
        examDurationSeconds,
        autoCallEnabled,
        soundEnabled,
        notificationsEnabled
      } = body;
      
      if (callIntervalSeconds !== undefined) await updateSetting('call_interval_seconds', callIntervalSeconds);
      if (moveToEndSeconds !== undefined) await updateSetting('move_to_end_seconds', moveToEndSeconds);
      if (examDurationSeconds !== undefined) await updateSetting('exam_duration_seconds', examDurationSeconds);
      if (autoCallEnabled !== undefined) await updateSetting('auto_call_enabled', autoCallEnabled);
      if (soundEnabled !== undefined) await updateSetting('sound_enabled', soundEnabled);
      if (notificationsEnabled !== undefined) await updateSetting('notifications_enabled', notificationsEnabled);
      
      const updatedSettings = await getSettings();
      return sendResponse(updatedSettings);
    }

    // Calculate estimated wait time
    if (pathname === '/api/v1/settings/calculate-wait' && method === 'GET') {
      const aheadCount = parseInt(parsedUrl.searchParams.get('ahead')) || 0;
      const settings = await getSettings();
      const waitTimeSeconds = aheadCount * settings.callIntervalSeconds;
      const waitTimeMinutes = Math.ceil(waitTimeSeconds / 60);
      
      return sendResponse({
        aheadCount,
        waitTimeSeconds,
        waitTimeMinutes,
        settings
      });
    }

    // ==================== NOTIFICATIONS ====================
    // Get notifications
    if (pathname === '/api/v1/admin/notifications' && method === 'GET') {
      try {
        const notifications = await supabaseRequest('notifications?order=created_at.desc&limit=50');
        return sendResponse(notifications);
      } catch (error) {
        return sendResponse([]);
      }
    }

    // Create notification
    if (pathname === '/api/v1/admin/notifications' && method === 'POST') {
      const { title, message, type, target } = body;
      if (!title || !message) return sendError('Title and message required');
      
      const notification = await supabaseRequest('notifications', {
        method: 'POST',
        body: JSON.stringify({
          title,
          message,
          type: type || 'info',
          target: target || 'all',
          is_read: false,
          created_at: new Date().toISOString()
        })
      });
      
      return sendResponse(notification[0]);
    }

    // ==================== ACTIVITY LOG ====================
    // Get activity log
    if (pathname === '/api/v1/admin/activity-log' && method === 'GET') {
      try {
        const logs = await supabaseRequest('activity_logs?order=created_at.desc&limit=100');
        return sendResponse(logs);
      } catch (error) {
        return sendResponse([]);
      }
    }

    // Create activity log entry
    if (pathname === '/api/v1/admin/activity-log' && method === 'POST') {
      const { action, entity, entity_id, details, user_id } = body;
      
      try {
        const log = await supabaseRequest('activity_logs', {
          method: 'POST',
          body: JSON.stringify({
            action,
            entity,
            entity_id,
            details,
            user_id,
            created_at: new Date().toISOString()
          })
        });
        return sendResponse(log[0]);
      } catch (error) {
        // Table might not exist, just return success
        return sendResponse({ logged: true });
      }
    }

    // ==================== ORIGINAL ENDPOINTS ====================
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

    // 4. Queue Operations - NEW SYSTEM
    if (pathname === '/api/v1/queue/get-number' && method === 'POST') {
      const { patientId, clinicId, examType } = body;
      if (!patientId || !clinicId || !examType) return sendError('Patient ID, Clinic ID, and Exam Type are required');

      try {
        const queueNumber = await supabaseRPC('get_next_queue_number', {
          p_patient_id: patientId,
          p_clinic_id: clinicId,
          p_exam_type: examType
        });

        return sendResponse({
          patientId,
          clinicId,
          examType,
          queueNumber: queueNumber || 0,
          date: new Date().toISOString().split('T')[0]
        });
      } catch (error) {
        console.error('Error getting queue number:', error);
        return sendError('Failed to get queue number', 500);
      }
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
