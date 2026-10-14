import { lookup } from "node:dns/promises";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { BlockList } from "node:net";
import { extname } from "node:path";
import { MAX_ASSET_BYTES } from "@scenefile/engine";
import { type Browser, chromium } from "playwright-core";
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

/** Addresses that reach only the local link, which is where cloud machines keep their credentials. */
const LINK_LOCAL = new BlockList();
LINK_LOCAL.addSubnet("169.254.0.0", 16, "ipv4");
LINK_LOCAL.addSubnet("fe80::", 10, "ipv6");

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
  /** Seconds the page has to start loading. */
  timeoutSeconds?: number;
  /** Seconds the whole capture may take before it is stopped. */
  deadlineSeconds?: number;
  /** Refuse link-local addresses. For when the address comes from a model rather than a person. */
  refuseLinkLocal?: boolean;
}

export interface CaptureReport {
  output: string;
  width: number;
  height: number;
  device: CaptureDevice;
  /** The page's own title, and the address it ended up at after any redirects. */
  title: string;
  url: string;
  /** False when the picture had to be taken at a lower resolution to stay small enough to use. */
  full: boolean;
}

interface Shot {
  picture: Buffer;
  title: string;
  url: string;
}

/** A failed navigation, in words that say what to do about it. */
export function explain(cause: unknown, address: URL, timeoutSeconds: number): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const check = "Check the address and that the site is running.";
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_ADDRESS_UNREACHABLE|ERR_EMPTY_RESPONSE|ERR_CONNECTION_CLOSED/.test(reason)) {
    return new EnvironmentError(`Nothing is answering at ${address.origin}.`, check);
  }
  if (/ERR_NAME_NOT_RESOLVED/.test(reason)) {
    return new EnvironmentError(`The name ${address.hostname} could not be found.`, "Check the spelling of the address.");
  }
  if (/ERR_CERT|ERR_SSL/.test(reason)) {
    return new EnvironmentError(`The security certificate of ${address.origin} was not accepted.`, "Use the http address for a local site, or fix the certificate.");
  }
  if (/Download is starting|ERR_ABORTED/.test(reason)) return new Error("That address is a download, not a page, so there is nothing to picture.");
  if (/Timeout/i.test(reason)) {
    return new EnvironmentError(`The page at ${address.origin} did not load within ${timeoutSeconds} seconds.`, check);
  }
  // Whatever else: the first line only, without colour codes or call logs.
  const first = reason.replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0] ?? "";
  return new EnvironmentError(`The page at ${address.origin} could not be opened: ${first.replace(/^page\.goto:\s*/, "")}`, check);
}

/**
 * Reads an address given for a page to open: http or https only, with a hint
 * when the scheme was left off. With `refuseLinkLocal`, an address whose name
 * leads to the local link is refused too.
 */
export async function webAddress(url: string, refuseLinkLocal: boolean): Promise<URL> {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && /^[\w.-]+(?::\d+)?(?:\/\S*)?$/.test(url)) {
    throw new Error(`"${url}" has no http:// or https:// in front. Did you mean http://${url}?`);
  }
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a web address. Give one like https://example.com or http://localhost:3000.`);
  }
  if (address.protocol !== "http:" && address.protocol !== "https:") {
    throw new Error("Only http and https addresses can be opened.");
  }
  if (refuseLinkLocal) {
    const host = address.hostname.replace(/^\[|\]$/g, "");
    const found = await lookup(host, { all: true }).catch(() => []);
    if (found.some((entry) => LINK_LOCAL.check(entry.address, entry.family === 6 ? "ipv6" : "ipv4"))) {
      throw new Error(`${address.hostname} is a link-local address, which is not opened here.`);
    }
  }
  return address;
}

/** The bundled browser, for opening someone else's page: inside its sandbox where the system allows one. */
export function launchForPages(): Promise<Browser> {
  const launch = (sandbox: boolean): Promise<Browser> => chromium.launch({ headless: true, chromiumSandbox: sandbox });
  return launch(true).catch(() =>
    launch(false).catch((cause: unknown) => {
      throw browserProblem(cause instanceof Error ? cause.message : String(cause)) ?? cause;
    }),
  );
}

/**
 * Opens a web page in the bundled browser and saves a picture of it, to use in
 * a `screenshot` scene. Unlike rendering, this runs the page's own code and
 * loads whatever it asks for, so it is a deliberate, separate step.
 */
export async function capturePage(options: CaptureOptions): Promise<CaptureReport> {
  const address = await webAddress(options.url, options.refuseLinkLocal === true);
  if (extname(options.output).toLowerCase() !== ".png") {
    throw new Error(`The picture is saved as a PNG; give an output that ends in .png, not "${options.output}".`);
  }
  if (await stat(options.output).then((found) => found.isDirectory(), () => false)) {
    throw new Error(`"${options.output}" is a folder. Give the name of a file to save the picture as.`);
  }
  const name = options.device ?? "desktop";
  const device = CAPTURE_DEVICES[name];
  const timeoutSeconds = options.timeoutSeconds ?? 30;
  const deadlineSeconds = options.deadlineSeconds ?? 60;
  let browser: Browser | undefined;

  const take = async (scale: number): Promise<Shot> => {
    browser = await launchForPages();
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: scale,
      isMobile: device.mobile,
      hasTouch: device.mobile,
      colorScheme: options.dark ? "dark" : "light",
      reducedMotion: "reduce",
      acceptDownloads: false,
      serviceWorkers: "block",
      ...(device.mobile ? { userAgent: PHONE_AGENT } : {}),
    });
    const page = await context.newPage();
    const response = await page.goto(address.href, { waitUntil: "load", timeout: timeoutSeconds * 1000 }).catch((cause: unknown) => {
      throw explain(cause, address, timeoutSeconds);
    });
    const status = response?.status() ?? 200;
    if (status >= 400) {
      const signIn = status === 401 || status === 403 ? " It may need signing in, which capture cannot do." : "";
      throw new Error(`The page answered ${status}${response?.statusText() ? ` (${response.statusText()})` : ""}, so no picture was saved.${signIn}`);
    }
    // Pages often keep fetching after "load"; give them a moment to settle, but not for ever.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(Math.min(30, Math.max(0, options.waitSeconds ?? 0.5)) * 1000);

    let height: number = device.height;
    if (options.fullPage) {
      const most = Math.floor(MAX_PICTURE_HEIGHT / scale);
      const measure = (): Promise<number> => page.evaluate(() => document.documentElement.scrollHeight);
      // Walk down the page once so pictures that load when scrolled to have loaded, then go back to the top.
      const reach = Math.min(await measure(), most);
      for (let y = 0; y < reach; y += device.height) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(100);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      height = Math.max(device.height, Math.min(await measure(), most));
    }
    // The window keeps its size, so a section sized to the screen stays one screen tall.
    const picture = await page.screenshot({
      type: "png",
      animations: "disabled",
      caret: "hide",
      fullPage: options.fullPage === true,
      clip: { x: 0, y: 0, width: device.width, height },
    });
    const shot = { picture, title: (await page.title()).slice(0, 200), url: page.url() };
    await browser.close();
    return shot;
  };

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new EnvironmentError(
          `The page at ${address.origin} did not finish within ${deadlineSeconds} seconds, so the capture was stopped.`,
          "Try again; if it keeps happening, the page never settles and cannot be captured.",
        ),
      );
    }, deadlineSeconds * 1000);
  });
  try {
    const work = (async (): Promise<{ shot: Shot; full: boolean }> => {
      const first = await take(device.scale);
      if (first.picture.length <= MAX_ASSET_BYTES) return { shot: first, full: true };
      // Too large for a scene to load: the same page at one picture pixel per page pixel.
      const smaller = await take(1);
      if (smaller.picture.length > MAX_ASSET_BYTES) {
        throw new Error(`The picture of this page is over ${MAX_ASSET_BYTES / 1024 / 1024} MB even at its smallest, so it was not saved.${options.fullPage ? " Try without the whole page." : ""}`);
      }
      return { shot: smaller, full: false };
    })();
    // If the deadline wins, the work is abandoned; its later failure must not go unhandled.
    work.catch(() => undefined);
    const { shot, full } = await Promise.race([work, deadline]);
    const partial = `${options.output}.${process.pid}.partial`;
    try {
      await writeFile(partial, shot.picture);
      await rename(partial, options.output);
    } finally {
      await rm(partial, { force: true });
    }
    return {
      output: options.output,
      width: shot.picture.readUInt32BE(16),
      height: shot.picture.readUInt32BE(20),
      device: name,
      title: shot.title,
      url: shot.url,
      full,
    };
  } finally {
    clearTimeout(timer);
    // Not awaited: a page stuck in a loop can keep a polite close waiting; the browser is killed regardless.
    void (browser as Browser | undefined)?.close().catch(() => undefined);
  }
}
