import { describe, it, expect } from 'vitest';
import { computePatch, previewPatch } from '../agentTools';

const base = 'const a = 1;\nconst b = 2;\nfunction hi() {\n  return "x";\n}\n';

describe('computePatch (the agent edit engine)', () => {
  it('applies a unique-match replace', () => {
    const r = computePatch(base, [{ find: 'const b = 2;', replace: 'const b = 42;' }]);
    expect(r.ok && r.content.includes('const b = 42;')).toBe(true);
  });

  it('fails on find-text not found', () => {
    expect(computePatch(base, [{ find: 'zzz', replace: 'q' }]).ok).toBe(false);
  });

  it('fails on ambiguous find-text (2+ matches)', () => {
    const r = computePatch(base, [{ find: 'const', replace: 'let' }]);
    expect(!r.ok && /MULTIPLE/.test(r.error)).toBe(true);
  });

  it('empty find appends at the end', () => {
    const r = computePatch(base, [{ find: '', replace: 'const c = 3;' }]);
    expect(r.ok && r.content.endsWith('\nconst c = 3;')).toBe(true);
  });

  it('empty find appends to an empty file without a leading newline', () => {
    const r = computePatch('', [{ find: '', replace: 'new' }]);
    expect(r.ok && r.content === 'new').toBe(true);
  });

  it('applies sequential edits against accumulated content', () => {
    const r = computePatch(base, [
      { find: 'const a = 1;', replace: 'const a = 0;' },
      { find: 'return "x";', replace: 'return "y";' },
    ]);
    expect(r.ok && r.content.includes('const a = 0;') && r.content.includes('return "y";')).toBe(true);
  });

  it('is all-or-nothing: a failing edit leaves nothing applied', () => {
    const r = computePatch(base, [{ find: 'const a = 1;', replace: 'x' }, { find: 'zzz', replace: 'y' }]);
    expect(r.ok).toBe(false);
  });

  it('second edit can target the first edit’s output', () => {
    const r = computePatch(base, [
      { find: 'const b = 2;', replace: 'const b = 2;\nconst c = 3;' },
      { find: 'const c = 3;', replace: 'const c = 4;' },
    ]);
    expect(r.ok && r.content.includes('const c = 4;')).toBe(true);
  });
});

describe('previewPatch', () => {
  it('returns before/after without mutating', () => {
    const p = previewPatch(base, [{ find: 'const a = 1;', replace: 'const a = 2;' }]);
    expect(p?.before).toBe(base);
    expect(p?.after).toContain('const a = 2;');
  });

  it('returns null for a failing patch', () => {
    expect(previewPatch(base, [{ find: 'nope', replace: 'x' }])).toBeNull();
  });
});
