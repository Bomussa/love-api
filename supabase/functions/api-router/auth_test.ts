import { hasAuthOrSession, isInternalServiceRoleAllowed } from './auth.ts'

Deno.test('hasAuthOrSession returns true when authorization header exists', () => {
  const req = new Request('https://example.com', { headers: { authorization: 'Bearer token' } })
  if (!hasAuthOrSession(req)) throw new Error('expected true')
})

Deno.test('hasAuthOrSession returns true when apikey header exists', () => {
  const req = new Request('https://example.com', { headers: { apikey: 'anon-key' } })
  if (!hasAuthOrSession(req)) throw new Error('expected true')
})

Deno.test('hasAuthOrSession returns false when neither header exists', () => {
  const req = new Request('https://example.com')
  if (hasAuthOrSession(req)) throw new Error('expected false')
})

Deno.test('isInternalServiceRoleAllowed only permits allowlisted function with matching internal key', () => {
  const allowlist = new Set(['api-v1-status'])
  const req = new Request('https://example.com', { headers: { 'x-internal-api-key': 'secret-1' } })
  const allowed = isInternalServiceRoleAllowed('api-v1-status', req, allowlist, 'secret-1')
  if (!allowed) throw new Error('expected true')
})

Deno.test('isInternalServiceRoleAllowed rejects non-allowlisted function', () => {
  const allowlist = new Set(['api-v1-status'])
  const req = new Request('https://example.com', { headers: { 'x-internal-api-key': 'secret-1' } })
  const allowed = isInternalServiceRoleAllowed('queue-enter', req, allowlist, 'secret-1')
  if (allowed) throw new Error('expected false')
})

Deno.test('isInternalServiceRoleAllowed rejects missing key or mismatch', () => {
  const allowlist = new Set(['api-v1-status'])
  const req = new Request('https://example.com', { headers: { 'x-internal-api-key': 'wrong' } })
  const allowed = isInternalServiceRoleAllowed('api-v1-status', req, allowlist, 'secret-1')
  if (allowed) throw new Error('expected false')
})
