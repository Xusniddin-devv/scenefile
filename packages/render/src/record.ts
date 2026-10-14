import { rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Browser } from "playwright-core";
import { explain, launchForPages, webAddress } from "./capture-page";
import { startEncoder } from "./encode";
import { EnvironmentError } from "./errors";

/** One thing done to the page while it is recorded. */
export type Step =
  | { action: "type"; text: string; into: string }
  | { action: "click"; target: string }
  | { action: "hover"; target: string }
  | { action: "press"; key: string }
  | { action: "scroll"; by: number }
  | { action: "scroll"; to: string }
  | { action: "wait"; seconds: number }
  | { action: "goto"; url: string };

const ACTIONS = "type (with into), click, hover, press, scroll, wait or goto";
const MAX_STEPS = 60;
const MAX_WAIT_SECONDS = 30;
const MAX_TEXT = 500;

/**
 * Reads the steps of a walkthrough, as a list or as `{ "steps": [...] }`. Each
 * step names one action:
 * `{ "type": "text", "into": "selector" }`, `{ "click": "selector" }`,
 * `{ "hover": "selector" }`, `{ "press": "Enter" }`, `{ "scroll": 600 }` or
 * `{ "scroll": "selector" }`, `{ "wait": 1.5 }`, `{ "goto": "/path" }`.
 * Selectors are CSS, or `text=Sign in` for what a person reads on the page.
 * A step that cannot be read throws, naming its number and what to write.
 */
export function parseSteps(input: unknown): Step[] {
  const list = Array.isArray(input) ? input : (input as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`A walkthrough needs at least one step, as a list such as [{ "click": "text=Sign in" }].`);
  }
  if (list.length > MAX_STEPS) throw new Error(`A walkthrough has at most ${MAX_STEPS} steps; this one has ${list.length}. Split it into several recordings.`);
  return list.map((raw, index) => readStep(raw, index + 1));
}

function readStep(raw: unknown, number: number): Step {
  const wrong = (why: string): Error => new Error(`Step ${number}: ${why}`);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw wrong(`each step is an object with one action: ${ACTIONS}.`);
  const step = raw as Record<string, unknown>;
  const keys = Object.keys(step);
  const actions = keys.filter((key) => ["type", "click", "hover", "press", "scroll", "wait", "goto"].includes(key));
  if (actions.length !== 1) {
    const unknown = keys.filter((key) => key !== "into");
    throw wrong(actions.length === 0 ? `"${unknown[0] ?? ""}" is not an action. Use one of ${ACTIONS}.` : `has ${actions.join(" and ")}; a step does one thing.`);
  }
  const extra = keys.filter((key) => key !== actions[0] && !(actions[0] === "type" && key === "into"));
  if (extra.length > 0) throw wrong(`"${extra[0]}" does not belong in a ${actions[0]} step.`);
  const selector = (value: unknown, what: string): string => {
    if (typeof value !== "string" || value.trim() === "") throw wrong(`${what} must be a selector, such as "#email" or "text=Sign in".`);
    return value;
  };
  switch (actions[0]) {
    case "type": {
      if (typeof step.type !== "string" || step.type === "") throw wrong(`"type" is the text to type.`);
      if (step.type.length > MAX_TEXT) throw wrong(`the text to type is over ${MAX_TEXT} characters.`);
      if (step.into === undefined) throw wrong(`say where to type with "into", such as { "type": "ada@example.com", "into": "#email" }.`);
      return { action: "type", text: step.type, into: selector(step.into, `"into"`) };
    }
    case "click":
      return { action: "click", target: selector(step.click, `"click"`) };
    case "hover":
      return { action: "hover", target: selector(step.hover, `"hover"`) };
    case "press":
      if (typeof step.press !== "string" || step.press === "") throw wrong(`"press" is a key, such as "Enter", "Tab" or "Control+A".`);
      return { action: "press", key: step.press };
    case "scroll":
      if (typeof step.scroll === "number" && Number.isFinite(step.scroll) && Math.abs(step.scroll) <= 20000) return { action: "scroll", by: step.scroll };
      if (typeof step.scroll === "string") return { action: "scroll", to: selector(step.scroll, `"scroll"`) };
      throw wrong(`"scroll" is a number of pixels down (negative for up, at most 20000), or a selector to bring into view.`);
    case "wait":
      if (typeof step.wait !== "number" || !(step.wait > 0) || step.wait > MAX_WAIT_SECONDS) throw wrong(`"wait" is a number of seconds, more than 0 and at most ${MAX_WAIT_SECONDS}.`);
      return { action: "wait", seconds: step.wait };
    default:
      if (typeof step.goto !== "string" || step.goto === "") throw wrong(`"goto" is an address, or a path on the same site such as "/pricing".`);
      return { action: "goto", url: step.goto };
  }
}

function describe(step: Step): string {
  switch (step.action) {
    case "type":
      return `type into ${step.into}`;
    case "click":
    case "hover":
      return `${step.action} ${step.target}`;
    case "press":
      return `press ${step.key}`;
    case "scroll":
      return "to" in step ? `scroll to ${step.to}` : `scroll ${step.by}`;
    case "wait":
      return `wait ${step.seconds}`;
    default:
      return `goto ${step.url}`;
  }
}

/**
 * What to tell whoever asked for a recording: how to put it in a scene, and
 * when each step happens in it, so narration can be written to match.
 * `src` is the video as the scenefile will name it.
 */
export function useRecording(report: RecordReport, src: string): string[] {
  const tall = report.height > report.width;
  return [
    `Use it in a scene: { "type": "clip", "src": "${src}"${tall ? ', "backdrop": "blur"' : ""} }`,
    `In it: ${report.marks.map((mark) => `step ${mark.step + 1} (${mark.action}) at ${(mark.frame / FPS).toFixed(2)}s`).join(", ")}.`,
    "Trim it with the clip's from and to, and time narration to those moments.",
  ];
}

/** The screens a walkthrough is recorded on. Sizes are in CSS pixels; the video is `scale` times larger. */
export const RECORD_DEVICES = {
  desktop: { width: 1280, height: 720, scale: 1.5, mobile: false },
  phone: { width: 360, height: 780, scale: 3, mobile: true },
} as const;
export type RecordDevice = keyof typeof RECORD_DEVICES;

export interface RecordOptions {
  /** The http or https address the walkthrough starts at. */
  url: string;
  /** Where to save the video. Must end in .mp4. */
  output: string;
  steps: Step[];
  device?: RecordDevice;
  dark?: boolean;
  /** How far the view moves in on what is being used; 1 keeps the whole page in view. At most 2.5. */
  zoom?: number;
  /** Seconds each step has to find what it acts on. */
  stepTimeoutSeconds?: number;
  /** Seconds the whole recording may take before it is stopped. */
  deadlineSeconds?: number;
  refuseLinkLocal?: boolean;
  ffmpegPath?: string;
}

export interface RecordReport {
  output: string;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  /** The frame each step's action happens on: the press of a click, the first letter typed. */
  marks: { step: number; action: Step["action"]; frame: number }[];
  /** The page's title and address at the end. */
  title: string;
  url: string;
}

const FPS = 30;

interface Camera {
  /** The point of the window the view is centred on, in CSS pixels, and how far it is moved in. */
  x: number;
  y: number;
  zoom: number;
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const between = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * Opens a page, does the steps to it the way a person would, and saves what
 * happens as a video: a pointer moves to each thing used, a click shows as a
 * ring, typing appears a letter at a time, and the view moves in on what is
 * being used and back out for scrolling and new pages. The video goes into a
 * `clip` scene. Like capture, this runs the page's own code, so it is a
 * deliberate step of its own.
 */
export async function recordPage(options: RecordOptions): Promise<RecordReport> {
  const start = await webAddress(options.url, options.refuseLinkLocal === true);
  if (extname(options.output).toLowerCase() !== ".mp4") {
    throw new Error(`The recording is saved as an MP4 video; give an output that ends in .mp4, not "${options.output}".`);
  }
  if (await stat(options.output).then((found) => found.isDirectory(), () => false)) {
    throw new Error(`"${options.output}" is a folder. Give the name of a file to save the video as.`);
  }
  const device = RECORD_DEVICES[options.device ?? "desktop"];
  const most = Math.min(2.5, Math.max(1, options.zoom ?? 1.8));
  const stepTimeout = (options.stepTimeoutSeconds ?? 10) * 1000;
  const deadlineSeconds = options.deadlineSeconds ?? 300;
  const W = device.width;
  const H = device.height;

  let browser: Browser | undefined;
  let timer: NodeJS.Timeout | undefined;
  const partial = join(dirname(options.output), `.${basename(options.output, ".mp4")}.${process.pid}.partial.mp4`);
  const encoder = startEncoder({ output: partial, fps: FPS, crf: 18, ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}) });
  let finished = false;
  // Set once the recording is given up, so work still running cannot save a video after all.
  let stopped = false;

  const work = async (): Promise<RecordReport> => {
    browser = await launchForPages();
    const context = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: device.scale,
      isMobile: device.mobile,
      hasTouch: device.mobile,
      colorScheme: options.dark ? "dark" : "light",
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    let cdp = await context.newCDPSession(page);

    let frames = 0;
    let camera: Camera = { x: W / 2, y: H / 2, zoom: 1 };
    let pointer = { x: W / 2, y: H / 2 };
    const marks: RecordReport["marks"] = [];

    const open = async (address: URL): Promise<void> => {
      const response = await page.goto(address.href, { waitUntil: "load", timeout: 30000 }).catch((cause: unknown) => {
        throw explain(cause, address, 30);
      });
      const status = response?.status() ?? 200;
      if (status >= 400) throw new Error(`the page at ${address.href} answered ${status}.`);
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
    };

    /**
     * Runs code in the page. A click or a script can send the page elsewhere at any moment,
     * which ends the code it was running; then the new page is waited for and asked again.
     */
    const inPage = async <R, A>(code: (arg: A) => R, arg: A): Promise<R> => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await page.evaluate(code as (arg: unknown) => R, arg as unknown);
        } catch (cause) {
          const moved = /Execution context was destroyed|navigat/i.test(cause instanceof Error ? cause.message : "");
          if (!moved || attempt >= 4) throw cause;
          await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
        }
      }
    };

    /** Draws the pointer and a click's ring on the page, then saves one frame of the view. */
    const shoot = async (ring = 0, times = 1): Promise<void> => {
      const scroll = await inPage(
        ({ x, y, ring, phone }) => {
          const id = "__scenefile_pointer";
          let mark = document.getElementById(id);
          if (!mark) {
            mark = document.createElement("div");
            mark.id = id;
            mark.setAttribute("aria-hidden", "true");
            mark.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:0;height:0";
            mark.innerHTML = phone
              ? '<div style="position:absolute;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;background:rgba(40,40,40,.28);border:2px solid rgba(255,255,255,.85)"></div><div data-ring style="position:absolute;border-radius:50%;border:3px solid rgba(40,40,40,.5)"></div>'
              : '<div data-ring style="position:absolute;border-radius:50%;background:rgba(40,40,40,.16);border:2px solid rgba(40,40,40,.45)"></div><svg width="22" height="30" viewBox="0 0 22 30" style="position:absolute;left:-2px;top:-1px;overflow:visible"><path d="M2 1 L2 24 L8 18.5 L12 27.5 L15.6 26 L11.7 17.3 L19.5 17.3 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
            document.documentElement.appendChild(mark);
          }
          mark.style.transform = `translate(${x}px, ${y}px)`;
          // On a phone the touch shows only while it happens.
          if (phone) mark.style.opacity = ring > 0 ? String(Math.min(1, ring * 3)) : "0";
          const circle = mark.querySelector<HTMLElement>("[data-ring]");
          if (circle) {
            const size = ring > 0 ? 14 + ring * 34 : 0;
            circle.style.cssText += `;left:${-size / 2}px;top:${-size / 2}px;width:${size}px;height:${size}px;opacity:${ring > 0 ? 1 - ring * 0.7 : 0}`;
          }
          return [window.scrollX, window.scrollY];
        },
        { x: pointer.x, y: pointer.y, ring, phone: device.mobile },
      );
      const zoom = camera.zoom;
      const width = W / zoom;
      const height = H / zoom;
      const left = Math.min(Math.max(camera.x - width / 2, 0), W - width);
      const top = Math.min(Math.max(camera.y - height / 2, 0), H - height);
      const clip = { x: left + (scroll[0] ?? 0), y: top + (scroll[1] ?? 0), width, height, scale: zoom * device.scale };
      let picture: Buffer | undefined;
      for (let attempt = 1; picture === undefined; attempt += 1) {
        // A picture asked for just as the page is replaced by another is never answered.
        // Then the new page is waited for, and asked for again on a fresh connection.
        let stalled: NodeJS.Timeout | undefined;
        const answer = await Promise.race([
          cdp.send("Page.captureScreenshot", { format: "png", clip }).then((shot) => (shot as { data: string }).data),
          new Promise<null>((resolve) => {
            stalled = setTimeout(() => resolve(null), 5000);
          }),
        ]).catch(() => null);
        clearTimeout(stalled);
        if (answer !== null) picture = Buffer.from(answer, "base64");
        else {
          if (attempt >= 3) throw new Error("the browser stopped drawing the page.");
          await cdp.detach().catch(() => undefined);
          await page.waitForLoadState("load", { timeout: 10000 }).catch(() => undefined);
          cdp = await context.newCDPSession(page);
        }
      }
      for (let i = 0; i < times; i += 1) {
        await encoder.write(picture);
        frames += 1;
      }
    };

    /** Moves the pointer and the view together, over a number of frames. */
    const glide = async (to: { x: number; y: number }, view: Camera, count: number): Promise<void> => {
      const fromPointer = pointer;
      const fromCamera = camera;
      for (let i = 1; i <= count; i += 1) {
        const t = ease(i / count);
        pointer = { x: between(fromPointer.x, to.x, t), y: between(fromPointer.y, to.y, t) };
        camera = { x: between(fromCamera.x, view.x, t), y: between(fromCamera.y, view.y, t), zoom: between(fromCamera.zoom, view.zoom, t) };
        await shoot();
      }
    };

    /** Frames of the page as it is, about as fast as they are shown, so what it animates is seen. */
    const watch = async (count: number): Promise<void> => {
      for (let i = 0; i < count; i += 1) {
        const began = Date.now();
        await shoot();
        await page.waitForTimeout(Math.max(0, 1000 / FPS - (Date.now() - began)));
      }
    };

    const whole = (): Camera => ({ x: W / 2, y: H / 2, zoom: 1 });
    const outward = async (): Promise<void> => {
      if (camera.zoom > 1.001) await glide(pointer, whole(), 14);
    };

    /** Animates the page's scroll to a position, frame by frame. */
    const scrollTo = async (target: number): Promise<void> => {
      const from = await inPage(() => window.scrollY, undefined);
      const furthest = await inPage(() => document.documentElement.scrollHeight - window.innerHeight, undefined);
      const to = Math.max(0, Math.min(target, furthest));
      const count = Math.round(Math.min(40, Math.max(12, Math.abs(to - from) / 40)));
      if (Math.abs(to - from) < 2) return;
      for (let i = 1; i <= count; i += 1) {
        await inPage((y) => window.scrollTo({ top: y, behavior: "instant" }), between(from, to, ease(i / count)));
        await shoot();
      }
    };

    /** Finds what a step acts on, brings it into view, and moves the pointer and view onto it. */
    const reach = async (selector: string): Promise<{ x: number; y: number }> => {
      const target = page.locator(selector).first();
      try {
        await target.waitFor({ state: "visible", timeout: stepTimeout });
      } catch {
        throw new Error(`nothing on the page matched "${selector}" within ${stepTimeout / 1000} seconds.`);
      }
      let box = await target.boundingBox();
      if (box && (box.y < 0 || box.y + box.height > H)) {
        await outward();
        const scrolled = await inPage(() => window.scrollY, undefined);
        await scrollTo(scrolled + box.y - H * 0.35);
        box = await target.boundingBox();
      }
      if (!box) throw new Error(`"${selector}" is on the page but has no size, so it cannot be used.`);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      // Close enough to read it, with room around it: a wide field still fits across the view.
      const zoom = Math.max(1, Math.min(most, W / (box.width * 1.3), H / (box.height * 5)));
      const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
      await glide(point, { x: point.x, y: point.y, zoom }, Math.round(Math.min(24, Math.max(12, distance / 40))));
      if (device.mobile) await page.mouse.move(point.x, point.y);
      else await page.mouse.move(point.x, point.y, { steps: 2 });
      return point;
    };

    /** The ring of a press, drawn around the moment the press happens. */
    const press = async (point: { x: number; y: number }, step: number, action: Step["action"]): Promise<void> => {
      marks.push({ step, action, frame: frames });
      await shoot(0.15);
      await shoot(0.3);
      if (device.mobile) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      for (const ring of [0.45, 0.6, 0.75, 0.9]) await shoot(ring);
    };

    /** After something that may change the page: show it changing, then let it finish loading. */
    const settle = async (): Promise<void> => {
      await watch(8);
      await page.waitForLoadState("load", { timeout: 10000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
    };

    await open(start);
    await watch(18);

    for (const [index, step] of options.steps.entries()) {
      try {
        switch (step.action) {
          case "click": {
            const before = page.url();
            await press(await reach(step.target), index, step.action);
            await settle();
            if (page.url() !== before) await outward();
            await watch(14);
            break;
          }
          case "hover": {
            const point = await reach(step.target);
            marks.push({ step: index, action: step.action, frame: frames });
            pointer = point;
            await watch(20);
            break;
          }
          case "type": {
            const point = await reach(step.into);
            await press(point, index, step.action);
            // A letter every two frames, but never longer than about three seconds for the whole text.
            const letters = [...step.text];
            const perFrame = Math.max(1, Math.ceil(letters.length / 45));
            for (let i = 0; i < letters.length; i += perFrame) {
              await page.keyboard.type(letters.slice(i, i + perFrame).join(""));
              await shoot(0, perFrame === 1 ? 2 : 1);
            }
            await watch(10);
            break;
          }
          case "press": {
            const before = page.url();
            marks.push({ step: index, action: step.action, frame: frames });
            await page.keyboard.press(step.key);
            await settle();
            if (page.url() !== before) await outward();
            await watch(14);
            break;
          }
          case "scroll": {
            await outward();
            marks.push({ step: index, action: step.action, frame: frames });
            if ("by" in step) {
              await scrollTo((await inPage(() => window.scrollY, undefined)) + step.by);
            } else {
              const target = page.locator(step.to).first();
              try {
                await target.waitFor({ state: "attached", timeout: stepTimeout });
              } catch {
                throw new Error(`nothing on the page matched "${step.to}" within ${stepTimeout / 1000} seconds.`);
              }
              const top = await target.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
              await scrollTo(top - H * 0.2);
            }
            await watch(12);
            break;
          }
          case "wait":
            marks.push({ step: index, action: step.action, frame: frames });
            await watch(Math.round(step.seconds * FPS));
            break;
          case "goto": {
            const address = await webAddress(new URL(step.url, page.url()).href, options.refuseLinkLocal === true);
            await outward();
            marks.push({ step: index, action: step.action, frame: frames });
            await open(address);
            pointer = { x: W / 2, y: H / 2 };
            await watch(24);
            break;
          }
        }
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Step ${index + 1} (${describe(step)}) could not be done: ${reason}`);
      }
    }
    await outward();
    await watch(20);

    const report = { title: (await page.title()).slice(0, 200), url: page.url(), frames, marks };
    if (stopped) throw new Error("The recording was stopped.");
    finished = true;
    await encoder.finish();
    await rename(partial, options.output);
    return {
      output: options.output,
      width: Math.round(W * device.scale),
      height: Math.round(H * device.scale),
      seconds: Math.round((report.frames / FPS) * 100) / 100,
      ...report,
    };
  };

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new EnvironmentError(
          `The walkthrough did not finish within ${deadlineSeconds} seconds, so the recording was stopped.`,
          "Use fewer or shorter steps, or check that the page responds.",
        ),
      );
    }, deadlineSeconds * 1000);
  });
  const running = work();
  running.catch(() => undefined);
  try {
    return await Promise.race([running, deadline]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    void (browser as Browser | undefined)?.close().catch(() => undefined);
    if (!finished) await encoder.finish().catch(() => undefined);
    await rm(partial, { force: true });
  }
}

