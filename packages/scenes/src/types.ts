/** Everything the engine needs to know about one scene type. */
export interface SceneDefinition<P> {
  readonly type: string;
  /** Field names the scene accepts, used for "did you mean" suggestions. */
  readonly fields: readonly string[];
  readonly enterSeconds: number;
  readonly exitSeconds: number;
  readonly minHoldSeconds: number;
  /** Seconds the scene must stay fully visible for its content to be read. */
  holdSeconds(props: P): number;
  /** One line describing the scene, for the text storyboard. */
  summary(props: P): string;
  /** Inner HTML of the scene's <section>. All text must be escaped. */
  compile(props: P): string;
  readonly css: string;
}

export interface MountContext {
  readonly fps: number;
  readonly durationFrames: number;
  readonly enterFrames: number;
  readonly exitFrames: number;
}

export interface SceneHandle {
  /** Must be pure: the DOM after seek(n) depends only on n. */
  seek(localFrame: number): void;
}

export type SceneMount = (el: HTMLElement, ctx: MountContext) => SceneHandle;
