export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

type AuthResolution = {
  kind: 'client' | 'internal_service' | 'none' | 'unauthorized_internal'
  authorization: string | null
}

export function hasAuthOrSession(req: Request): boolean {
  const authorization = req.headers.get('authorization')
  const apikey = req.headers.get('apikey')
  return Boolean(authorization || apikey)
}

export function isInternalServiceRoleAllowed(
  functionName: string,
  req: Request,
  serviceRoleAllowlist: Set<string>,
  internalApiKey: string,
): boolean {
  if (!serviceRoleAllowlist.has(functionName)) return false
  const internalKey = req.headers.get(INTERNAL_API_KEY_HEADER)
  return Boolean(internalApiKey && internalKey && internalKey === internalApiKey)
}

export function resolveForwardAuthHeader(
  functionName: string,
  req: Request,
  serviceRoleAllowlist: Set<string>,
  internalApiKey: string,
  serviceRoleKey: string,
): AuthResolution {
  const authorization = req.headers.get('authorization')
  if (authorization) {
    return { kind: 'client', authorization }
  }

  if (isInternalServiceRoleAllowed(functionName, req, serviceRoleAllowlist, internalApiKey)) {
    if (!serviceRoleKey) {
      return { kind: 'unauthorized_internal', authorization: null }
    }
    return {
      kind: 'internal_service',
      authorization: `Bearer ${serviceRoleKey}`,
    }
  }

  if (serviceRoleAllowlist.has(functionName)) {
    return { kind: 'unauthorized_internal', authorization: null }
  }

  return { kind: 'none', authorization: null }
}
