import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Composition } from "@scenefile/engine";
import { type Browser, type Page, chromium } from "playwright-core";
import { browserProblem } from "./errors";

export interface Session {
  page: Page;
  close(): Promise<void>;
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: true,
      args: ["--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars"],
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw browserProblem(reason) ?? cause;
  }
}

/** Loads a composition into a fresh, offline Chromium page with the runtime attached. */
export async function openComposition(composition: Composition): Promise<Session> {
  const bundlePath = createRequire(import.meta.url).resolve("@scenefile/runtime/bundle");
  const runtime = await readFile(bundlePath, "utf8");
  const browser = await launch();
  try {
    const { width, height } = composition.manifest;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // Rendering is offline by design: it keeps output reproducible and custom content contained.
    await page.route("**/*", (route) => route.abort());
    await page.setContent(composition.html, { waitUntil: "load" });
    await page.addScriptTag({ content: runtime });
    // Resolves once fonts are loaded and text is fitted; rejects if the runtime failed to start.
    await page.evaluate(() => (window as unknown as { __scenefileReady: Promise<void> }).__scenefileReady);
    return { page, close: () => browser.close() };
  } catch (cause) {
    await browser.close();
    throw cause;
  }
}
