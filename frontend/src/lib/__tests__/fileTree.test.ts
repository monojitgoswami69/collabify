import { describe, it, expect } from 'vitest';
import { buildTree } from '../fileTree';
import type { StoredFile } from '../../services/storageService';

const mk = (id: string, name: string, repo?: { owner: string; repo: string; branch: string }, path?: string): StoredFile => ({
  id,
  name,
  content: '',
  language: '',
  lastModified: 0,
  ...(repo ? { repoOrigin: repo, path: path ?? name } : {}),
});

function collectIds(node: ReturnType<typeof buildTree>): string[] {
  const ids: string[] = [];
  const walk = (n: { fileId?: string; children: Map<string, any> }) => {
    if (n.fileId) ids.push(n.fileId);
    n.children.forEach(walk);
  };
  walk(node);
  return ids.sort();
}

describe('buildTree', () => {
  it('every file is reachable as exactly one leaf', () => {
    const tree = buildTree([mk('a', 'foo.txt'), mk('b', 'bar.ts'), mk('c', 'src/app.ts')]);
    expect(collectIds(tree)).toEqual(['a', 'b', 'c']);
  });

  it('duplicate local names disambiguate instead of shadowing', () => {
    const tree = buildTree([mk('a', 'foo.txt'), mk('b', 'foo.txt')]);
    expect(collectIds(tree)).toEqual(['a', 'b']);
    expect(tree.children.size).toBe(2); // two distinct leaves
  });

  it('same basename in different directories does not collide', () => {
    const tree = buildTree([mk('a', 'README.md', { owner: 'o', repo: 'r', branch: 'main' }), mk('b', 'README.md', { owner: 'o', repo: 'r2', branch: 'main' })]);
    expect(collectIds(tree)).toEqual(['a', 'b']);
  });

  it('a local snippet named like a repo owner does not hide the repo subtree', () => {
    const files = [mk('local', 'alice'), mk('repo1', 'x.ts', { owner: 'alice', repo: 'beta', branch: 'main' })];
    expect(collectIds(buildTree(files)).sort()).toEqual(['local', 'repo1']);
    expect(collectIds(buildTree([...files].reverse())).sort()).toEqual(['local', 'repo1']);
  });

  it('dir/leaf/dir chains keep every file reachable in all insertion orders', () => {
    const files = [mk('1', 'a/b/c.txt'), mk('2', 'a'), mk('3', 'a/b'), mk('4', 'a/b/d.txt')];
    const permutations = [files, [files[1], files[0], files[2], files[3]], [files[3], files[2], files[1], files[0]]];
    for (const perm of permutations) {
      expect(collectIds(buildTree(perm)).sort()).toEqual(['1', '2', '3', '4']);
    }
  });

  it('many-dot names and dotfiles terminate and stay distinct', () => {
    const tree = buildTree([mk('a', 'a.b.c.d.txt'), mk('b', 'a.b.c.d.txt'), mk('c', '.hidden'), mk('d', '.hidden')]);
    expect(collectIds(tree)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('same repo imported twice keeps both leaves reachable', () => {
    const repo = { owner: 'o', repo: 'r', branch: 'main' };
    const tree = buildTree([mk('a', 'x.ts', repo), mk('b', 'x.ts', repo)]);
    expect(collectIds(tree)).toEqual(['a', 'b']);
  });

  it('repo folder node carries the delete affordance (isRepoFolder)', () => {
    const tree = buildTree([mk('a', 'x.ts', { owner: 'octo', repo: 'alpha', branch: 'main' })]);
    const octo = tree.children.get('octo')!;
    expect(octo.isDir).toBe(true);
    const alpha = octo.children.get('alpha')!;
    expect(alpha.isRepoFolder).toBe(true);
    expect(octo.isRepoFolder).toBeFalsy();
  });

  it('handles 1000 duplicates without hanging and stays unique', () => {
    const files = Array.from({ length: 1000 }, (_, i) => mk(`f${i}`, 'same.txt'));
    const tree = buildTree(files);
    expect(collectIds(tree).length).toBe(1000);
  });
});
