/**
 * Avatar crop math (pure; shared by the editor preview and the saved 512 px JPEG).
 * Everything is in "viewport units": the square crop frame is `view` wide, the
 * image is scaled by `scale` and its centre sits `x`, `y` from the frame centre.
 */
export interface CropImage { width: number; height: number }
export type Rotation = 0 | 90 | 180 | 270;
export interface CropState { scale: number; x: number; y: number; rotation: Rotation }

export const MAX_ZOOM = 4;   // × the "fill" scale

/** Image size after rotation (90° / 270° swap width and height). */
export function rotated(img: CropImage, rotation: Rotation): CropImage {
  return rotation % 180 === 0 ? img : { width: img.height, height: img.width };
}

/** Scale at which the image covers the whole frame (no gaps). */
export const fillScale = (img: CropImage, view: number) => view / Math.min(img.width, img.height);
/** Scale at which the whole image fits inside the frame (padded with white). */
export const fitScale = (img: CropImage, view: number) => view / Math.max(img.width, img.height);

export function scaleBounds(img: CropImage, view: number, rotation: Rotation) {
  const r = rotated(img, rotation);
  return { min: fitScale(r, view), max: fillScale(r, view) * MAX_ZOOM };
}

/**
 * Keeps the image placed sensibly: larger than the frame → no gap may show on that
 * axis; smaller than the frame → it must stay fully inside it.
 */
export function clampOffset(state: CropState, img: CropImage, view: number): CropState {
  const r = rotated(img, state.rotation);
  const limX = Math.abs(r.width * state.scale - view) / 2;
  const limY = Math.abs(r.height * state.scale - view) / 2;
  const clamp = (v: number, lim: number) => Math.min(lim, Math.max(-lim, v));
  return { ...state, x: clamp(state.x, limX), y: clamp(state.y, limY) };
}

/** Zooms about the frame centre, keeping the point under it fixed, then clamps. */
export function zoomTo(state: CropState, nextScale: number, img: CropImage, view: number): CropState {
  const { min, max } = scaleBounds(img, view, state.rotation);
  const scale = Math.min(max, Math.max(min, nextScale));
  const k = scale / state.scale;
  return clampOffset({ ...state, scale, x: state.x * k, y: state.y * k }, img, view);
}

export function initialCrop(img: CropImage, view: number): CropState {
  return { scale: fillScale(img, view), x: 0, y: 0, rotation: 0 };
}

/** Rotates 90° clockwise and re-fills the frame. */
export function rotateCw(state: CropState, img: CropImage, view: number): CropState {
  const rotation = ((state.rotation + 90) % 360) as Rotation;
  return { rotation, x: 0, y: 0, scale: fillScale(rotated(img, rotation), view) };
}

/** Slider position 0–1 ↔ scale, on a log curve so zoom feels even across the range. */
export function sliderToScale(t: number, img: CropImage, view: number, rotation: Rotation): number {
  const { min, max } = scaleBounds(img, view, rotation);
  return min * Math.pow(max / min, Math.min(1, Math.max(0, t)));
}
export function scaleToSlider(scale: number, img: CropImage, view: number, rotation: Rotation): number {
  const { min, max } = scaleBounds(img, view, rotation);
  return max === min ? 0 : Math.log(scale / min) / Math.log(max / min);
}
