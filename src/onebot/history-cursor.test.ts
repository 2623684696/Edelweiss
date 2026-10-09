import { describe, expect, it } from 'vitest';

import { createHistoryCursor } from './history-cursor';

describe('history cursor', () => {
  it('stops when the cursor does not advance', () => {
    const cursor = createHistoryCursor('10');
    expect(cursor.advance('10')).toBe(false);
  });

  it('stops repeated pages and cursor cycles', () => {
    const cursor = createHistoryCursor(undefined);
    expect(cursor.advance('20')).toBe(true);
    expect(cursor.advance('30')).toBe(true);
    expect(cursor.advance('20')).toBe(false);
  });

  it('allows distinct cursors but bounds the number of pages', () => {
    const cursor = createHistoryCursor('10', 3);
    expect(cursor.advance('20')).toBe(true);
    expect(cursor.advance('30')).toBe(true);
    expect(cursor.advance('40')).toBe(false);
  });
});
