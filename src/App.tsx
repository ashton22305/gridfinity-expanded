import { Text } from '@mantine/core';
import { Sidebar } from './components/sidebar/Sidebar';
import { BabylonViewer } from './components/viewer/BabylonViewer';
import { ExportMenu } from './components/ExportMenu';
import { useBinGeometry } from './hooks/useBinGeometry';
import { useAppStore } from './store';

export default function App() {
  const config = useAppStore((s) => s.config);
  const { previewBuffer, pieces, generating, error } = useBinGeometry(config);

  return (
    <div className="app">
      <header className="app-header">
        <Text size="sm" fw={600} c="bright" lts="0.02em">
          gridfinity-expanded
        </Text>
        <ExportMenu pieces={pieces} generating={generating} />
      </header>
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          <BabylonViewer stlBuffer={previewBuffer} generating={generating} error={error} />
        </main>
      </div>
    </div>
  );
}
