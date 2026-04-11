import { error, handleCORSPreflight } from '../../_lib/json'

export const config = { runtime: 'edge' }

/**
 * Reports export/history was removed from the final queue-only scope.
 */
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  return error('Reports history was removed from the product scope', 410)
}
