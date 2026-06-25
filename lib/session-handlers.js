import { initializeKVStores } from './supabase-enhanced.js';
import { parseBody, setCorsHeaders, formatError, formatSuccess, handleError } from './helpers-enhanced.js';

const { KV_ADMIN } = initializeKVStores(process.env);

function getPathname(req) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `https://${host}`);
  return { pathname: url.pathname, query: Object.fromEntries(url.searchParams) };
}

async function readBody(req) {
  if (req._mmcParsedBody && typeof req._mmcParsedBody === 'object') {
    return req._mmcParsedBody;
  }
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  return parseBody(req);
}

function getToken(body, query) {
  return String(
    body?.token ||
    body?.sessionId ||
    body?.session_id ||
    query?.token ||
    query?.sessionId ||
    query?.session_id ||
    ''
  ).trim();
}

function isExpired(session) {
  if (!session?.expiresAt) return false;
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { pathname, query } = getPathname(req);

    if (req.method !== 'POST') {
      return res.status(405).json(formatError('Method not allowed', 'METHOD_NOT_ALLOWED'));
    }

    const body = await readBody(req);
    const token = getToken(body, query);

    if (!token) {
      return res.status(400).json(formatError('Missing session token', 'MISSING_TOKEN'));
    }

    const sessionKey = `session:${token}`;
    const session = await KV_ADMIN.get(sessionKey, 'json');

    if (pathname === '/api/v1/session/validate') {
      if (!session) {
        return res.status(404).json(formatError('Session not found', 'SESSION_NOT_FOUND'));
      }

      if (isExpired(session)) {
        return res.status(410).json(formatError('Session expired', 'SESSION_EXPIRED'));
      }

      return res.status(200).json(formatSuccess({
        valid: true,
        sessionId: token,
        session: {
          sessionId: token,
          personalId: session.personalId || session.personal_id || null,
          gender: session.gender || null,
          createdAt: session.createdAt || null,
          expiresAt: session.expiresAt || null,
          device: session.device || null,
          deviceRegisteredAt: session.deviceRegisteredAt || null,
        },
      }, 'Session validated'));
    }

    if (pathname === '/api/v1/session/device') {
      const device = String(body?.device || '').trim();
      if (!device) {
        return res.status(400).json(formatError('Missing device', 'MISSING_DEVICE'));
      }

      if (!session) {
        return res.status(404).json(formatError('Session not found', 'SESSION_NOT_FOUND'));
      }

      if (isExpired(session)) {
        return res.status(410).json(formatError('Session expired', 'SESSION_EXPIRED'));
      }

      const updatedSession = {
        ...session,
        device,
        deviceRegisteredAt: new Date().toISOString(),
      };

      await KV_ADMIN.put(sessionKey, updatedSession);

      return res.status(200).json(formatSuccess({
        registered: true,
        sessionId: token,
        device,
      }, 'Device registered'));
    }

    return res.status(404).json(formatError(`Endpoint ${pathname} not found`, 'NOT_FOUND'));
  } catch (error) {
    return handleError(error, res);
  }
}
