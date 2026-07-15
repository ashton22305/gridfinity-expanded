import { Button, Menu } from '@mantine/core';
import { useMemo } from 'react';
import { downloadStl, partFilename } from '../lib/export/stl';
import type { GeneratedPart } from '../lib/types';

interface Props {
  parts: GeneratedPart[];
  binCount: number;
  generating: boolean;
}

interface NamedPart extends GeneratedPart {
  filename: string;
}

const DOWNLOAD_SPACING_MS = 300;

export function ExportMenu({ parts, binCount, generating }: Props) {
  const namedParts = useMemo<NamedPart[]>(() => {
    const partCounts = new Map<string, number>();
    for (const part of parts) {
      partCounts.set(part.binId, (partCounts.get(part.binId) ?? 0) + 1);
    }
    const partIndices = new Map<string, number>();
    return parts.map((part) => {
      const partIndex = partIndices.get(part.binId) ?? 0;
      partIndices.set(part.binId, partIndex + 1);
      return {
        ...part,
        filename: partFilename(
          part.binId,
          binCount,
          partIndex,
          partCounts.get(part.binId)!,
        ),
      };
    });
  }, [binCount, parts]);
  const disabled = generating || namedParts.length === 0;

  function downloadAll() {
    namedParts.forEach((part, index) => {
      setTimeout(() => downloadStl(part.triangles, part.filename), index * DOWNLOAD_SPACING_MS);
    });
  }

  if (namedParts.length <= 1) {
    return (
      <Button
        disabled={disabled}
        onClick={() => namedParts[0] && downloadStl(namedParts[0].triangles, namedParts[0].filename)}
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
          Export STL ({namedParts.length} parts)
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item fw={600} onClick={downloadAll}>
          Download all ({namedParts.length})
        </Menu.Item>
        <Menu.Divider />
        {namedParts.map((part, index) => (
          <Menu.Item
            key={`${part.binId}:${index}`}
            onClick={() => downloadStl(part.triangles, part.filename)}
          >
            {part.filename}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
