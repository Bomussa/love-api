export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

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
