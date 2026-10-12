import type { SceneAsset } from "./types";

interface Size {
  width: number;
  height: number;
}

/**
 * The largest size, in whole pixels, at which an image fits inside a box
 * without changing shape. A small image is enlarged to fill the box; that is
 * reported separately as low resolution.
 */
export function containSize(image: Size, box: Size): Size {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  return {
    width: Math.max(1, Math.min(Math.floor(box.width), Math.round(image.width * scale))),
    height: Math.max(1, Math.min(Math.floor(box.height), Math.round(image.height * scale))),
  };
}

/**
 * An image at an exact size, marked so the runtime decodes it before drawing
 * and reports how large it is shown. With no asset, an empty box of that size.
 */
export function imageHtml(asset: SceneAsset | undefined, path: string, size: Size, className: string): string {
  if (!asset) return `<div class="${className} sf-shot__missing" style="width:${size.width}px;height:${size.height}px"></div>`;
  return `<img class="${className}" data-sf-image data-sf-path="${path}" src="${asset.dataUri}" width="${size.width}" height="${size.height}" alt="">`;
}
