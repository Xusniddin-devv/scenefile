/** Where a scene sits in the video, given to its compiler. */
export interface CompileContext {
  readonly index: number;
  readonly total: number;
  /** The scene's path in the scenefile, e.g. `scenes[2]`. */
  readonly path: string;
  /** The frame in pixels, and one unit (1% of its short side) in pixels. */
  readonly frame: { readonly width: number; readonly height: number; readonly unit: number };
  /** A loaded image, by the `src` the scenefile gave. Undefined if it was not loaded. */
  asset(src: string): SceneAsset | undefined;
  /** The size of a video clip, by the `src` the scenefile gave. Undefined if it was not read. */
  clip?(src: string): { readonly width: number; readonly height: number } | undefined;
}

/** An image ready to draw: embedded data and its real size in pixels. */
export interface SceneAsset {
  /** A short name, unique in the video, by which the page refers to the image's data. */
  readonly id: string;
  readonly dataUri: string;
  readonly width: number;
  readonly height: number;
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
  /** Every image the scene shows: its `src`, and the path of the field that names it, relative to the scene. */
  assets?(props: P): { path: string; src: string }[];
  /** Every video file the scene plays, in the same form. */
  clips?(props: P): { path: string; src: string }[];
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
  /**
   * What a writer of scenefiles needs to know about this scene. The authoring
   * guide is assembled from these, so it cannot drift from the code; tests
   * require every field to be documented and the example to pass a full check.
   */
  readonly doc: {
    /** One line: what the scene is for. */
    readonly purpose: string;
    /** Each of the scene's own fields, described with its limits. */
    readonly fields: Readonly<Record<string, string>>;
    /** A complete, valid scene of this type. */
    readonly example: Readonly<Record<string, unknown>>;
  };
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
