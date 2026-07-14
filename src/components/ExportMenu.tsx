import { Button, Menu } from '@mantine/core';
import { downloadStl } from '../lib/export/stl';
import type { GeneratedPart } from '../lib/types';

interface Props {
  parts: GeneratedPart[];
  generating: boolean;
}

const DOWNLOAD_SPACING_MS = 300;

export function ExportMenu({ parts, generating }: Props) {
  const disabled = generating || parts.length === 0;

  function downloadAll() {
    parts.forEach((part, index) => {
      setTimeout(() => downloadStl(part.mesh, part.filename), index * DOWNLOAD_SPACING_MS);
    });
  }

  if (parts.length <= 1) {
    return (
      <Button
        disabled={disabled}
        onClick={() => parts[0] && downloadStl(parts[0].mesh, parts[0].filename)}
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
          Export STL ({parts.length} parts)
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item fw={600} onClick={downloadAll}>
          Download all ({parts.length})
        </Menu.Item>
        <Menu.Divider />
        {parts.map((part) => (
          <Menu.Item key={part.id} onClick={() => downloadStl(part.mesh, part.filename)}>
            {part.filename}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
