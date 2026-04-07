import { describe, it, expect } from 'vitest';
import { QUEUE_STATUS, invokeRpcSafe } from '../api/v1.js';

describe('api/v2 compatibility', () => {
  it('keeps unified status values', () => {
    expect(QUEUE_STATUS.WAITING).toBe('WAITING');
    expect(QUEUE_STATUS.DONE).toBe('DONE');
  });

  it('returns missing RPC marker for undefined function', async () => {
    const supabase = {
      rpc: async () => ({ data: null, error: { code: '42883', message: 'function does not exist' } }),
    };

    const result = await invokeRpcSafe(supabase as any, 'missing_fn', {});
    expect(result.ok).toBe(false);
    expect(result.missing).toBe(true);
  });
});
