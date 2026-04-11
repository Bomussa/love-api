import { createSupabaseServerClient, error, handleCORSPreflight, success } from '../_lib/json'

export const config = { runtime: 'edge' }

/**
 * Deep health check confirming that Supabase is reachable.
 */
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  if (req.method !== 'GET') {
    return error('Method not allowed', 405)
  }

  try {
    const supabase = createSupabaseServerClient()
    const { error: patientError } = await supabase.from('patients').select('id', { count: 'exact', head: true })

    return success({
      status: patientError ? 'degraded' : 'healthy',
      database: patientError ? 'unreachable' : 'connected',
      timestamp: new Date().toISOString()
    }, patientError ? 503 : 200)
  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
