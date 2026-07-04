import { Sidebar } from './components/sidebar/Sidebar';
import { BabylonViewer } from './components/viewer/BabylonViewer';
import { ExportMenu } from './components/ExportMenu';
import { useBinGeometry } from './hooks/useBinGeometry';
import { useAppStore } from './store';

export default function App() {
  const config = useAppStore((s) => s.config);
  const { previewBuffer, pieces, generating, error } = useBinGeometry(config);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <span className="text-[0.9rem] font-semibold tracking-wide text-zinc-300">
          gridfinity-expanded
        </span>
        <ExportMenu pieces={pieces} generating={generating} />
      </header>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <BabylonViewer stlBuffer={previewBuffer} generating={generating} error={error} />
        </main>
      </div>
    </div>
  );
}
