import { Divider, ScrollArea, Stack } from '@mantine/core';
import { DimensionsTab } from './tabs/DimensionsTab';
import { FeaturesTab } from './tabs/FeaturesTab';
import { PrinterTab } from './tabs/PrinterTab';
import { Label } from '../ui/Field';

/**
 * The right panel's sections, top to bottom. Counterpart of `TABS` in
 * Sidebar.tsx: the sidebar tabs hold the spatial editors, while every
 * form-shaped parameter group lives here in one scroll view.
 */
const SECTIONS = {
  Printer: PrinterTab,
  Dimensions: DimensionsTab,
  Features: FeaturesTab,
} as const;

export function SettingsPanel() {
  return (
    <ScrollArea h="100%" p="md">
      <Stack gap="xl">
        {(Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]).map((name) => {
          const Section = SECTIONS[name];
          return (
            <Stack key={name} gap="md">
              <Divider label={<Label>{name}</Label>} labelPosition="left" />
              <Section />
            </Stack>
          );
        })}
      </Stack>
    </ScrollArea>
  );
}
