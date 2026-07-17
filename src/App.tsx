import { lazy, Suspense, useMemo } from 'react';
import { AppShell, Group, Text } from '@mantine/core';
import { Sidebar } from './components/sidebar/Sidebar';
import { SettingsPanel } from './components/sidebar/SettingsPanel';
import { PanelResizeHandle } from './components/sidebar/PanelResizeHandle';
import { ExportMenu } from './components/ExportMenu';
import { useBinGeometry } from './hooks/useBinGeometry';
import { printerBuildVolumes } from './lib/printers';
import { useAppStore } from './store';

const BabylonViewer = lazy(() => import('./components/viewer/BabylonViewer').then((module) => ({
  default: module.BabylonViewer,
})));

export default function App() {
  const design = useAppStore((s) => s.design);
  const panelWidths = useAppStore((s) => s.panelWidths);
  const { bins, design: generatedDesign, generating, error } = useBinGeometry(design);
  const buildVolumes = useMemo(
    () => printerBuildVolumes(design.printer),
    [design.printer],
  );

  return (
    <AppShell
      mode="static"
      className="app-shell"
      header={{ height: 48 }}
      navbar={{ width: panelWidths.sidebar, breakpoint: 0 }}
      aside={{ width: panelWidths.settings, breakpoint: 0 }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text size="sm" fw={600} c="bright" lts="0.02em">
            gridfinity-expanded
          </Text>
          <ExportMenu bins={bins} generating={generating} />
        </Group>
      </AppShell.Header>
      <AppShell.Navbar className="app-panel">
        <Sidebar />
        <PanelResizeHandle panel="sidebar" />
      </AppShell.Navbar>
      <AppShell.Aside className="app-panel">
        <SettingsPanel />
        <PanelResizeHandle panel="settings" />
      </AppShell.Aside>
      <AppShell.Main className="app-main">
        <Suspense fallback={(
          <div className="viewer" role="status" aria-label="Loading 3D bin preview">
            <div className="viewer-overlay">
              <Text size="sm" c="dimmed">Loading 3D preview…</Text>
            </div>
          </div>
        )}>
          <BabylonViewer
            bins={bins}
            design={generatedDesign}
            buildVolumes={buildVolumes}
            error={error}
          />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  );
}
