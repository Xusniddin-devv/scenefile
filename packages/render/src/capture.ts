import type { Page } from "playwright-core";

/** Moves the page to `frame` and returns it as PNG bytes. */
export async function captureFrame(page: Page, frame: number): Promise<Buffer> {
  await page.evaluate((target) => {
    (window as unknown as { __scenefile: { seek(frame: number): void } }).__scenefile.seek(target);
  }, frame);
  return page.screenshot({ type: "png" });
}
