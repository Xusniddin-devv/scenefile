export { installBrowser } from "./browser";
export { captureFrame } from "./capture";
export { CAPTURE_DEVICES, type CaptureDevice, type CaptureOptions, type CaptureReport, capturePage } from "./capture-page";
export { type Finding, diagnose } from "./doctor";
export { type Encoder, runFfmpeg, startEncoder } from "./encode";
export { EnvironmentError, browserProblem } from "./errors";
export { inspectComposition } from "./inspect";
export { type PrepareOptions, prepareScenefile } from "./prepare";
export { type ProbeResult, hasSound, probeVideo } from "./probe";
export {
  MAX_WORKERS,
  QUALITIES,
  type Quality,
  type RenderOptions,
  type RenderReport,
  SEGMENT_SECONDS,
  defaultWorkers,
  renderVideo,
} from "./render";
export { type Session, openComposition } from "./session";
export {
  type InstallOptions,
  type Samples,
  type SpeakerOptions,
  type Synthesize,
  type VoiceInfo,
  VOICE_CATALOG,
  createSpeaker,
  installVoice,
  isVoice,
  voiceHome,
  voiceInstalled,
} from "./voice";
