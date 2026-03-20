/**
 * Dashboard Endpoints - نقاط نهاية شاملة للـ Dashboard
 */

import { formatSuccess, formatError } from '../lib/helpers-enhanced.js';

export async function handleDashboardStats(req, res, { supabase }) {
  const { method } = req;

  if (method === 'GET') {
    try {
      const today = new Date().toISOString().split('T')[0];

      // جلب إحصائيات الطوابير
      const { data: queues, error: queueError } = await supabase
        .from('queues')
        .select('*')
        .eq('queue_date', today);

      if (queueError) throw queueError;

      // جلب إحصائيات العيادات
      const { data: clinics, error: clinicsError } = await supabase
        .from('clinics')
        .select('*');

      if (clinicsError) throw clinicsError;

      // جلب الأرقام السرية النشطة
      const now = new Date().toISOString();
      const { count: activePins } = await supabase
        .from('pins')
        .select('*', { count: 'exact', head: true })
        .gte('valid_until', now)
        .is('used_at', null);

      // حساب الإحصائيات
      const stats = {
        totalPatients: queues?.length || 0,
        waiting: queues?.filter(q => q.status === 'waiting').length || 0,
        serving: queues?.filter(q => q.status === 'serving').length || 0,
        completed: queues?.filter(q => q.status === 'completed').length || 0,
        activePins: activePins || 0,
        totalClinics: clinics?.length || 0,
        date: today,
        timestamp: new Date().toISOString()
      };

      return res.status(200).json(formatSuccess(stats));
    } catch (error) {
      return res.status(500).json(formatError(error.message, 'DASHBOARD_STATS_FAILED'));
    }
  }
}

export async function handleClinicStats(req, res, { supabase }) {
  const { method } = req;
  const query = new URL(req.url, `https://${req.headers.host}`).searchParams;
  const clinicId = query.get('clinicId');

  if (method === 'GET') {
    try {
      const today = new Date().toISOString().split('T')[0];

      let queueQuery = supabase
        .from('queues')
        .select('*')
        .eq('queue_date', today);

      if (clinicId) {
        queueQuery = queueQuery.eq('clinic_id', clinicId);
      }

      const { data: queues, error: queueError } = await queueQuery;

      if (queueError) throw queueError;

      const clinicStats = {};

      if (clinicId) {
        // إحصائيات عيادة واحدة
        const completed = queues?.filter(q => q.status === 'completed') || [];
        const avgWaitTime = calculateAvgWaitTime(completed);

        clinicStats[clinicId] = {
          total: queues?.length || 0,
          completed: completed.length,
          waiting: queues?.filter(q => q.status === 'waiting').length || 0,
          serving: queues?.filter(q => q.status === 'serving').length || 0,
          avgWaitTime
        };
      } else {
        // إحصائيات جميع العيادات
        const { data: clinics } = await supabase.from('clinics').select('id, name_ar, name_en');

        (clinics || []).forEach(clinic => {
          const clinicQueues = queues?.filter(q => q.clinic_id === clinic.id) || [];
          const completed = clinicQueues.filter(q => q.status === 'completed');
          const avgWaitTime = calculateAvgWaitTime(completed);

          clinicStats[clinic.id] = {
            name_ar: clinic.name_ar,
            name_en: clinic.name_en,
            total: clinicQueues.length,
            completed: completed.length,
            waiting: clinicQueues.filter(q => q.status === 'waiting').length,
            serving: clinicQueues.filter(q => q.status === 'serving').length,
            avgWaitTime
          };
        });
      }

      return res.status(200).json(formatSuccess({ clinicStats, date: today }));
    } catch (error) {
      return res.status(500).json(formatError(error.message, 'CLINIC_STATS_FAILED'));
    }
  }
}

export async function handleServiceHealth(req, res, { supabase }) {
  const { method } = req;

  if (method === 'GET') {
    try {
      const checks = [];

      // فحص قاعدة البيانات
      try {
        const startTime = Date.now();
        await supabase.from('clinics').select('id', { head: true, count: 'exact' }).limit(1);
        checks.push({
          service: 'database',
          status: 'ok',
          responseTime: Date.now() - startTime
        });
      } catch (e) {
        checks.push({
          service: 'database',
          status: 'error',
          error: e.message,
          responseTime: Date.now() - startTime
        });
      }

      // فحص جدول الطوابير
      try {
        const startTime = Date.now();
        await supabase.from('queues').select('id', { head: true, count: 'exact' }).limit(1);
        checks.push({
          service: 'queues',
          status: 'ok',
          responseTime: Date.now() - startTime
        });
      } catch (e) {
        checks.push({
          service: 'queues',
          status: 'error',
          error: e.message,
          responseTime: Date.now() - startTime
        });
      }

      // فحص جدول الأرقام السرية
      try {
        const startTime = Date.now();
        await supabase.from('pins').select('id', { head: true, count: 'exact' }).limit(1);
        checks.push({
          service: 'pins',
          status: 'ok',
          responseTime: Date.now() - startTime
        });
      } catch (e) {
        checks.push({
          service: 'pins',
          status: 'error',
          error: e.message,
          responseTime: Date.now() - startTime
        });
      }

      const healthScore = (checks.filter(c => c.status === 'ok').length / checks.length) * 100;

      return res.status(200).json(formatSuccess({
        checks,
        healthScore: Math.round(healthScore),
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      return res.status(500).json(formatError(error.message, 'HEALTH_CHECK_FAILED'));
    }
  }
}

// Helper functions
function calculateAvgWaitTime(completed) {
  if (completed.length === 0) return 0;
  const totalWait = completed.reduce((acc, q) => {
    if (q.entered_at && q.called_at) {
      return acc + (new Date(q.called_at) - new Date(q.entered_at));
    }
    return acc;
  }, 0);
  return Math.round(totalWait / completed.length / 60000); // بالدقائق
}
