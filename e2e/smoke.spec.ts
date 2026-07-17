import { expect, test } from '@playwright/test';

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

test('reuses cached geometry after reverting parameters and reloading', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class CountingWorker extends NativeWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const count = Number(localStorage.getItem('geometry-worker-requests') ?? 0) + 1;
        localStorage.setItem('geometry-worker-requests', String(count));
        super.postMessage(message, options as StructuredSerializeOptions);
      }
    };
  });
  await page.goto('/');

  const exportButton = page.getByRole('button', { name: /Export STL/ });
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() =>
    Number(localStorage.getItem('geometry-worker-requests') ?? 0))).toBe(1);
  await expect.poll(() => page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'gridfinity-geometry-cache')) return 0;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gridfinity-geometry-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = database.transaction('meshes').objectStore('meshes').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return count;
  })).toBe(1);

  await page.getByRole('button', { name: '+ New' }).click();
  await page.locator('.cell[aria-pressed="false"]').first().click();
  await expect(page.getByText('5 cells in 2 bins', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    Number(localStorage.getItem('geometry-worker-requests') ?? 0))).toBe(2);
  await expect(page.getByRole('button', { name: /Export STL/ })).toBeEnabled({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Cell 2,0' }).click();
  await expect(page.getByText('4 cells', { exact: true })).toBeVisible();
  await page.waitForTimeout(750);
  expect(await page.evaluate(() =>
    Number(localStorage.getItem('geometry-worker-requests') ?? 0))).toBe(2);

  await page.getByRole('button', { name: 'Bin 1' }).click();
  await page.getByRole('button', { name: 'Cell 1,1' }).click();
  await expect(page.getByText('3 cells', { exact: true })).toBeVisible();
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() =>
    Number(localStorage.getItem('geometry-worker-requests') ?? 0))).toBe(3);

  await page.getByRole('button', { name: 'Cell 1,1' }).click();
  await expect(page.getByText('4 cells', { exact: true })).toBeVisible();
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(750);
  expect(await page.evaluate(() =>
    Number(localStorage.getItem('geometry-worker-requests') ?? 0))).toBe(3);

  await page.reload();
  await expect(page.locator('.viewer')).toHaveAttribute('data-part-count', '1', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Export STL/ })).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(750);
  expect(await page.evaluate(() =>
    Number(localStorage.getItem('geometry-worker-requests') ?? 0))).toBe(3);
});

test('renders geometry when IndexedDB is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get: () => { throw new Error('IndexedDB unavailable'); },
    });
    const NativeWorker = window.Worker;
    Object.defineProperty(window, '__geometryWorkerRequests', { value: 0, writable: true });
    window.Worker = class CountingWorker extends NativeWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        (window as typeof window & { __geometryWorkerRequests: number }).__geometryWorkerRequests++;
        super.postMessage(message, options as StructuredSerializeOptions);
      }
    };
  });
  await page.goto('/');

  await expect(page.locator('.viewer')).toHaveAttribute('data-part-count', '1', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Export STL/ })).toBeEnabled({ timeout: 30_000 });
  expect(await page.evaluate(() =>
    (window as typeof window & { __geometryWorkerRequests: number }).__geometryWorkerRequests)).toBe(1);
});

test('keeps selected-bin painting explicit and exposes the simplified controls', async ({ page }) => {
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

  await page.getByRole('button', { name: '+ New' }).click();
  await expect(page.getByRole('button', { name: '+ New' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.cell[aria-pressed="false"]').first().click();
  await expect(page.getByText('5 cells in 2 bins', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bin 1' }).click();
  await page.locator('.cell[aria-pressed="false"]').first().click();
  await expect(page.getByText('6 cells in 2 bins', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bin 1' })).toHaveAttribute('aria-pressed', 'true');

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
  expect(errors).toEqual([]);
});
