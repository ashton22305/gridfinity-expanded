import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

async function readCanvasPixel(
  canvas: Locator,
  xRatio: number,
  yRatio: number,
) {
  return canvas.evaluate((element, { xRatio, yRatio }) => {
    const target = element as HTMLCanvasElement;
    const gl = target.getContext('webgl2') ?? target.getContext('webgl');
    if (!gl) throw new Error('Viewer canvas does not have a WebGL context');
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(gl.drawingBufferWidth * xRatio),
      Math.floor(gl.drawingBufferHeight * yRatio),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    return [...pixel];
  }, { xRatio, yRatio });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const createObjectURL = URL.createObjectURL.bind(URL);
    Object.defineProperty(window, '__blobUrlCalls', { value: 0, writable: true });
    URL.createObjectURL = (value) => {
      (window as typeof window & { __blobUrlCalls: number }).__blobUrlCalls++;
      return createObjectURL(value);
    };
  });
});

test('locks each paint gesture to one bin and exposes the simplified controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');

  await expect(page.getByRole('tab', { name: 'Shape' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Walls' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cuts' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Split' })).toHaveCount(0);
  await expect(page.getByText('(21 mm)', { exact: true })).toBeVisible();
  await expect(page.getByText('Cavity corner radius', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Base slope/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Cell 4,0' }).click();
  await expect(page.getByText('5 cells in 2 bins', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bin 2' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Cell 5,0' }).click();
  await expect(page.getByText('6 cells in 2 bins', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bin 2' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Bin 1' }).click();
  await page.getByRole('button', { name: 'Cell 6,0' }).click();
  await expect(page.getByText('7 cells in 3 bins', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bin 3' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Bin 1' }).click();
  const dragStart = await page.getByRole('button', { name: 'Cell 4,2' }).boundingBox();
  const dragEnd = await page.getByRole('button', { name: 'Cell 5,3' }).boundingBox();
  expect(dragStart).not.toBeNull();
  expect(dragEnd).not.toBeNull();
  await page.mouse.move(dragStart!.x + dragStart!.width / 2, dragStart!.y + dragStart!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragEnd!.x + dragEnd!.width / 2, dragEnd!.y + dragEnd!.height / 2);
  await page.mouse.up();
  await expect(page.getByText('9 cells in 4 bins', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bin 4' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('tab', { name: 'Walls' }).click();
  await expect(page.getByRole('button', { name: 'Reset selected bin walls' })).toBeVisible();
  await expect(page.getByText(/full-height wall/)).toBeVisible();
  await expect(page.getByText(/divider/i)).toHaveCount(0);

  const viewer = page.locator('.viewer');
  await expect(viewer).toHaveAttribute('data-part-count', /[1-9]/, { timeout: 30_000 });
  await expect(page.locator('canvas.viewer-canvas')).toBeVisible();
  expect(await page.evaluate(() =>
    (window as typeof window & { __blobUrlCalls: number }).__blobUrlCalls)).toBe(0);
  expect(errors).toEqual([]);
});

test('edits seeded cuts, previews multipart gaps, and exports the same generated mesh', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');

  await page.getByRole('combobox', { name: 'Printer' }).click();
  await page.getByRole('option', { name: 'Custom' }).click();
  await page.getByLabel('Bed width').fill('80');
  await page.getByLabel('Bed depth').fill('80');
  await page.getByRole('tab', { name: 'Cuts' }).click();
  await expect(page.getByText('4 parts', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove cut 1' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove cut 1' }).click();
  await expect(page.getByText(/exceeds the Custom bed/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reset cuts' }).click();
  await expect(page.getByText(/every part fits the Custom bed/)).toBeVisible();

  const viewer = page.locator('.viewer');
  await expect(viewer).toHaveAttribute('data-part-count', '4', { timeout: 30_000 });
  const offsets = await viewer.getAttribute('data-preview-offsets');
  expect(new Set(offsets?.split(';')).size).toBeGreaterThan(1);
  expect(await page.evaluate(() =>
    (window as typeof window & { __blobUrlCalls: number }).__blobUrlCalls)).toBe(0);

  const exportButton = page.getByRole('button', { name: 'Export STL (4 parts)' });
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });
  await exportButton.click();
  const firstPart = page.getByRole('menuitem', { name: /gridfinity-bin-part-1-of-4\.stl/ });
  const downloadPromise = page.waitForEvent('download');
  await firstPart.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('gridfinity-bin-part-1-of-4.stl');
  const stream = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length;
  expect(bytes).toBeGreaterThan(84);
  expect(await page.evaluate(() =>
    (window as typeof window & { __blobUrlCalls: number }).__blobUrlCalls)).toBe(1);
  expect(errors).toEqual([]);
});

test('renders an L-shaped triangle soup in editor orientation and resets the orbit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Cell 1,1' }).click();
  await expect(page.getByText('3 cells', { exact: true })).toBeVisible();

  const viewer = page.locator('.viewer');
  await expect(viewer).toHaveAttribute('data-part-count', '1', { timeout: 30_000 });
  await expect(viewer).toHaveAttribute('data-coordinate-orientation', 'editor-row-down');
  await expect(viewer).toHaveAttribute('data-face-orientation', 'counter-clockwise');
  await expect(viewer).toHaveAttribute('data-mesh-topology', 'flat-triangle-soup');

  const canvas = page.locator('canvas.viewer-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, bounds!.y + bounds!.height * 0.55);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await readCanvasPixel(canvas, 0.5, 0.02))[0]).toBeLessThan(80);
  expect(errors).toEqual([]);
});
