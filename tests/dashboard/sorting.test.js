import { describe, it, expect } from 'vitest';
import {
  discordPosition,
  compareDiscordNames,
  compareDiscordIds,
  dashboardChannelSortBucket,
  compareDiscordRoleHierarchy,
  compareTopLevelDashboardChannels,
  compareDashboardCategoryChildren,
  compareDashboardChannelRows,
  withDashboardDisplayOrder
} from '../../src/dashboard/sorting.js';

describe('discordPosition', () => {
  it('returns rawPosition when available', () => {
    expect(discordPosition({ rawPosition: 5 })).toBe(5);
  });

  it('falls back to position', () => {
    expect(discordPosition({ position: 3 })).toBe(3);
  });

  it('uses default fallback', () => {
    expect(discordPosition({})).toBe(0);
    expect(discordPosition(null, 10)).toBe(10);
  });
});

describe('compareDiscordNames', () => {
  it('sorts alphabetically with numeric awareness', () => {
    const names = [{ name: 'ch2' }, { name: 'ch10' }, { name: 'ch1' }];
    names.sort(compareDiscordNames);
    expect(names.map(n => n.name)).toEqual(['ch1', 'ch2', 'ch10']);
  });

  it('handles missing names', () => {
    expect(compareDiscordNames({}, { name: 'a' })).toBeLessThan(0);
  });
});

describe('compareDiscordIds', () => {
  it('sorts numeric IDs as BigInt', () => {
    const items = [{ id: '9' }, { id: '10' }, { id: '2' }];
    items.sort(compareDiscordIds);
    expect(items.map(i => i.id)).toEqual(['2', '9', '10']);
  });

  it('handles non-numeric IDs', () => {
    expect(compareDiscordIds({ id: 'abc' }, { id: 'abd' })).toBeLessThan(0);
  });
});

describe('dashboardChannelSortBucket', () => {
  it('returns 0 for categories', () => {
    expect(dashboardChannelSortBucket({ type: 4 })).toBe(0);
    expect(dashboardChannelSortBucket({ isCategory: true })).toBe(0);
  });

  it('returns 1 for text channels', () => {
    expect(dashboardChannelSortBucket({ type: 0 })).toBe(1);
  });

  it('returns 2 for threads', () => {
    expect(dashboardChannelSortBucket({ isThread: true })).toBe(2);
  });

  it('returns 10 for voice channels', () => {
    expect(dashboardChannelSortBucket({ type: 2 })).toBe(10);
  });
});

describe('compareDashboardChannelRows', () => {
  it('sorts root channels before categories', () => {
    const root = { id: '1', parentId: null, rawPosition: 0 };
    const cat = { id: '2', isCategory: true, rawPosition: 1 };
    const rows = [cat, root];
    rows.sort(compareDashboardChannelRows);
    expect(rows[0].id).toBe('1');
  });

  it('sorts children under their parent category', () => {
    const cat = { id: 'cat1', isCategory: true, rawPosition: 0 };
    const child1 = { id: 'ch1', parentId: 'cat1', rawPosition: 0, categoryPosition: 0 };
    const child2 = { id: 'ch2', parentId: 'cat1', rawPosition: 1, categoryPosition: 0 };
    const rows = [child2, child1, cat];
    rows.sort(compareDashboardChannelRows);
    expect(rows.map(r => r.id)).toEqual(['cat1', 'ch1', 'ch2']);
  });
});

describe('withDashboardDisplayOrder', () => {
  it('deduplicates rows by id', () => {
    const rows = [
      { id: '1', rawPosition: 0 },
      { id: '1', rawPosition: 0 }
    ];
    const result = withDashboardDisplayOrder(rows);
    expect(result).toHaveLength(1);
  });

  it('sorts root channels first, then categories with children', () => {
    const root = { id: 'root1', rawPosition: 0 };
    const cat = { id: 'cat1', isCategory: true, rawPosition: 1 };
    const child = { id: 'ch1', parentId: 'cat1', rawPosition: 0, categoryPosition: 1 };
    const result = withDashboardDisplayOrder([child, cat, root]);
    expect(result.map(r => r.id)).toEqual(['root1', 'cat1', 'ch1']);
  });

  it('assigns displayOrder', () => {
    const rows = [{ id: 'a', rawPosition: 1 }, { id: 'b', rawPosition: 0 }];
    const result = withDashboardDisplayOrder(rows);
    expect(result[0].displayOrder).toBe(0);
    expect(result[1].displayOrder).toBe(1);
  });
});
