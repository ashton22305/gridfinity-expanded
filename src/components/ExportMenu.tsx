import { useEffect, useRef, useState } from 'react';
import { downloadStl } from '../lib/export/stl';
import type { PieceStl } from '../hooks/useBinGeometry';
import { Button } from './ui/Button';

interface Props {
  pieces: PieceStl[];
  generating: boolean;
}

// Browsers can throttle bursts of downloads from one gesture; spacing them out
// makes multi-piece "download all" reliable (some browsers may still prompt).
const DOWNLOAD_SPACING_MS = 300;

const BUTTON_SIZE = 'px-3.5 py-1.5 text-[0.85rem]';

export function ExportMenu({ pieces, generating }: Props) {
  const disabled = generating || pieces.length === 0;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  function downloadAll() {
    pieces.forEach((piece, i) => {
      setTimeout(() => downloadStl(piece.buffer, piece.name), i * DOWNLOAD_SPACING_MS);
    });
    setOpen(false);
  }

  if (pieces.length <= 1) {
    return (
      <Button
        variant="primary"
        className={BUTTON_SIZE}
        disabled={disabled}
        onClick={() => pieces[0] && downloadStl(pieces[0].buffer, pieces[0].name)}
        title={disabled ? 'Waiting for geometry…' : 'Download STL file'}
      >
        Export STL
      </Button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="primary"
        className={BUTTON_SIZE}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={disabled ? 'Waiting for geometry…' : 'Download piece STL files'}
      >
        Export STL ({pieces.length} pieces) ▾
      </Button>
      {open && !disabled && (
        <div className="absolute top-[calc(100%+6px)] right-0 z-10 flex min-w-60 flex-col rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-xl shadow-black/40">
          <button
            className="mb-0.5 rounded-t border-b border-zinc-700 px-2.5 py-1.5 text-left text-[0.8rem] font-semibold text-white hover:bg-zinc-800"
            onClick={downloadAll}
          >
            Download all ({pieces.length})
          </button>
          {pieces.map((piece) => (
            <button
              key={piece.name}
              className="rounded px-2.5 py-1.5 text-left text-[0.8rem] text-zinc-200 hover:bg-zinc-800"
              onClick={() => { downloadStl(piece.buffer, piece.name); setOpen(false); }}
            >
              {piece.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
