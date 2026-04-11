/**
 * Resolves the backend base URL for every frontend request.
 *
 * The application prefers an explicit Vite environment variable so the same
 * build can target staging or production, then falls back to the current
 * browser origin when the frontend and API are hosted together.
 *
 * @returns {string} Normalized API base ending with `/api/v1`.
 */
export function getApiBase() {
  const explicitBase = (import.meta.env.VITE_API_BASE || '').toString().trim()
  const explicitOrigin = (import.meta.env.VITE_SITE_ORIGIN || '').toString().trim()
  const browserOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const origin = explicitBase || explicitOrigin || browserOrigin

  return `${origin.replace(/\/$/, '')}/api/v1`
}