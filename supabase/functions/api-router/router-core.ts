export type AuthMode = 'public' | 'user-auth' | 'internal-admin'

export type RouteConfig = {
  path: string
  method: string
  functionName: string
  authMode: AuthMode
}

export const ROUTES: RouteConfig[] = [
  { path: 'queue/enter', method: 'POST', functionName: 'queue-enter', authMode: 'user-auth' },
  { path: 'patient/login', method: 'POST', functionName: 'patient-login', authMode: 'public' },
  { path: 'queue/call', method: 'POST', functionName: 'call-next-patient', authMode: 'user-auth' },
  { path: 'pin/generate', method: 'POST', functionName: 'issue-pin', authMode: 'internal-admin' },
  { path: 'queue/status', method: 'GET', functionName: 'queue-status', authMode: 'public' },
  { path: 'events/stream', method: 'GET', functionName: 'events-stream', authMode: 'public' },
  { path: 'admin/status', method: 'GET', functionName: 'api-v1-status', authMode: 'internal-admin' },
  { path: 'pin/status', method: 'GET', functionName: 'pin-status', authMode: 'user-auth' },
  { path: 'admin/login', method: 'POST', functionName: 'admin-login', authMode: 'public' },
  { path: 'admin/session/verify', method: 'POST', functionName: 'admin-session-verify', authMode: 'internal-admin' },
]

export const INTERNAL_FUNCTION_ALLOWLIST = new Set(
  ROUTES.filter((route) => route.authMode === 'internal-admin').map((route) => route.functionName),
)

export function resolvePath(url: URL): string {
  let path = url.pathname.replace(/^\/api\/v1\//, '').replace(/^\/api-router\//, '')
  const queryPath = url.searchParams.get('path')
  if (queryPath) path = queryPath
  return path
}

export function getRoute(path: string, method: string): RouteConfig | undefined {
  return ROUTES.find((route) => route.path === path && route.method === method)
}

export function isBearerAuthHeader(value: string | null): boolean {
  return !!value && /^Bearer\s+\S+/i.test(value)
}

export function isUnauthorizedForUserAuth(route: RouteConfig | undefined, authorizationHeader: string | null): boolean {
  return !!route && route.authMode === 'user-auth' && !isBearerAuthHeader(authorizationHeader)
}
