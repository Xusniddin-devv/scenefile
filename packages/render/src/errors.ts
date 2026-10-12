/** The machine is missing something scenefile needs. Not a problem with the scenefile. */
export class EnvironmentError extends Error {
  readonly remedy: string;

  constructor(message: string, remedy: string) {
    super(message);
    this.name = "EnvironmentError";
    this.remedy = remedy;
  }
}

export const FFMPEG_REMEDY =
  "Install ffmpeg: `brew install ffmpeg` on macOS, `sudo apt install ffmpeg` on Debian or Ubuntu.";
export const ENCODE_REMEDY =
  "Check that ffmpeg includes the libx264 encoder (`ffmpeg -encoders | grep libx264`) and that the disk has free space.";
export const WRITE_REMEDY = "Choose an output path inside a directory you can write to.";
export const CHROMIUM_REMEDY = "Install the browser: `scenefile setup`.";
export const CHROMIUM_LIBRARIES_REMEDY =
  "Install the system libraries Chromium needs: `scenefile setup --with-deps` (on Linux this asks for administrator rights).";

/** Why the browser could not start, as something a person can act on; null if the cause is something else. */
export function browserProblem(reason: string): EnvironmentError | null {
  if (/executable doesn't exist/i.test(reason)) {
    return new EnvironmentError("Chromium is not installed for scenefile.", CHROMIUM_REMEDY);
  }
  if (/error while loading shared libraries|missing dependencies|Host system is missing/i.test(reason)) {
    return new EnvironmentError("Chromium is installed, but system libraries it needs are missing.", CHROMIUM_LIBRARIES_REMEDY);
  }
  return null;
}
