/** Where a scene sits in the video, given to its compiler. */
export interface CompileContext {
  readonly index: number;
  readonly total: number;
  /** The scene's path in the scenefile, e.g. `scenes[2]`. */
  readonly path: string;
}

/** One piece of text a scene draws, declared so fonts can be checked before rendering. */
export interface SceneText {
  /** Path relative to the scene, e.g. `heading` or `steps[0].run`. */
  path: string;
  text: string;
  font: "sans" | "mono";
}

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
  /**
   * Seconds, after the scene has entered, until its content has finished
   * appearing (typing, counting, staggered reveals). A scene is never made
   * shorter than this, so its last frame before the exit always shows the
   * finished content. Omit for scenes that are complete once entered.
   */
  revealSeconds?(props: P): number;
  /** One line describing the scene, for the text storyboard. */
  summary(props: P): string;
  /** Every string the scene draws. */
  texts(props: P): SceneText[];
  /**
   * Inner HTML of the scene's <section>. All text must be escaped.
   *
   * Text that should size itself carries `data-sf-fit="min,max,step"` (font
   * sizes in units), `data-sf-path` (its scenefile path, for diagnostics),
   * and either `data-sf-lines="n"` or `data-sf-box` (fit inside the element's
   * own fixed height).
   */
  compile(props: P, ctx: CompileContext): string;
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
