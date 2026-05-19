/**
 * V1 API Entry Point - Serverless Router
 * 
 * @module api/v1
 * @description Main router for the Military Medical Committee API (v1).
 * Handles routing, body parsing, and global error handling.
 */

import handler from '../lib/api-handlers.js';
import { parseBody, setCorsHeaders, handleError } from '../lib/helpers-enhanced.js';

/**
 * Main Serverless Function Handler
 */
export default async function (req, res) {
  try {
    // 1. Set global CORS headers
    setCorsHeaders(res, req);

    // 2. Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // 3. Pre-parse body for handlers if not already parsed
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      try {
        req._mmcParsedBody = await parseBody(req);
      } catch (e) {
        console.error('[V1_ROUTER] Body parse warning:', e.message);
      }
    }

    // 4. Delegate to the main API handler
    return await handler(req, res);

  } catch (error) {
    console.error('[V1_ROUTER] Fatal Error:', error);
    return handleError(error, res);
  }
}
