// Single source of the display-name -> developer-icon mapping, shared by the
// file tree (FileExplorer) and the status bar (EditorView). One copy — no drift.
import type { ComponentType } from 'react';
import {
  JavaScript,
  TypeScript,
  Python,
  CPlusPlus,
  C,
  Java,
  Go,
  RustDark,
  Ruby,
  PHP,
} from 'developer-icons';

export type LangIconComponent = ComponentType<{ size?: number; color?: string }>;

export const langIconMap: Record<string, LangIconComponent> = {
  JavaScript,
  TypeScript,
  Python,
  'C++': CPlusPlus,
  C,
  Java,
  Go,
  Rust: RustDark,
  Ruby,
  PHP,
};
