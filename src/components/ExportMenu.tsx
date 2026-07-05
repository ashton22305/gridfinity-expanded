import { Button, Menu } from '@mantine/core';
import { downloadStl } from '../lib/export/stl';
import type { PieceStl } from '../hooks/useBinGeometry';

interface Props {
  pieces: PieceStl[];
  generating: boolean;
}

// Browsers can throttle bursts of downloads from one gesture; spacing them out
// makes multi-piece "download all" reliable (some browsers may still prompt).
const DOWNLOAD_SPACING_MS = 300;

export function ExportMenu({ pieces, generating }: Props) {
  const disabled = generating || pieces.length === 0;

  function downloadAll() {
    pieces.forEach((piece, i) => {
      setTimeout(() => downloadStl(piece.buffer, piece.name), i * DOWNLOAD_SPACING_MS);
    });
  }

  if (pieces.length <= 1) {
    return (
      <Button
        disabled={disabled}
        onClick={() => pieces[0] && downloadStl(pieces[0].buffer, pieces[0].name)}
        title={disabled ? 'Waiting for geometry…' : 'Download STL file'}
      >
        Export STL
      </Button>
    );
  }

  return (
    <Menu>
      <Menu.Target>
        <Button disabled={disabled} rightSection="▾">
          Export STL ({pieces.length} pieces)
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item fw={600} onClick={downloadAll}>
          Download all ({pieces.length})
        </Menu.Item>
        <Menu.Divider />
        {pieces.map((piece) => (
          <Menu.Item key={piece.name} onClick={() => downloadStl(piece.buffer, piece.name)}>
            {piece.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
