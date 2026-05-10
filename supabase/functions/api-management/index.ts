import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
}

const DENY_RESPONSE = { error: 'Access denied' }

function deny(status = 403) {
  return new Response(JSON.stringify(DENY_RESPONSE), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function extractJwtRole(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''))
    return payload?.role ?? payload?.app_metadata?.role ?? null
  } catch {
    return null
  }
}

function hasInternalSecret(req: Request): boolean {
  const expected = Deno.env.get('INTERNAL_ADMIN_SECRET')
  const provided = req.headers.get('x-internal-secret')
  return Boolean(expected && provided && expected === provided)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ') || !hasInternalSecret(req)) {
      return deny()
    }

    const token = authHeader.replace('Bearer ', '')
    const jwtRole = extractJwtRole(token)
    if (jwtRole !== 'admin' && jwtRole !== 'service_role') {
      return deny()
    }

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

    if (authError || !user) {
      return deny()
    }

    // طبقة تحقق إضافية: المستخدم موجود في جدول الإداريين
    const { data: admin } = await supabaseClient
      .from('admins')
      .select('id')
      .eq('id', user.id)
      .single()

    if (!admin) {
      return deny()
    }

    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    // رفض افتراضي: لا يُسمح بالتنفيذ إلا إذا كانت كل طبقات الحماية مكتملة + التفعيل الداخلي
    if (Deno.env.get('API_ENABLED') !== 'true') {
      return deny()
    }

    let response: any

    // GET /api/management/status - عرض حالة جميع APIs
    if (method === 'GET' && path === '/api/management/status') {
      const { data, error } = await supabaseClient
        .from('api_status')
        .select('*')
        .order('api_name')

      if (error) throw error

      // حساب إحصائيات
      const totalApis = data.length
      const activeApis = data.filter((api: any) => api.is_active).length
      const inactiveApis = totalApis - activeApis
      const totalUsage = data.reduce((sum: number, api: any) => sum + (api.usage_count || 0), 0)

      response = {
        success: true,
        statistics: {
          total_apis: totalApis,
          active_apis: activeApis,
          inactive_apis: inactiveApis,
          total_usage: totalUsage
        },
        apis: data
      }
    }

    // PATCH /api/management/toggle/:name - تفعيل/تعطيل API
    else if (method === 'PATCH' && path.includes('/toggle/')) {
      const apiName = path.split('/').pop()
      const body = await req.json()
      const { is_active } = body

      const { data, error } = await supabaseClient
        .from('api_status')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('api_name', apiName)
        .select()
        .single()

      if (error) throw error

      response = {
        success: true,
        message: `API ${is_active ? 'enabled' : 'disabled'} successfully`,
        data
      }
    }

    // GET /api/management/logs - عرض سجلات استخدام APIs
    else if (method === 'GET' && path === '/api/management/logs') {
      const { searchParams } = url
      const limit = parseInt(searchParams.get('limit') || '100')
      const offset = parseInt(searchParams.get('offset') || '0')
      const apiName = searchParams.get('api_name')

      let query = supabaseClient
        .from('api_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (apiName) {
        query = query.eq('api_name', apiName)
      }

      const { data, error, count } = await query

      if (error) throw error

      response = {
        success: true,
        total: count,
        limit,
        offset,
        data
      }
    }

    // GET /api/management/stats - إحصائيات مفصلة
    else if (method === 'GET' && path === '/api/management/stats') {
      // إحصائيات APIs
      const { data: apiStats } = await supabaseClient
        .from('api_status')
        .select('*')

      // إحصائيات الاستخدام خلال آخر 24 ساعة
      const { data: recentLogs } = await supabaseClient
        .from('api_logs')
        .select('api_name, execution_time_ms, response_status, created_at')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

      // حساب متوسط وقت التنفيذ لكل API
      const avgExecutionTime: any = {}
      const successRate: any = {}
      const usageCount: any = {}

      recentLogs?.forEach((log: any) => {
        if (!avgExecutionTime[log.api_name]) {
          avgExecutionTime[log.api_name] = []
          successRate[log.api_name] = { success: 0, total: 0 }
          usageCount[log.api_name] = 0
        }
        avgExecutionTime[log.api_name].push(log.execution_time_ms)
        successRate[log.api_name].total++
        if (log.response_status >= 200 && log.response_status < 300) {
          successRate[log.api_name].success++
        }
        usageCount[log.api_name]++
      })

      const stats = Object.keys(avgExecutionTime).map(apiName => ({
        api_name: apiName,
        avg_execution_time_ms: Math.round(
          avgExecutionTime[apiName].reduce((a: number, b: number) => a + b, 0) / avgExecutionTime[apiName].length
        ),
        success_rate: ((successRate[apiName].success / successRate[apiName].total) * 100).toFixed(2) + '%',
        usage_count_24h: usageCount[apiName]
      }))

      response = {
        success: true,
        period: 'Last 24 hours',
        statistics: stats,
        total_requests_24h: recentLogs?.length || 0
      }
    }

    // GET /api/management/database-overview - نظرة عامة على قاعدة البيانات
    else if (method === 'GET' && path === '/api/management/database-overview') {
      // عدد الجداول
      const { data: tables } = await supabaseClient.rpc('execute_sql', {
        sql: "SELECT COUNT(*) as count FROM pg_tables WHERE schemaname = 'public';"
      })

      // عدد السياسات
      const { data: policies } = await supabaseClient.rpc('execute_sql', {
        sql: "SELECT COUNT(*) as count FROM pg_policies WHERE schemaname = 'public';"
      })

      // عدد القيود الأجنبية
      const { data: foreignKeys } = await supabaseClient.rpc('execute_sql', {
        sql: "SELECT COUNT(*) as count FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public';"
      })

      // حالة RLS
      const { data: rlsStatus } = await supabaseClient.rpc('execute_sql', {
        sql: `SELECT 
                COUNT(*) FILTER (WHERE c.relrowsecurity = true) as rls_enabled,
                COUNT(*) FILTER (WHERE c.relrowsecurity = false) as rls_disabled,
                COUNT(*) as total
              FROM pg_tables t
              JOIN pg_class c ON c.relname = t.tablename
              WHERE t.schemaname = 'public';`
      })

      response = {
        success: true,
        database_overview: {
          total_tables: tables?.[0]?.count || 0,
          total_policies: policies?.[0]?.count || 0,
          total_foreign_keys: foreignKeys?.[0]?.count || 0,
          rls_status: rlsStatus?.[0] || { rls_enabled: 0, rls_disabled: 0, total: 0 }
        }
      }
    }

    else {
      throw new Error('Invalid endpoint or method')
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify(DENY_RESPONSE),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
