import { describe, expect, it } from 'vitest'
import { getRoute, INTERNAL_FUNCTION_ALLOWLIST, isUnauthorizedForUserAuth, resolvePath } from '../supabase/functions/api-router/router-core'

describe('api-router auth routing integration', () => {
  it('rejects user-auth route when auth header is missing', () => {
    const route = getRoute('queue/enter', 'POST')
    expect(isUnauthorizedForUserAuth(route, null)).toBe(true)
  })

  it('rejects user-auth route when auth header is invalid', () => {
    const route = getRoute('queue/call', 'POST')
    expect(isUnauthorizedForUserAuth(route, 'Token abc')).toBe(true)
  })

  it('accepts user-auth route when bearer token is present', () => {
    const route = getRoute('pin/status', 'GET')
    expect(isUnauthorizedForUserAuth(route, 'Bearer valid.jwt.token')).toBe(false)
  })

  it('does not require auth for public routes', () => {
    const route = getRoute('patient/login', 'POST')
    expect(isUnauthorizedForUserAuth(route, null)).toBe(false)
  })

  it('allows service-role forwarding only for internal allowlist routes', () => {
    const internalRoute = getRoute('pin/generate', 'POST')
    const publicRoute = getRoute('queue/status', 'GET')

    expect(internalRoute?.authMode).toBe('internal-admin')
    expect(INTERNAL_FUNCTION_ALLOWLIST.has(internalRoute!.functionName)).toBe(true)
    expect(publicRoute?.authMode).toBe('public')
    expect(INTERNAL_FUNCTION_ALLOWLIST.has(publicRoute!.functionName)).toBe(false)
  })

  it('resolves rewritten and query-overridden paths', () => {
    expect(resolvePath(new URL('https://x/api/v1/queue/status'))).toBe('queue/status')
    expect(resolvePath(new URL('https://x/api-router/queue/status'))).toBe('queue/status')
    expect(resolvePath(new URL('https://x/api/v1/any?path=admin/status'))).toBe('admin/status')
  })
})
