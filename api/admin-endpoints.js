/**
 * Admin Endpoints - نقاط نهاية الإدارة
 */

import { formatSuccess, formatError } from '../lib/helpers-enhanced.js';

export async function handleAdminReports(req, res, { supabase, ADMIN_AUTH_SECRET }) {
  const { method, url } = req;
  const parsedUrl = new URL(url, `https://${req.headers.host || 'localhost'}`);

  if (method === 'GET' && parsedUrl.pathname === '/api/v1/admin/reports/daily') {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data: queues, error } = await supabase
        .from('queues')
        .select('*')
        .eq('queue_date', today);

      if (error) throw error;

      const stats = {
        date: today,
        total: queues?.length || 0,
        waiting: queues?.filter(q => q.status === 'waiting').length || 0,
        serving: queues?.filter(q => q.status === 'serving').length || 0,
        completed: queues?.filter(q => q.status === 'completed').length || 0,
      };

      return res.status(200).json(formatSuccess(stats));
    } catch (error) {
      return res.status(500).json(formatError('Failed to generate report', 'REPORT_ERROR', error.message));
    }
  }

  return res.status(404).json(formatError('Report endpoint not found', 'NOT_FOUND'));
}

export async function handleAdminUsers(req, res, { supabase, ADMIN_AUTH_SECRET }) {
  const { method } = req;

  if (method === 'GET') {
    try {
      const { data: admins, error } = await supabase
        .from('admins')
        .select('id, username, role, permissions, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.status(200).json(formatSuccess(admins || []));
    } catch (error) {
      return res.status(500).json(formatError('Failed to fetch users', 'USERS_ERROR', error.message));
    }
  }

  return res.status(404).json(formatError('Users endpoint not found', 'NOT_FOUND'));
}

export async function handleActivityLog(req, res, { supabase, ADMIN_AUTH_SECRET }) {
  const { method } = req;

  if (method === 'GET') {
    try {
      // Return empty activity log for now
      return res.status(200).json(formatSuccess([]));
    } catch (error) {
      return res.status(500).json(formatError('Failed to fetch activity log', 'ACTIVITY_LOG_ERROR', error.message));
    }
  }

  return res.status(404).json(formatError('Activity log endpoint not found', 'NOT_FOUND'));
}

export async function handleNotifications(req, res, { supabase, ADMIN_AUTH_SECRET }) {
  const { method } = req;

  if (method === 'GET') {
    try {
      // Return empty notifications for now
      return res.status(200).json(formatSuccess([]));
    } catch (error) {
      return res.status(500).json(formatError('Failed to fetch notifications', 'NOTIFICATIONS_ERROR', error.message));
    }
  }

  return res.status(404).json(formatError('Notifications endpoint not found', 'NOT_FOUND'));
}
