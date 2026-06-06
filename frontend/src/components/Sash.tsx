'use client';

import { useRef, useCallback } from 'react';

interface SashProps {
  onResize: (clientX: number) => void;
  onResizeStart: (clientX: number) => void;
  onResizeEnd: () => void;
}

export function Sash({ onResize, onResizeStart, onResizeEnd }: SashProps) {
  const isDragging = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort; document listeners below are the fallback.
      }

      isDragging.current = true;
      onResizeStart(e.clientX);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!isDragging.current) return;
        onResize(moveEvent.clientX);
      };

      const handlePointerUp = () => {
        if (!isDragging.current) return;
        isDragging.current = false;
        onResizeEnd();
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
    },
    [onResize, onResizeStart, onResizeEnd]
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      style={{
        width: '4px',
        height: '100%',
        flexShrink: 0,
        cursor: 'col-resize',
        position: 'relative',
        zIndex: 10,
        background: 'transparent',
        userSelect: 'none',
        touchAction: 'none',
      }}
      className="sash-handle hidden md:block"
    />
  );
}
