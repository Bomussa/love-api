import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import db, { NotImplementedError, LEGACY_EMPTY_READ_MODE } from './db.js';

describe('KVDatabaseAdapter', () => {
  beforeEach(() => {
    db.init(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws NotImplementedError when backend is unavailable and no compatibility flags are set', async () => {
    await expect(db.query('SELECT 1')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('returns empty rows for legacy tolerant read query when backend is unavailable', async () => {
    const result = await db.queryLegacyTolerant('SELECT * FROM patients');
    expect(result).toEqual({ rows: [] });
  });

  it('rejects legacy tolerant wrapper for write query', async () => {
    await expect(db.queryLegacyTolerant('INSERT INTO patients VALUES ($1)', ['x'])).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it('returns empty rows when ALL compatibility mode is explicitly requested', async () => {
    const result = await db.query('UPDATE patients SET name = $1', ['n'], {
      allowEmptyReadFallback: true,
      emptyReadMode: LEGACY_EMPTY_READ_MODE.ALL,
    });
    expect(result).toEqual({ rows: [] });
  });

  it('emits telemetry for adapter calls', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(db.query('SELECT 1')).rejects.toBeInstanceOf(NotImplementedError);

    expect(warnSpy).toHaveBeenCalledWith(
      '[db][legacy]',
      expect.objectContaining({
        adapter: 'KVDatabaseAdapter',
        event: 'legacy_db_query',
      }),
    );
  });
});
