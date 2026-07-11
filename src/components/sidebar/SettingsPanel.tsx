import { Accordion, ScrollArea } from '@mantine/core';
import { DimensionsTab } from './tabs/DimensionsTab';
import { FeaturesTab } from './tabs/FeaturesTab';
import { PrinterTab } from './tabs/PrinterTab';
import { Label } from '../ui/Field';

/**
 * The right panel's sections, top to bottom. Counterpart of `TABS` in
 * Sidebar.tsx: the sidebar tabs hold the spatial editors, while every
 * form-shaped parameter group lives here as a collapsible accordion section.
 */
const SECTIONS = {
  Dimensions: DimensionsTab,
  Features: FeaturesTab,
  'Printer fit': PrinterTab,
} as const;

const SECTION_NAMES = Object.keys(SECTIONS) as (keyof typeof SECTIONS)[];

export function SettingsPanel() {
  return (
    <ScrollArea h="100%" p="md">
      <Accordion multiple defaultValue={[...SECTION_NAMES]}>
        {SECTION_NAMES.map((name) => {
          const Section = SECTIONS[name];
          return (
            <Accordion.Item key={name} value={name}>
              <Accordion.Control>
                <Label>{name}</Label>
              </Accordion.Control>
              <Accordion.Panel>
                <Section />
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </ScrollArea>
  );
}
