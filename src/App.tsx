import { AppShell, Group, Text } from '@mantine/core';
import { Sidebar } from './components/sidebar/Sidebar';
import { BabylonViewer } from './components/viewer/BabylonViewer';
import { ExportMenu } from './components/ExportMenu';
import { useBinGeometry } from './hooks/useBinGeometry';
import { useAppStore } from './store';

export default function App() {
  const config = useAppStore((s) => s.config);
  const { previewBuffer, pieces, generating, error } = useBinGeometry(config);

  return (
    <AppShell mode="static" header={{ height: 48 }} navbar={{ width: 288, breakpoint: 0 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text size="sm" fw={600} c="bright" lts="0.02em">
            gridfinity-expanded
          </Text>
          <ExportMenu pieces={pieces} generating={generating} />
        </Group>
      </AppShell.Header>
      <AppShell.Navbar>
        <Sidebar />
      </AppShell.Navbar>
      <AppShell.Main className="app-main">
        <BabylonViewer stlBuffer={previewBuffer} generating={generating} error={error} />
      </AppShell.Main>
    </AppShell>
  );
}
