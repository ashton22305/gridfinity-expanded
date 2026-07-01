import { useEffect, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Sidebar } from './components/sidebar/Sidebar';
import { BabylonViewer } from './components/viewer/BabylonViewer';
import { ExportMenu } from './components/ExportMenu';
import { useBinGeometry } from './hooks/useBinGeometry';
import { PRINTER_PROFILES, computeAutoSplitLines } from './lib/printers';
import type { BinConfig, PrinterProfile } from './lib/types';
import styles from './App.module.css';

const DEFAULT_CONFIG: BinConfig = {
  cells: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  heightUnits: 3,
  wallThickness: 1.2,
  cavityCornerRadius: 2.5,  // ≈ the interior look of the spec 3.75 mm outer corner minus one wall
  innerFilletRadius: 0.5,
  magnetHoles: true,
  screwHoles: false,
  openEdges: [],
  dividerEdges: [],
  splitMode: 'auto',
  splitLines: [],
};

export default function App() {
  const [config, setConfig] = useState<BinConfig>(DEFAULT_CONFIG);
  const [printerProfile, setPrinterProfile] = useState<PrinterProfile>(
    PRINTER_PROFILES[5] // Prusa MK4 / MK3S+
  );

  // Auto split mode derives the effective split lines from the printer bed.
  // Equality-guarded so writing the same lines back doesn't loop the effect.
  useEffect(() => {
    if (config.splitMode !== 'auto') return;
    const auto = computeAutoSplitLines(config.cells, printerProfile);
    if (JSON.stringify(auto) !== JSON.stringify(config.splitLines)) {
      setConfig((c) => ({ ...c, splitLines: auto }));
    }
  }, [config.splitMode, config.cells, config.splitLines, printerProfile]);

  const { previewBuffer, pieces, generating, error } = useBinGeometry(config);

  return (
    <AppLayout
      header={
        <>
          <span className={styles.wordmark}>gridfinity-expanded</span>
          <ExportMenu pieces={pieces} generating={generating} />
        </>
      }
      sidebar={
        <Sidebar
          config={config}
          onConfigChange={setConfig}
          printerProfile={printerProfile}
          onPrinterChange={setPrinterProfile}
        />
      }
      viewer={
        <BabylonViewer
          stlBuffer={previewBuffer}
          generating={generating}
          error={error}
        />
      }
    />
  );
}
