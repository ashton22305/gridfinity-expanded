import { useEffect, useRef, useState } from 'react';
import { downloadStl } from '../lib/export/stl';
import type { PieceStl } from '../hooks/useBinGeometry';
import styles from './ExportMenu.module.css';

interface Props {
  pieces: PieceStl[];
  generating: boolean;
}

// Browsers can throttle bursts of downloads from one gesture; spacing them out
// makes multi-piece "download all" reliable (some browsers may still prompt).
const DOWNLOAD_SPACING_MS = 300;

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
      <button
        className={styles.button}
        disabled={disabled}
        onClick={() => pieces[0] && downloadStl(pieces[0].buffer, pieces[0].name)}
        title={disabled ? 'Waiting for geometry…' : 'Download STL file'}
      >
        Export STL
      </button>
    );
  }

  return (
    <div className={styles.menuWrap} ref={menuRef}>
      <button
        className={styles.button}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={disabled ? 'Waiting for geometry…' : 'Download piece STL files'}
      >
        Export STL ({pieces.length} pieces) ▾
      </button>
      {open && !disabled && (
        <div className={styles.menu}>
          <button className={styles.menuItem} onClick={downloadAll}>
            Download all ({pieces.length})
          </button>
          {pieces.map((piece) => (
            <button
              key={piece.name}
              className={styles.menuItem}
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
