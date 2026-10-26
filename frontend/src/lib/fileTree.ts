// Workspace file tree builder — pure logic, extracted for testing.
import type { StoredFile } from '@/services/storageService';

export interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  fileId?: string;
  isDir: boolean;
  repoKey?: string;
  /** True on the `owner/repo` folder node — carries the delete affordance. */
  isRepoFolder?: boolean;
  language?: string;
}

export function buildTree(files: StoredFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), isDir: true };

  // Same-path nodes with different roles must never share a tree node:
  // leaf-vs-leaf (upload twice) hid the earlier file, and leaf-vs-dir (a
  // local snippet named like a repo's owner) hid the whole subtree.
  const usedPaths = new Map<string, 'dir' | 'leaf'>();

  for (const file of files) {
    const groupName = file.repoOrigin
      ? `${file.repoOrigin.owner}/${file.repoOrigin.repo}`
      : '';
    const filePath = file.path || file.name;
    const baseFullPath = groupName ? `${groupName}/${filePath}` : filePath;
    const parts: string[] = [];
    const baseParts = baseFullPath.split('/');
    const repoFolderIndex = groupName ? groupName.split('/').length - 1 : -1;
    for (let i = 0; i < baseParts.length; i++) {
      const isLast = i === baseParts.length - 1;
      const role = isLast ? 'leaf' : 'dir';
      let part = baseParts[i]!;
      let prefix = parts.length ? `${parts.join('/')}/` : '';
      let candidate = `${prefix}${part}`;
      // Directory prefixes are shared between files with the same path; a
      // leaf NEVER shares its exact path (same-name files used to overwrite
      // each other's node, and a leaf/dir clash hid a whole subtree). The
      // occupancy check re-reads the map EVERY iteration — a captured value
      // made this loop spin forever on the first collision.
      for (let n = 2; ; n++) {
        const occupied = usedPaths.get(candidate);
        if (occupied === undefined || (role === 'dir' && occupied === 'dir')) break;
        const dot = part.lastIndexOf('.');
        const stem = dot > 0 ? part.slice(0, dot) : part;
        const ext = dot > 0 ? part.slice(dot) : '';
        candidate = `${prefix}${stem} (${n})${ext}`;
      }
      usedPaths.set(candidate, role);
      parts.push(candidate.slice(prefix.length));
    }
    const fullPath = parts.join('/');

    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
          isDir: !isLast,
          repoKey: groupName || undefined,
          isRepoFolder: groupName ? i === repoFolderIndex : undefined,
        });
      }

      const node = current.children.get(part)!;
      if (isLast) {
        node.fileId = file.id;
        node.isDir = false;
        node.language = file.language;
      }
      current = node;
    }
  }

  return root;
}
