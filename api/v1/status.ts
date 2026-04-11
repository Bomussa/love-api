import { createSupabaseServerClient, error, getQueueTable, handleCORSPreflight, success } from '../_lib/json'

export const config = { runtime: 'edge' }

/**
 * Lightweight system status endpoint used by the frontend bootstrap.
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
    const queueTable = await getQueueTable(supabase)

    return success({
      status: 'healthy',
      queueTable,
      timestamp: new Date().toISOString(),
      version: '3.0.0'
    })
  } catch (requestError: any) {
    return error(requestError.message, 500)
  }
}
