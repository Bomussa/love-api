import crypto from 'node:crypto';

const MIN_SECRET_LENGTH = 32;

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function parseJsonBase64Url(value) {
  return JSON.parse(decodeBase64Url(value));
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

export function hasValidAdminSecret(secret) {
  return typeof secret === 'string' && secret.trim().length >= MIN_SECRET_LENGTH;
}

export function createAdminToken(admin, secret, nowMs = Date.now()) {
  if (!hasValidAdminSecret(secret)) {
    throw new Error('ADMIN_AUTH_SECRET is not configured securely');
  }

  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({
    sub: admin.id,
    username: admin.username,
    role: admin.role || 'admin',
    exp: Math.floor(nowMs / 1000) + (24 * 60 * 60),
  }));

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

export function verifyAdminBearerToken(authorizationHeader, secret, nowMs = Date.now()) {
  if (!hasValidAdminSecret(secret) || typeof authorizationHeader !== 'string') {
    return false;
  }

  const [scheme, rawToken] = authorizationHeader.trim().split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !rawToken) {
    return false;
  }

  const token = rawToken.trim();
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (expectedSignature.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return false;
  }

  try {
    const decodedHeader = parseJsonBase64Url(header);
    if (decodedHeader?.alg !== 'HS256' || decodedHeader?.typ !== 'JWT') {
      return false;
    }

    const decodedPayload = parseJsonBase64Url(payload);
    if (!decodedPayload?.sub || !decodedPayload?.exp) {
      return false;
    }

    const expMillis = decodedPayload.exp < 1_000_000_000_000
      ? decodedPayload.exp * 1000
      : decodedPayload.exp;

    return nowMs <= expMillis;
  } catch {
    return false;
  }
}
