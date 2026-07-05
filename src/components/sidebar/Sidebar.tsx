import { useState } from 'react';
import { ScrollArea, Tabs } from '@mantine/core';
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
    <Tabs
      value={activeTab}
      onChange={(value) => value && setActiveTab(value as Tab)}
      className="app-sidebar"
    >
      <Tabs.List grow>
        {(Object.keys(TABS) as Tab[]).map((tab) => (
          <Tabs.Tab key={tab} value={tab}>
            {tab}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value={activeTab} flex={1} style={{ minHeight: 0 }}>
        <ScrollArea h="100%" p="md">
          <ActivePanel />
        </ScrollArea>
      </Tabs.Panel>
    </Tabs>
  );
}
