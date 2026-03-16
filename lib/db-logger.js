export function logDbFailure(code, context = {}, error = null) {
  const entry = {
    level: 'error',
    category: 'db',
    code,
    context,
    timestamp: new Date().toISOString(),
    error: error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : null,
  };

  console.error('[DB_FAILURE]', entry);
}

export function createDbOperationError(code, message, cause = null, statusCode = 503) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  if (cause) err.cause = cause;
  return err;
}
