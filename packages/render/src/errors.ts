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
export const CHROMIUM_REMEDY = "Install the browser: `npx playwright-core install chromium --only-shell`.";
