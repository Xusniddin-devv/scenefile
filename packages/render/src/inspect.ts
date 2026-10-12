import type { Composition, InspectReport } from "@scenefile/engine";
import { openComposition } from "./session";

/** Loads a composition in the browser and returns how its text was fitted. */
export async function inspectComposition(composition: Composition): Promise<InspectReport> {
  const session = await openComposition(composition);
  try {
    return await session.page.evaluate(
      () => (window as unknown as { __scenefile: { report: InspectReport } }).__scenefile.report,
    );
  } finally {
    await session.close();
  }
}
