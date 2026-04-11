import { error, handleCORSPreflight } from '../../_lib/json'

export const config = { runtime: 'edge' }

/**
 * The PIN system was intentionally removed from the production flow.
 */
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  return error('PIN system removed from the current production flow', 410)
}
