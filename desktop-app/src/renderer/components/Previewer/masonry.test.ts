import {describe, expect, it} from 'vitest';
import {packMasonry} from './masonry';

const item = (id: string, width: number, height: number) => ({id, width, height});

describe('packMasonry', () => {
  it('handles an empty list', () => {
    const result = packMasonry([], 1000, 16);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.placements.size).toBe(0);
  });

  it('places a single item at the origin', () => {
    const result = packMasonry([item('a', 200, 100)], 1000, 16);
    expect(result.columns).toBe(1);
    expect(result.placements.get('a')).toEqual({left: 0, top: 0});
    expect(result.width).toBe(200);
  });

  it('uses as many columns as fit the container', () => {
    const items = [item('a', 300, 100), item('b', 300, 100), item('c', 300, 100)];
    const wide = packMasonry(items, 1024, 16);
    expect(wide.columns).toBe(3);
    // Too narrow for 3 columns (3*300 + 2*16 = 932 > 640)
    const narrow = packMasonry(items, 640, 16);
    expect(narrow.columns).toBe(2);
    expect(narrow.width).toBeLessThanOrEqual(640);
  });

  it('stacks into the shortest column first', () => {
    const items = [item('tall', 200, 400), item('a', 200, 100), item('b', 200, 100)];
    const result = packMasonry(items, 450, 16);
    // 2 columns fit (2*200+16 <= 450), 3 do not (3*200+32 > 450)
    expect(result.columns).toBe(2);
    expect(result.placements.get('a')!.top).toBe(0);
    expect(result.placements.get('b')!.top).toBe(116);
    expect(result.placements.get('a')!.left).toBeGreaterThan(0);
  });

  it('centers narrower items within their column', () => {
    const items = [item('wide', 400, 100), item('narrow', 100, 300)];
    const result = packMasonry(items, 420, 16);
    expect(result.columns).toBe(1);
    expect(result.placements.get('narrow')!.left).toBe(150);
  });

  it('falls back to a single column when nothing fits', () => {
    const items = [item('huge', 2000, 500), item('huge2', 2000, 500)];
    const result = packMasonry(items, 800, 16);
    expect(result.columns).toBe(1);
    expect(result.height).toBe(1016);
  });
});
