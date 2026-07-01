import { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Sidebar } from './components/sidebar/Sidebar';
import { BabylonViewer } from './components/viewer/BabylonViewer';
import { ExportMenu } from './components/ExportMenu';
import { useBinGeometry } from './hooks/useBinGeometry';
import { PRINTER_PROFILES } from './lib/printers';
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
  cornerRadius: 3.75,  // Gridfinity standard outer fillet
  magnetHoles: true,
  screwHoles: false,
};

export default function App() {
  const [config, setConfig] = useState<BinConfig>(DEFAULT_CONFIG);
  const [printerProfile, setPrinterProfile] = useState<PrinterProfile>(
    PRINTER_PROFILES[4] // Prusa MK4 / MK3S+
  );

  const { stlBuffer, generating, error } = useBinGeometry(config);

  return (
    <AppLayout
      header={
        <>
          <span className={styles.wordmark}>gridfinity-expanded</span>
          <ExportMenu stlBuffer={stlBuffer} generating={generating} />
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
          stlBuffer={stlBuffer}
          generating={generating}
          error={error}
        />
      }
    />
  );
}
