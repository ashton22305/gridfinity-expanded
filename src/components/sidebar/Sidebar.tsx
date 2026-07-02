import { useState } from 'react';
import type { BinConfig, PrinterProfile } from '../../lib/types';
import { ShapeTab } from './tabs/ShapeTab';
import { WallsTab } from './tabs/WallsTab';
import { SplitTab } from './tabs/SplitTab';
import { DimensionsTab } from './tabs/DimensionsTab';
import { FeaturesTab } from './tabs/FeaturesTab';
import { PrinterTab } from './tabs/PrinterTab';
import styles from './Sidebar.module.css';

const TABS = ['Shape', 'Walls', 'Split', 'Dimensions', 'Features', 'Printer'] as const;
type Tab = (typeof TABS)[number];

interface Props {
  config: BinConfig;
  onConfigChange: (next: BinConfig) => void;
  printerProfile: PrinterProfile;
  onPrinterChange: (next: PrinterProfile) => void;
  gridCols: number;
  gridRows: number;
  onGridSizeChange: (cols: number, rows: number) => void;
}

export function Sidebar({
  config, onConfigChange, printerProfile, onPrinterChange,
  gridCols, gridRows, onGridSizeChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Shape');

  return (
    <aside className={styles.sidebar}>
      <div className={styles.tabBar} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={`${styles.tabButton} ${activeTab === tab ? styles.active : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className={styles.tabPanel} role="tabpanel">
        {activeTab === 'Shape' && (
          <ShapeTab
            config={config}
            onChange={onConfigChange}
            gridCols={gridCols}
            gridRows={gridRows}
            onGridSizeChange={onGridSizeChange}
          />
        )}
        {activeTab === 'Walls' && (
          <WallsTab
            config={config}
            onChange={onConfigChange}
            gridCols={gridCols}
            gridRows={gridRows}
          />
        )}
        {activeTab === 'Split' && (
          <SplitTab
            config={config}
            onChange={onConfigChange}
            printerProfile={printerProfile}
            gridCols={gridCols}
            gridRows={gridRows}
          />
        )}
        {activeTab === 'Dimensions' && (
          <DimensionsTab config={config} onChange={onConfigChange} />
        )}
        {activeTab === 'Features' && (
          <FeaturesTab config={config} onChange={onConfigChange} />
        )}
        {activeTab === 'Printer' && (
          <PrinterTab
            cells={config.cells}
            profile={printerProfile}
            onChange={onPrinterChange}
          />
        )}
      </div>
    </aside>
  );
}
