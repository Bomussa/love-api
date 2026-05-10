const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(www\.)?mmc-mms\.com$/,
  /^https:\/\/staging\.mmc-mms\.com$/,
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
];

const ROUTE_CATEGORIES = {
  status: {
    methods: 'GET, OPTIONS',
    headers: 'Content-Type, Authorization, apikey, x-client-info',
  },
  write: {
    methods: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    headers: 'Content-Type, Authorization, apikey, x-client-info, x-requested-with',
  },
};

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export function resolveCorsHeaders({ origin, category = 'write' } = {}) {
  const policy = ROUTE_CATEGORIES[category] || ROUTE_CATEGORIES.write;
  const headers = {
    'Access-Control-Allow-Methods': policy.methods,
    'Access-Control-Allow-Headers': policy.headers,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}
