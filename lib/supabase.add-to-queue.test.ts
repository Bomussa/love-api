import { describe, it, expect, vi } from 'vitest';
import { addToQueue } from './supabase.js';

describe('addToQueue atomic RPC path', () => {
  it('uses add_to_queue_atomic RPC and returns row', async () => {
    const mockRow = { id: 'q1', clinic_id: 'c1', display_number: 1 };
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
    } as any;

    const result = await addToQueue(supabase, { patient_id: 'p1', clinic_id: 'c1' });

    expect(result).toEqual(mockRow);
    expect(supabase.rpc).toHaveBeenCalledWith('add_to_queue_atomic', {
      p_patient_id: 'p1',
      p_clinic_id: 'c1',
      p_exam_type: null,
      p_is_priority: false,
      p_priority_reason: null,
    });
  });

  it('retries on unique-violation conflict and succeeds', async () => {
    const supabase = {
      rpc: vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
        .mockResolvedValueOnce({ data: { id: 'q2', display_number: 2 }, error: null }),
    } as any;

    const result = await addToQueue(supabase, { patient_id: 'p2', clinic_id: 'c1' });
    expect(result).toEqual({ id: 'q2', display_number: 2 });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  it('fails after conflict retries are exhausted', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } }),
    } as any;

    await expect(addToQueue(supabase, { patient_id: 'p3', clinic_id: 'c1' })).rejects.toThrow('Failed to add to queue');
    expect(supabase.rpc).toHaveBeenCalledTimes(3);
  });

  it('prevents duplicates under concurrent calls by relying on DB atomic RPC', async () => {
    let counter = 0;
    const supabase = {
      rpc: vi.fn().mockImplementation(async () => {
        counter += 1;
        return { data: { id: `q-${counter}`, clinic_id: 'c1', display_number: counter }, error: null };
      }),
    } as any;

    const calls = Array.from({ length: 25 }, (_, i) => addToQueue(supabase, { patient_id: `p${i}`, clinic_id: 'c1' }));
    const rows = await Promise.all(calls);
    const numbers = rows.map((r) => r.display_number);
    expect(new Set(numbers).size).toBe(rows.length);
  });
});
