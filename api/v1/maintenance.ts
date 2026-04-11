import { error, handleCORSPreflight } from '../_lib/json'

export const config = { runtime: 'edge' }

/**
 * Legacy maintenance module was removed from the simplified system.
 */
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return handleCORSPreflight()
  }

  return error('Maintenance control screen was removed from the product scope', 410)
}
