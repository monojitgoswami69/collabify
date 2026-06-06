'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 240;

interface UseSashResizeReturn {
  sidebarWidth: number;
  rootRef: React.RefObject<HTMLDivElement | null>;
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  handleResizeStart: (clientX: number) => void;
  handleResize: (clientX: number) => void;
  handleResizeEnd: () => void;
  setExternalResizeActive: (active: boolean) => void;
}

export function useSashResize(
  onEditorLayout?: (width: number, height: number, postponeRendering?: boolean) => void,
  onResizeActiveChange?: (active: boolean) => void,
): UseSashResizeReturn {
  const widthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);

  const rootRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Drag coordinates tracking refs
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const isDraggingRef = useRef(false);
  const externalResizeActiveRef = useRef(false);
  const dragEditorHeightRef = useRef(0);
  const dragFixedWidthRef = useRef(0);

  const setExternalResizeActive = useCallback((active: boolean) => {
    externalResizeActiveRef.current = active;
  }, []);

  // Initialize from localStorage on mount
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('codalyzer:sidebarWidth');
      if (saved) {
        const n = parseInt(saved, 10);
        if (Number.isFinite(n) && n >= MIN_SIDEBAR_WIDTH && n <= MAX_SIDEBAR_WIDTH) {
          widthRef.current = n;
          setSidebarWidth(n);
        }
      }
    }
  }, []);

  const handleResizeStart = useCallback((clientX: number) => {
    isDraggingRef.current = true;
    dragStartXRef.current = clientX;
    dragStartWidthRef.current = widthRef.current;
    const root = rootRef.current;
    const editor = editorContainerRef.current;
    if (root && editor) {
      const rootRect = root.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      dragEditorHeightRef.current = editorRect.height;
      dragFixedWidthRef.current = rootRect.width - widthRef.current - editorRect.width;
    }
    onResizeActiveChange?.(true);

    document.body.classList.add('sash-dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    // Disable pointer events on ALL iframes during drag to prevent mouse capture loss
    document.querySelectorAll('iframe').forEach((iframe) => {
      (iframe as HTMLElement).dataset.sashSavedPe =
        (iframe as HTMLElement).style.pointerEvents;
      (iframe as HTMLElement).style.pointerEvents = 'none';
    });
  }, [onResizeActiveChange]);

  const handleResize = useCallback(
    (clientX: number) => {
      const delta = clientX - dragStartXRef.current;
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, dragStartWidthRef.current + delta)
      );
      widthRef.current = newWidth;

      // Mutate the DOM directly for 120fps performance during drag
      if (sidebarRef.current) {
        sidebarRef.current.style.width = `${newWidth}px`;
        sidebarRef.current.style.minWidth = `${newWidth}px`;
      }

      const root = rootRef.current;
      if (root && dragEditorHeightRef.current > 0 && onEditorLayout) {
        const editorWidth = root.clientWidth - dragFixedWidthRef.current - newWidth;
        if (editorWidth > 0) {
          onEditorLayout(editorWidth, dragEditorHeightRef.current, true);
        }
      }
    },
    [onEditorLayout]
  );

  const handleResizeEnd = useCallback(() => {
    isDraggingRef.current = false;
    dragEditorHeightRef.current = 0;
    dragFixedWidthRef.current = 0;
    document.body.classList.remove('sash-dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    onResizeActiveChange?.(false);

    // Restore iframe pointer events
    document.querySelectorAll('iframe').forEach((iframe) => {
      const saved = (iframe as HTMLElement).dataset.sashSavedPe;
      (iframe as HTMLElement).style.pointerEvents = saved ?? '';
      delete (iframe as HTMLElement).dataset.sashSavedPe;
    });

    // Commit to React state exactly once when the drag ends
    setSidebarWidth(widthRef.current);
    
    // Save to localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('codalyzer:sidebarWidth', widthRef.current.toString());
    }

    // Flush a final editor layout to guarantee alignment when the drag ends
    if (editorContainerRef.current && onEditorLayout) {
      const rect = editorContainerRef.current.getBoundingClientRect();
      onEditorLayout(rect.width, rect.height, false);
    }
  }, [onEditorLayout, onResizeActiveChange]);

  // Set up ResizeObserver on the editor container.
  // Using requestAnimationFrame to decouple size measurement from layout rendering,
  // scheduling ed.layout exactly once per browser repaint cycle.
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || !onEditorLayout) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver((entries) => {
      if (isDraggingRef.current || externalResizeActiveRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          onEditorLayout(width, height, isDraggingRef.current);
        }
        rafId = null;
      });
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [onEditorLayout]);

  return {
    sidebarWidth,
    rootRef,
    sidebarRef,
    editorContainerRef,
    handleResizeStart,
    handleResize,
    handleResizeEnd,
    setExternalResizeActive,
  };
}
