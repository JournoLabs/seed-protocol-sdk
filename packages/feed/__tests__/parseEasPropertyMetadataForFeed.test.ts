import { describe, it, expect } from 'vitest';
import { parseEasPropertyMetadataForFeed } from '../src/parseEasPropertyMetadataForFeed';

describe('parseEasPropertyMetadataForFeed', () => {
  it('returns empty for blank, whitespace-only, null, undefined, non-string', () => {
    expect(parseEasPropertyMetadataForFeed('')).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(parseEasPropertyMetadataForFeed('   \t\n')).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(parseEasPropertyMetadataForFeed(null)).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(parseEasPropertyMetadataForFeed(undefined)).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(parseEasPropertyMetadataForFeed(123 as unknown as string)).toEqual(
      {
        ok: false,
        reason: 'empty',
      },
    );
  });

  it('returns parse for invalid JSON', () => {
    const r = parseEasPropertyMetadataForFeed('{');
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'parse') {
      expect(r.error).toBeDefined();
    } else {
      expect.fail('expected parse failure');
    }
  });

  it('returns shape for empty array, missing value, null value', () => {
    expect(parseEasPropertyMetadataForFeed('[]')).toEqual({
      ok: false,
      reason: 'shape',
    });
    expect(parseEasPropertyMetadataForFeed('[{}]')).toEqual({
      ok: false,
      reason: 'shape',
    });
    expect(
      parseEasPropertyMetadataForFeed('[{"value":null}]'),
    ).toEqual({
      ok: false,
      reason: 'shape',
    });
    expect(parseEasPropertyMetadataForFeed('[{"name":"x"}]')).toEqual({
      ok: false,
      reason: 'shape',
    });
  });

  it('returns metadata for valid EAS-style decoded payload', () => {
    const payload = JSON.stringify([
      { value: { name: 'title', value: 'Hello', type: 'string' } },
    ]);
    expect(parseEasPropertyMetadataForFeed(payload)).toEqual({
      ok: true,
      metadata: { name: 'title', value: 'Hello', type: 'string' },
    });
  });

  it('trims outer whitespace before parse', () => {
    const inner = JSON.stringify([
      { value: { name: 'x', value: 'y' } },
    ]);
    expect(parseEasPropertyMetadataForFeed(`  ${inner}  `)).toEqual({
      ok: true,
      metadata: { name: 'x', value: 'y' },
    });
  });
});
