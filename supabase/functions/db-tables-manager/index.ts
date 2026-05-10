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

interface ApiLog {
  api_name: string
  user_id?: string
  request_method: string
  request_path: string
  request_body?: any
  response_status: number
  response_body?: any
  execution_time_ms: number
  ip_address?: string
  user_agent?: string
}

async function logApiUsage(supabase: any, log: ApiLog) {
  try {
    await supabase.from('api_logs').insert(log)
  } catch (error) {
    console.error('Error logging API usage:', error)
  }
}

async function checkApiStatus(supabase: any, apiName: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('api_status')
    .select('is_active')
    .eq('api_name', apiName)
    .single()
  
  if (error || !data) return false
  return data.is_active
}

serve(async (req) => {
  const startTime = Date.now()
  
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
    let apiName = ''

    // GET /api/db/tables - عرض جميع الجداول
    if (method === 'GET' && path === '/api/db/tables') {
      apiName = 'get_all_tables'
      if (!await checkApiStatus(supabaseClient, apiName)) {
        throw new Error('API is disabled')
      }

      const { data, error } = await supabaseClient.rpc('get_all_tables_info')
      
      if (error) throw error
      response = { success: true, data }
    }

    // GET /api/db/tables/:name - عرض تفاصيل جدول
    else if (method === 'GET' && path.startsWith('/api/db/tables/') && !path.includes('/columns') && !path.includes('/policies')) {
      apiName = 'get_table_details'
      if (!await checkApiStatus(supabaseClient, apiName)) {
        throw new Error('API is disabled')
      }

      const tableName = path.split('/')[4]
      const { data, error } = await supabaseClient.rpc('get_table_details', { table_name: tableName })
      
      if (error) throw error
      response = { success: true, data }
    }

    // POST /api/db/tables - إنشاء جدول جديد
    else if (method === 'POST' && path === '/api/db/tables') {
      apiName = 'create_table'
      if (!await checkApiStatus(supabaseClient, apiName)) {
        throw new Error('API is disabled')
      }

      const body = await req.json()
      const { table_name, columns, enable_rls } = body

      if (!table_name || !columns || columns.length === 0) {
        throw new Error('Missing required fields: table_name, columns')
      }

      // إنشاء الجدول
      let createTableSQL = `CREATE TABLE IF NOT EXISTS public.${table_name} (`
      const columnDefs = columns.map((col: any) => {
        let def = `${col.name} ${col.type}`
        if (col.primary_key) def += ' PRIMARY KEY'
        if (col.not_null) def += ' NOT NULL'
        if (col.unique) def += ' UNIQUE'
        if (col.default) def += ` DEFAULT ${col.default}`
        return def
      })
      createTableSQL += columnDefs.join(', ') + ');'

      const { error: createError } = await supabaseClient.rpc('execute_sql', { sql: createTableSQL })
      if (createError) throw createError

      // تفعيل RLS إذا طلب
      if (enable_rls) {
        const { error: rlsError } = await supabaseClient.rpc('execute_sql', {
          sql: `ALTER TABLE public.${table_name} ENABLE ROW LEVEL SECURITY;`
        })
        if (rlsError) throw rlsError
      }

      // حفظ في جدول الإدارة
      await supabaseClient.from('db_table_management').insert({
        table_name,
        rls_enabled: enable_rls || false,
        created_by: user.id
      })

      response = { success: true, message: 'Table created successfully', table_name }
    }

    // PATCH /api/db/tables/:name/rls - تفعيل/تعطيل RLS
    else if (method === 'PATCH' && path.includes('/rls')) {
      apiName = 'toggle_table_rls'
      if (!await checkApiStatus(supabaseClient, apiName)) {
        throw new Error('API is disabled')
      }

      const tableName = path.split('/')[4]
      const body = await req.json()
      const { enable } = body

      const sql = enable
        ? `ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY;`
        : `ALTER TABLE public.${tableName} DISABLE ROW LEVEL SECURITY;`

      const { error } = await supabaseClient.rpc('execute_sql', { sql })
      if (error) throw error

      // تحديث في جدول الإدارة
      await supabaseClient
        .from('db_table_management')
        .update({ rls_enabled: enable, updated_at: new Date().toISOString() })
        .eq('table_name', tableName)

      response = { success: true, message: `RLS ${enable ? 'enabled' : 'disabled'} successfully` }
    }

    // DELETE /api/db/tables/:name - حذف جدول
    else if (method === 'DELETE' && path.startsWith('/api/db/tables/')) {
      apiName = 'delete_table'
      if (!await checkApiStatus(supabaseClient, apiName)) {
        throw new Error('API is disabled')
      }

      const tableName = path.split('/')[4]
      
      const { error } = await supabaseClient.rpc('execute_sql', {
        sql: `DROP TABLE IF EXISTS public.${tableName} CASCADE;`
      })
      if (error) throw error

      // حذف من جدول الإدارة
      await supabaseClient
        .from('db_table_management')
        .delete()
        .eq('table_name', tableName)

      response = { success: true, message: 'Table deleted successfully' }
    }

    else {
      throw new Error('Invalid endpoint or method')
    }

    const executionTime = Date.now() - startTime

    // تسجيل الاستخدام
    await logApiUsage(supabaseClient, {
      api_name: apiName,
      user_id: user.id,
      request_method: method,
      request_path: path,
      request_body: method !== 'GET' ? await req.clone().json().catch(() => null) : null,
      response_status: 200,
      response_body: response,
      execution_time_ms: executionTime,
      ip_address: req.headers.get('x-forwarded-for') || 'unknown',
      user_agent: req.headers.get('user-agent') || 'unknown'
    })

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    const executionTime = Date.now() - startTime
    
    return new Response(
      JSON.stringify(DENY_RESPONSE),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
