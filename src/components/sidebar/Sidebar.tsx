import { useState } from 'react';
import { ShapeTab } from './tabs/ShapeTab';
import { WallsTab } from './tabs/WallsTab';
import { SplitTab } from './tabs/SplitTab';
import { DimensionsTab } from './tabs/DimensionsTab';
import { FeaturesTab } from './tabs/FeaturesTab';
import { PrinterTab } from './tabs/PrinterTab';

const TABS = {
  Shape: ShapeTab,
  Walls: WallsTab,
  Split: SplitTab,
  Dimensions: DimensionsTab,
  Features: FeaturesTab,
  Printer: PrinterTab,
} as const;

type Tab = keyof typeof TABS;

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<Tab>('Shape');
  const ActivePanel = TABS[activeTab];

  return (
    <aside className="flex w-[280px] min-w-[240px] shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-900">
      <div className="flex shrink-0 border-b border-zinc-800" role="tablist">
        {(Object.keys(TABS) as Tab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 border-b-2 px-0.5 py-2.5 text-center text-[0.73rem] font-medium transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-zinc-200'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
        <ActivePanel />
      </div>
    </aside>
  );
}
