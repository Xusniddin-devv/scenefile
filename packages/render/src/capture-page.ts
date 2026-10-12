import { rename, rm } from "node:fs/promises";
import { extname } from "node:path";
import { chromium } from "playwright-core";
import { EnvironmentError, browserProblem } from "./errors";

/** The screens a page can be captured as. Sizes are in CSS pixels; `scale` multiplies them in the saved picture. */
export const CAPTURE_DEVICES = {
  desktop: { width: 1280, height: 800, scale: 2, mobile: false },
  phone: { width: 390, height: 844, scale: 3, mobile: true },
} as const;
export type CaptureDevice = keyof typeof CAPTURE_DEVICES;

/** The tallest picture saved, in its own pixels: a whole long page is cut off here. */
const MAX_PICTURE_HEIGHT = 8000;
const PHONE_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export interface CaptureOptions {
  /** An http or https address, including one on this machine such as http://localhost:3000. */
  url: string;
  /** Where to save the picture. Must end in .png. */
  output: string;
  device?: CaptureDevice;
  /** Take the whole page from the top, not only the first screen. */
  fullPage?: boolean;
  /** Ask the page for its dark appearance. */
  dark?: boolean;
  /** Seconds to wait after the page has loaded, for it to finish drawing. */
  waitSeconds?: number;
  timeoutSeconds?: number;
}

export interface CaptureReport {
  output: string;
  width: number;
  height: number;
  device: CaptureDevice;
}

/**
 * Opens a web page in the bundled browser and saves a picture of it, to use in
 * a `screenshot` scene. Unlike rendering, this does use the network: it loads
 * whatever address it is given, so it is a deliberate, separate step.
 */
export async function capturePage(options: CaptureOptions): Promise<CaptureReport> {
  let address: URL;
  try {
    address = new URL(options.url);
  } catch {
    throw new Error(`"${options.url}" is not a web address. Give one like https://example.com or http://localhost:3000.`);
  }
  if (address.protocol !== "http:" && address.protocol !== "https:") {
    throw new Error("Only http and https addresses can be captured.");
  }
  if (extname(options.output).toLowerCase() !== ".png") {
    throw new Error(`The picture is saved as a PNG; give an output that ends in .png, not "${options.output}".`);
  }
  const name = options.device ?? "desktop";
  const device = CAPTURE_DEVICES[name];
  const timeout = (options.timeoutSeconds ?? 30) * 1000;

  const browser = await chromium.launch({ headless: true }).catch((cause: unknown) => {
    throw browserProblem(cause instanceof Error ? cause.message : String(cause)) ?? cause;
  });
  const partial = `${options.output}.${process.pid}.partial`;
  try {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.scale,
      isMobile: device.mobile,
      hasTouch: device.mobile,
      colorScheme: options.dark ? "dark" : "light",
      reducedMotion: "reduce",
      ...(device.mobile ? { userAgent: PHONE_AGENT } : {}),
    });
    const page = await context.newPage();
    try {
      await page.goto(address.href, { waitUntil: "load", timeout });
    } catch {
      throw new EnvironmentError(
        `The page at ${address.origin} did not load within ${timeout / 1000} seconds.`,
        "Check the address and that the site is running. A slow page can be given longer with --timeout.",
      );
    }
    // Pages often keep fetching after "load"; give them a moment to settle, but not for ever.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(Math.min(30, Math.max(0, options.waitSeconds ?? 0.5)) * 1000);

    let height: number = device.height;
    if (options.fullPage) {
      const whole = await page.evaluate(() => document.documentElement.scrollHeight);
      height = Math.max(device.height, Math.min(whole, Math.floor(MAX_PICTURE_HEIGHT / device.scale)));
      await page.setViewportSize({ width: device.width, height });
      await page.waitForTimeout(200);
    }
    // An exact rectangle: a phone-like page can report a viewport a fraction of a pixel short.
    const picture = await page.screenshot({
      path: partial,
      type: "png",
      animations: "disabled",
      caret: "hide",
      clip: { x: 0, y: 0, width: device.width, height },
    });
    await rename(partial, options.output);
    // The size is read from the picture itself rather than assumed.
    return { output: options.output, width: picture.readUInt32BE(16), height: picture.readUInt32BE(20), device: name };
  } finally {
    await rm(partial, { force: true });
    await browser.close();
  }
}
