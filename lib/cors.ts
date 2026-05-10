import { resolveCorsHeaders } from './cors-policy.js';

export function withCors(handler, { category = 'write' } = {}) {
  return async (req, res) => {
    const corsHeaders = resolveCorsHeaders({ origin: req.headers.origin, category });
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    return handler(req, res);
  };
}
