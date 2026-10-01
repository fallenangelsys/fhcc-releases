import { describe, it, expect } from 'vitest';
import { finiteInteger, clone, resolveAvatarUrl, resolveAvatarFromHash } from '../../src/runtime/utils.js';

describe('finiteInteger', () => {
  it('returns the integer part of a valid number', () => {
    expect(finiteInteger(3.7)).toBe(3);
    expect(finiteInteger('42')).toBe(42);
  });

  it('clamps to minimum and maximum', () => {
    expect(finiteInteger(-5, 0, 0, 100)).toBe(0);
    expect(finiteInteger(200, 0, 0, 100)).toBe(100);
  });

  it('returns fallback for non-finite values', () => {
    expect(finiteInteger(NaN)).toBe(0);
    expect(finiteInteger(undefined, 99)).toBe(99);
    expect(finiteInteger('hello', 7)).toBe(7);
  });

  it('handles edge cases', () => {
    expect(finiteInteger(Infinity, 0, 0, 100)).toBe(0);
    expect(finiteInteger('hello', 5)).toBe(5);
  });
});

describe('clone', () => {
  it('deep-clones a plain object', () => {
    const original = { a: 1, b: { c: 2 } };
    const copy = clone(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.b).not.toBe(original.b);
  });

  it('deep-clones arrays', () => {
    const original = [1, [2, 3]];
    const copy = clone(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
  });

  it('handles null and primitives', () => {
    expect(clone(null)).toBeNull();
    expect(clone(42)).toBe(42);
    expect(clone('hello')).toBe('hello');
  });
});

describe('resolveAvatarUrl', () => {
  it('returns empty string for missing user', () => {
    expect(resolveAvatarUrl(null)).toBe('');
    expect(resolveAvatarUrl({})).toBe('');
  });

  it('uses displayAvatarURL when available', () => {
    const entity = {
      user: {
        id: '123',
        displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/123/abc.png'
      }
    };
    expect(resolveAvatarUrl(entity)).toBe('https://cdn.discordapp.com/avatars/123/abc.png');
  });

  it('builds avatar URL from user avatar hash', () => {
    const entity = { id: '456', avatar: 'abc123' };
    const url = resolveAvatarUrl(entity, { size: 256 });
    expect(url).toContain('456');
    expect(url).toContain('abc123.png');
    expect(url).toContain('size=256');
  });

  it('uses gif for animated avatars', () => {
    const entity = { id: '789', avatar: 'a_abc123' };
    const url = resolveAvatarUrl(entity);
    expect(url).toContain('a_abc123.gif');
  });

  it('builds guild avatar URL when entity has guild', () => {
    const entity = {
      user: { id: '111' },
      avatar: 'guild_abc',
      guild: { id: '999' }
    };
    const url = resolveAvatarUrl(entity);
    expect(url).toContain('/guilds/999/');
    expect(url).toContain('guild_abc.png');
  });
});

describe('resolveAvatarFromHash', () => {
  it('returns null for missing inputs', () => {
    expect(resolveAvatarFromHash(null, 'hash')).toBeNull();
    expect(resolveAvatarFromHash('123', '')).toBeNull();
    expect(resolveAvatarFromHash('123', null)).toBeNull();
  });

  it('builds correct avatar URL', () => {
    const url = resolveAvatarFromHash('123', 'abc123', { size: 512 });
    expect(url).toBe('https://cdn.discordapp.com/avatars/123/abc123.png?size=512');
  });

  it('detects animated hashes', () => {
    const url = resolveAvatarFromHash('123', 'a_abc123');
    expect(url).toContain('a_abc123.gif');
  });

  it('clamps size to valid range', () => {
    const url = resolveAvatarFromHash('123', 'abc', { size: 10000 });
    expect(url).toContain('size=4096');

    const url2 = resolveAvatarFromHash('123', 'abc', { size: 4 });
    expect(url2).toContain('size=16');
  });
});
