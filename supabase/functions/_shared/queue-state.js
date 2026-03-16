export const QUEUE_STATE_ORDER = ['waiting', 'called', 'in_service', 'completed'];

export const LEGACY_QUEUE_STATE_MAP = {
  serving: 'in_service',
  in_progress: 'in_service',
  done: 'completed',
  skipped: 'completed',
};

export function normalizeQueueState(value) {
  if (!value) return value;
  return LEGACY_QUEUE_STATE_MAP[value] ?? value;
}

export function isQueueState(value) {
  return QUEUE_STATE_ORDER.includes(value);
}

export function assertQueueState(value, context = 'queue state') {
  const normalized = normalizeQueueState(value);
  if (!isQueueState(normalized)) {
    throw new Error(`Invalid ${context}: ${value}`);
  }
  return normalized;
}

export function assertQueueTransition(fromState, toState, context = 'queue transition') {
  const from = assertQueueState(fromState, `${context} from_state`);
  const to = assertQueueState(toState, `${context} to_state`);
  const fromIndex = QUEUE_STATE_ORDER.indexOf(from);
  const toIndex = QUEUE_STATE_ORDER.indexOf(to);

  if (toIndex !== fromIndex + 1) {
    throw new Error(`Invalid ${context}: ${from} -> ${to}`);
  }

  return { from, to };
}

export function summarizeQueueRows(rows = []) {
  const counts = {
    waiting: 0,
    called: 0,
    in_service: 0,
    completed: 0,
    total: rows.length,
  };

  for (const row of rows) {
    const normalized = assertQueueState(row.status, 'row.status');
    counts[normalized] += 1;
  }

  return counts;
}
