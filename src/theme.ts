import {
  createTheme,
  Button,
  NumberInput,
  Select,
  Slider,
  Switch,
  Tabs,
  Alert,
  Text,
  Menu,
} from '@mantine/core';

/**
 * The single source of truth for how every control in the app looks.
 *
 * Nothing in a component sets padding, font size, radius, or color inline —
 * those decisions are made once here (via each component's `defaultProps`) and
 * inherited everywhere. To restyle the app — bigger buttons, a different accent,
 * rounder corners — edit this file and nothing else.
 */
export const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
  defaultRadius: 'md',
  // App is a dense tool UI: default every control one step smaller than Mantine's.
  components: {
    Button: Button.extend({ defaultProps: { size: 'sm' } }),
    NumberInput: NumberInput.extend({ defaultProps: { size: 'xs' } }),
    Select: Select.extend({ defaultProps: { size: 'sm', allowDeselect: false } }),
    Slider: Slider.extend({ defaultProps: { size: 'sm' } }),
    Switch: Switch.extend({ defaultProps: { size: 'md' } }),
    Tabs: Tabs.extend({
      defaultProps: { variant: 'default', color: 'blue' },
      // The sidebar's 6-way tab strip needs to stay compact; centralized here
      // rather than as a per-instance px/fz override on <Tabs.Tab>.
      styles: { tab: { padding: '0 0.25rem', fontSize: 'var(--mantine-font-size-xs)' } },
    }),
    Alert: Alert.extend({ defaultProps: { variant: 'light' } }),
    Menu: Menu.extend({ defaultProps: { shadow: 'md', position: 'bottom-end' } }),
    // Every plain bit of copy defaults to caption-sized, muted text — this is a
    // dense sidebar UI, so that's what most labels/hints/captions actually want.
    // Callers that need the larger body size opt in with <Text size="sm">, and
    // emphasis with <Text c="bright">.
    Text: Text.extend({ defaultProps: { size: 'xs', c: 'dimmed' } }),
  },
});
