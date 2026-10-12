// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mounts } from "../src/browser";
import { getScene, sceneSchema } from "../src/index";

const chart = {
  type: "chart",
  heading: "Median build time",
  unit: "s",
  bars: [
    { label: "Webpack", value: 48 },
    { label: "Vite", value: 12 },
    { label: "Ours", value: 3 },
  ],
  highlight: "Ours",
};
const ctx = { index: 0, total: 1, path: "scenes[0]", frame: { width: 1920, height: 1080, unit: 10.8 }, asset: () => undefined };

describe("chart", () => {
  it("takes two to six bars and a highlight that names one of them", () => {
    expect(sceneSchema.safeParse(chart).success).toBe(true);
    expect(sceneSchema.safeParse({ ...chart, bars: chart.bars.slice(0, 1) }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...chart, bars: Array.from({ length: 7 }, (_, i) => ({ label: `b${i}`, value: i })) }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...chart, highlight: "Rollup" }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...chart, bars: [{ label: "a", value: -1 }, { label: "b", value: 2 }] }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...chart, bars: [{ label: "a", value: 0 }, { label: "b", value: 0 }] }).success).toBe(false);
  });

  it("draws each bar in proportion to the largest, with its value written out", () => {
    const parsed = sceneSchema.parse(chart);
    const html = getScene("chart").compile(parsed, ctx);
    document.body.innerHTML = `<section>${html}</section>`;
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-sf-bar]"));
    expect(rows.map((row) => Number(row.dataset.sfBar))).toEqual([1, 0.25, 0.0625]);
    expect(rows.map((row) => row.querySelector(".sf-chart__value")?.textContent)).toEqual(["48s", "12s", "3s"]);
    expect(rows.map((row) => row.classList.contains("sf-chart__row--lit"))).toEqual([false, false, true]);
    expect(getScene("chart").compile(sceneSchema.parse({ ...chart, unit: undefined, highlight: undefined, bars: [{ label: "a", value: 1234567 }, { label: "b", value: 0.5 }] }), ctx)).toContain("1,234,567");
  });

  it("grows the bars one after another and ends with all of them at full length", () => {
    const parsed = sceneSchema.parse(chart);
    const section = document.createElement("section");
    section.innerHTML = getScene("chart").compile(parsed, ctx);
    document.body.replaceChildren(section);
    const handle = mounts.chart?.(section, { fps: 30, durationFrames: 240, enterFrames: 15, exitFrames: 0 } as never);
    const fills = Array.from(section.querySelectorAll<HTMLElement>(".sf-chart__fill"));
    const scale = (el: HTMLElement | undefined) => Number(/scaleX\(([\d.]+)\)/.exec(el?.style.transform ?? "")?.[1] ?? Number.NaN);
    handle?.seek(0);
    expect(fills.map(scale)).toEqual([0, 0, 0]);
    handle?.seek(15 + 12);
    expect(scale(fills[0])).toBeGreaterThan(scale(fills[2]));
    const reveal = getScene("chart").revealSeconds?.(parsed) ?? 0;
    handle?.seek(15 + Math.ceil(reveal * 30));
    expect(fills.map(scale)).toEqual([1, 1, 1]);
  });

  it("documents itself with an example that is valid", () => {
    expect(sceneSchema.safeParse(getScene("chart").doc.example).success).toBe(true);
  });
});
