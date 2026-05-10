/**
 * Canonical queue operation contract used across API clients and adapters.
 */
export const QUEUE_CANONICAL_OPERATIONS = Object.freeze({
  status: { operation: 'queue_status', path: '/queue/status', functionName: 'queue-status' },
  enter: { operation: 'queue_enter', path: '/queue/enter', functionName: 'queue-enter' },
  call: { operation: 'queue_call', path: '/queue/call', functionName: 'call-next-patient' },
  pinVerify: { operation: 'pin_verify', path: '/pin/verify', functionName: 'call-next-patient' },
});

export function queueCanonicalPath(apiVersion, operation) {
  return `${apiVersion}${operation.path}`;
}
