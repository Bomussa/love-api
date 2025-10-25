/**
 * Medical Committee API - Single Entry Point
 * All endpoints in one file to comply with Vercel Free Plan (max 12 functions)
 */

import { createEnv } from './lib/storage.js';
import { 
  validatePatientId, 
  validateGender, 
  validateClinic,
  generatePIN,
  getClientIP
} from './lib/helpers.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { pathname } = new URL(req.url, `https://${req.headers.host}`);
  const method = req.method;
  const body = req.body || {};

  try {
    const env = createEnv();

    // ==================== STATUS ====================
    if (pathname === '/api/v1/status' && method === 'GET') {
      return res.status(200).json({
        success: true,
        status: 'healthy',
        mode: 'online',
        backend: 'up',
        platform: 'vercel',
        timestamp: new Date().toISOString(),
        version: '2.0.0'
      });
    }

    // ==================== PATIENT LOGIN ====================
    if (pathname === '/api/v1/patient/login' && method === 'POST') {
      const { patientId, gender } = body;

      if (!patientId || !gender) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: patientId and gender'
        });
      }

      if (!validatePatientId(patientId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid patientId format'
        });
      }

      if (!validateGender(gender)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid gender'
        });
      }

      const sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const patientData = {
        id: sessionId,
        patientId,
        gender,
        loginTime: new Date().toISOString(),
        status: 'logged_in'
      };

      await env.KV_CACHE.put(
        `patient:${sessionId}`,
        JSON.stringify(patientData),
        { expirationTtl: 86400 }
      );

      return res.status(200).json({
        success: true,
        data: patientData,
        message: 'Login successful'
      });
    }

    // ==================== QUEUE ENTER ====================
    if (pathname === '/api/v1/queue/enter' && method === 'POST') {
      const { patientId, clinic } = body;

      if (!patientId || !clinic) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
      }

      if (!validateClinic(clinic)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid clinic'
        });
      }

      const queueKey = `queue:${clinic}`;
      let queue = await env.KV_QUEUES.get(queueKey, { type: 'json' }) || { patients: [], current: 0 };

      const position = queue.patients.length + 1;
      queue.patients.push({
        patientId,
        position,
        enteredAt: new Date().toISOString()
      });

      await env.KV_QUEUES.put(queueKey, JSON.stringify(queue), { expirationTtl: 86400 });

      return res.status(200).json({
        success: true,
        position,
        queueLength: queue.patients.length,
        estimatedWait: position * 5
      });
    }

    // ==================== QUEUE STATUS ====================
    if (pathname === '/api/v1/queue/status' && method === 'GET') {
      const url = new URL(req.url, `https://${req.headers.host}`);
      const clinic = url.searchParams.get('clinic');

      if (!clinic) {
        return res.status(400).json({
          success: false,
          error: 'Missing clinic parameter'
        });
      }

      const queueKey = `queue:${clinic}`;
      const queue = await env.KV_QUEUES.get(queueKey, { type: 'json' }) || { patients: [], current: 0 };

      return res.status(200).json({
        success: true,
        clinic,
        queueLength: queue.patients.length,
        currentNumber: queue.current,
        patients: queue.patients
      });
    }

    // ==================== QUEUE CALL ====================
    if (pathname === '/api/v1/queue/call' && method === 'POST') {
      const { clinic } = body;

      if (!clinic) {
        return res.status(400).json({
          success: false,
          error: 'Missing clinic'
        });
      }

      const queueKey = `queue:${clinic}`;
      let queue = await env.KV_QUEUES.get(queueKey, { type: 'json' }) || { patients: [], current: 0 };

      if (queue.patients.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No patients in queue'
        });
      }

      const nextPatient = queue.patients.shift();
      queue.current = nextPatient.position;

      await env.KV_QUEUES.put(queueKey, JSON.stringify(queue), { expirationTtl: 86400 });

      return res.status(200).json({
        success: true,
        calledPatient: nextPatient,
        remainingInQueue: queue.patients.length
      });
    }

    // ==================== QUEUE DONE ====================
    if (pathname === '/api/v1/queue/done' && method === 'POST') {
      const { patientId, clinic } = body;

      if (!patientId || !clinic) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Patient marked as done'
      });
    }

    // ==================== PIN GENERATE ====================
    if (pathname === '/api/v1/pin/generate' && method === 'POST') {
      const { clinic } = body;

      if (!clinic) {
        return res.status(400).json({
          success: false,
          error: 'Missing clinic'
        });
      }

      const pin = generatePIN();
      const dateKey = new Date().toISOString().split('T')[0];

      const pinData = {
        pin,
        clinic,
        dateKey,
        createdAt: new Date().toISOString()
      };

      await env.KV_PINS.put(
        `pin:${clinic}:${dateKey}:${pin}`,
        JSON.stringify(pinData),
        { expirationTtl: 300 }
      );

      return res.status(200).json({
        success: true,
        pin,
        dateKey
      });
    }

    // ==================== PIN VERIFY ====================
    if (pathname === '/api/v1/pin/verify' && method === 'POST') {
      const { pin, clinic, dateKey } = body;

      if (!pin || !clinic) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
      }

      const useDateKey = dateKey || new Date().toISOString().split('T')[0];
      const pinData = await env.KV_PINS.get(`pin:${clinic}:${useDateKey}:${pin}`, { type: 'json' });

      if (!pinData) {
        return res.status(404).json({
          success: false,
          error: 'PIN not found'
        });
      }

      return res.status(200).json({
        success: true,
        valid: true,
        clinic: pinData.clinic
      });
    }

    // ==================== PIN STATUS ====================
    if (pathname === '/api/v1/pin/status' && method === 'GET') {
      const url = new URL(req.url, `https://${req.headers.host}`);
      const clinic = url.searchParams.get('clinic');

      if (!clinic) {
        return res.status(400).json({
          success: false,
          error: 'Missing clinic parameter'
        });
      }

      return res.status(200).json({
        success: true,
        clinic,
        available: true
      });
    }

    // ==================== STATS DASHBOARD ====================
    if (pathname === '/api/v1/stats/dashboard' && method === 'GET') {
      return res.status(200).json({
        success: true,
        stats: {
          totalPatients: 0,
          activeQueues: 0,
          completedToday: 0,
          averageWaitTime: 0
        }
      });
    }

    // ==================== STATS QUEUES ====================
    if (pathname === '/api/v1/stats/queues' && method === 'GET') {
      return res.status(200).json({
        success: true,
        queues: []
      });
    }

    // ==================== ADMIN STATUS ====================
    if (pathname === '/api/v1/admin/status' && method === 'GET') {
      return res.status(200).json({
        success: true,
        status: 'operational',
        timestamp: new Date().toISOString()
      });
    }

    // ==================== CLINIC EXIT ====================
    if (pathname === '/api/v1/clinic/exit' && method === 'POST') {
      const { patientId, clinic } = body;

      if (!patientId || !clinic) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Patient exited clinic'
      });
    }

    // ==================== EVENTS STREAM ====================
    if (pathname === '/api/v1/events/stream' && method === 'GET') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
      
      return;
    }

    // ==================== REPORTS ====================
    if (pathname === '/api/v1/reports/daily' && method === 'GET') {
      return res.status(200).json({
        success: true,
        report: { date: new Date().toISOString().split('T')[0], data: [] }
      });
    }

    if (pathname === '/api/v1/reports/weekly' && method === 'GET') {
      return res.status(200).json({
        success: true,
        report: { week: new Date().toISOString().split('T')[0], data: [] }
      });
    }

    if (pathname === '/api/v1/reports/monthly' && method === 'GET') {
      return res.status(200).json({
        success: true,
        report: { month: new Date().toISOString().substring(0, 7), data: [] }
      });
    }

    if (pathname === '/api/v1/reports/annual' && method === 'GET') {
      return res.status(200).json({
        success: true,
        report: { year: new Date().getFullYear(), data: [] }
      });
    }

    // ==================== ROUTE ====================
    if (pathname === '/api/v1/route/create' && method === 'POST') {
      return res.status(200).json({
        success: true,
        route: body
      });
    }

    if (pathname === '/api/v1/route/get' && method === 'GET') {
      return res.status(200).json({
        success: true,
        route: {}
      });
    }

    if (pathname === '/api/v1/path/choose' && method === 'POST') {
      return res.status(200).json({
        success: true,
        path: body
      });
    }

    // ==================== 404 ====================
    return res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      path: pathname
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}

