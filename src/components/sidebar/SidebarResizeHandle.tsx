import { useRef } from 'react';
import { useAppStore } from '../../store';

/** Drag strip on the sidebar's right edge; live-updates `sidebarWidth` in the store. */
export function SidebarResizeHandle() {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const dragStart = useRef({ x: 0, width: 0 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, width: sidebarWidth };
    document.body.classList.add('no-select');
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    setSidebarWidth(dragStart.current.width + (e.clientX - dragStart.current.x));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove('no-select');
  };

  return (
    <div
      className="sidebar-resize-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
