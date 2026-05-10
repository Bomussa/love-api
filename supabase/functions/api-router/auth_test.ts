import { hasAuthOrSession, isInternalServiceRoleAllowed, resolveForwardAuthHeader } from './auth.ts'

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

Deno.test('forward auth uses incoming Authorization from client when provided', () => {
  const allowlist = new Set(['api-v1-status'])
  const req = new Request('https://example.com', { headers: { authorization: 'Bearer client-jwt' } })

  const resolution = resolveForwardAuthHeader('api-v1-status', req, allowlist, 'internal-key', 'service-role')

  if (resolution.kind !== 'client') throw new Error(`expected client, got ${resolution.kind}`)
  if (resolution.authorization !== 'Bearer client-jwt') throw new Error('expected client authorization to pass through')
})

Deno.test('forward auth leaves Authorization empty when client header is absent and endpoint is not allowlisted', () => {
  const allowlist = new Set(['api-v1-status'])
  const req = new Request('https://example.com')

  const resolution = resolveForwardAuthHeader('queue-enter', req, allowlist, 'internal-key', 'service-role')

  if (resolution.kind !== 'none') throw new Error(`expected none, got ${resolution.kind}`)
  if (resolution.authorization !== null) throw new Error('expected no authorization header')
})

Deno.test('forward auth rejects unauthorized admin endpoint escalation without client auth', () => {
  const allowlist = new Set(['api-v1-status'])
  const req = new Request('https://example.com')

  const resolution = resolveForwardAuthHeader('api-v1-status', req, allowlist, 'internal-key', 'service-role')

  if (resolution.kind !== 'unauthorized_internal') throw new Error(`expected unauthorized_internal, got ${resolution.kind}`)
  if (resolution.authorization !== null) throw new Error('expected authorization to remain null')
})
