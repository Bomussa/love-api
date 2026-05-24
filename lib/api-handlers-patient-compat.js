/**
 * Patient session compatibility wrapper.
 *
 * Purpose:
 * - Preserve the existing API handler contract.
 * - Recover from frontend callers that send patientId/personalId
 *   instead of the generated sessionId when entering the queue.
 * - Avoid changing the main API handler logic in a large file.
 */

import mainHandler from './api-handlers.js';
import { initializeKVStores } from './supabase-enhanced.js';

const { KV_ADMIN } = initializeKVStores(process.env);

function getBody(req) {
  return req?._mmcParsedBody && typeof req._mmcParsedBody === 'object'
    ? req._mmcParsedBody
    : (req?.body && typeof req.body === 'object' ? req.body : {});
}

function setBody(req, nextBody) {
  req._mmcParsedBody = nextBody;
  req.body = nextBody;
}

function normalize(value) {
  return String(value || '').trim();
}

async function findSessionIdFromPatientIdentifiers(body) {
  const directCandidates = [
    body.sessionId,
    body.session_id,
    body.user,
    body.patientId,
    body.patient_id,
    body.personalId,
    body.personal_id,
  ].map(normalize).filter(Boolean);

  // 1) If any candidate is already a valid session key, use it.
  for (const candidate of directCandidates) {
    const existing = await KV_ADMIN.get(`session:${candidate}`);
    if (existing) return candidate;
  }

  // 2) Scan session records for a matching personalId / patientId.
  const { keys } = await KV_ADMIN.list();
  const sessionKeys = (keys || [])
    .map((entry) => normalize(entry?.name))
    .filter((key) => key.startsWith('session:'));

  for (const key of sessionKeys) {
    const sessionId = key.replace(/^session:/, '');
    const session = await KV_ADMIN.get(key, 'json');
    const personalId = normalize(session?.personalId || session?.personal_id);
    if (!personalId) continue;

    if (directCandidates.some((candidate) => candidate === personalId)) {
      return sessionId;
    }
  }

  return null;
}

async function repairQueueEnterBody(req) {
  const body = getBody(req);
  if (!body || typeof body !== 'object') return;

  const pathname = (() => {
    try {
      const host = req.headers?.host || 'localhost';
      return new URL(req.url, `https://${host}`).pathname;
    } catch {
      return '';
    }
  })();

  if (pathname !== '/api/v1/queue/enter' || req.method !== 'POST') return;

  const currentSessionId = normalize(body.sessionId);
  if (currentSessionId) {
    const session = await KV_ADMIN.get(`session:${currentSessionId}`);
    if (session) return; // already valid
  }

  const resolvedSessionId = await findSessionIdFromPatientIdentifiers(body);
  if (resolvedSessionId) {
    setBody(req, {
      ...body,
      sessionId: resolvedSessionId,
    });
  }
}

export default async function patientCompatHandler(req, res) {
  await repairQueueEnterBody(req);
  return mainHandler(req, res);
}
