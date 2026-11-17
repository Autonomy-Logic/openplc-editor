/**
 * The palette's thumbnails: the gallery screen is built and run once, and each widget is cropped out of the frame by
 * the bounds the core recorded for it.
 */
import type { HmiPreviewSession } from '../../../../middleware/shared/ports/hmi-preview-port'
import type {
  HmiPreviewBounds,
  HmiPreviewBuild,
  HmiPreviewElementId,
  HmiPreviewPixels,
  HmiPreviewRequest,
  HmiThumbnail,
  HmiThumbnailResult,
  HmiUnitSources,
} from '../../../../middleware/shared/ports/hmi-preview-types'
import { HMI_GALLERY_SCREEN, hmiGalleryWidget } from '../unit/generate-hmi-unit'

/** Logical width of the gallery screen. */
export const HMI_GALLERY_WIDTH = 240
/** Logical height the gallery allows each widget. */
export const HMI_GALLERY_ROW_HEIGHT = 180
/** Frames run before the gallery is captured, so widgets that animate in settle. */
export const HMI_GALLERY_FRAMES = 4
const FRAME_STEP_MS = 40
/** Logical units of margin kept around each widget. */
export const HMI_THUMBNAIL_PADDING = 4

/** Copies the changed rows of a frame into the full image. */
export function applyRows(image: Uint8ClampedArray, pixels: HmiPreviewPixels): void {
  image.set(pixels.rgba, pixels.y0 * pixels.width * 4)
}

/** Each gallery widget cut out of the image, by its bounds, with `HMI_THUMBNAIL_PADDING` around it. */
export function cropThumbnails(
  image: Uint8ClampedArray,
  size: { width: number; height: number; scale: number },
  bounds: readonly HmiPreviewBounds[],
  elementIds: readonly HmiPreviewElementId[],
): HmiThumbnail[] {
  const widgets = new Map(
    elementIds
      .filter((e) => e.screen === HMI_GALLERY_SCREEN)
      .flatMap((e) => {
        const widget = hmiGalleryWidget(e.element)
        return widget === null ? [] : [[e.id, widget] as const]
      }),
  )
  const thumbnails: HmiThumbnail[] = []
  for (const b of bounds) {
    const widget = widgets.get(b.id)
    if (widget === undefined || b.width <= 0 || b.height <= 0) continue
    const x0 = Math.max(0, Math.floor((b.x - HMI_THUMBNAIL_PADDING) * size.scale))
    const y0 = Math.max(0, Math.floor((b.y - HMI_THUMBNAIL_PADDING) * size.scale))
    const x1 = Math.min(size.width, Math.ceil((b.x + b.width + HMI_THUMBNAIL_PADDING) * size.scale))
    const y1 = Math.min(size.height, Math.ceil((b.y + b.height + HMI_THUMBNAIL_PADDING) * size.scale))
    if (x1 <= x0 || y1 <= y0) continue
    const width = x1 - x0
    const rgba = new Uint8ClampedArray(width * (y1 - y0) * 4)
    for (let y = y0; y < y1; y++) {
      const from = (y * size.width + x0) * 4
      rgba.set(image.subarray(from, from + width * 4), (y - y0) * width * 4)
    }
    thumbnails.push({ widget, width, height: y1 - y0, rgba })
  }
  return thumbnails
}

/** Builds the gallery of `sources`' widgets and draws it in a session of its own, closed before this returns. */
export async function renderHmiThumbnails(
  sources: Pick<HmiUnitSources, 'widgets' | 'settings' | 'projectNames'>,
  scale: number,
  build: (request: HmiPreviewRequest) => Promise<HmiPreviewBuild>,
  openSession: () => HmiPreviewSession,
): Promise<HmiThumbnailResult> {
  const built = await build({ ...sources, screens: [], plcVariables: [], gallery: true })
  if (!built.ok) return { thumbnails: [], errors: built.errors }
  const count = built.elementIds.filter((e) => hmiGalleryWidget(e.element) !== null).length
  const logicalHeight = Math.max(1, count) * HMI_GALLERY_ROW_HEIGHT
  const size = {
    width: Math.round(HMI_GALLERY_WIDTH * scale),
    height: Math.round(logicalHeight * scale),
    scale,
  }
  const image = new Uint8ClampedArray(size.width * size.height * 4)
  const session = openSession()
  try {
    await session.load(built.wasm, {
      width: HMI_GALLERY_WIDTH,
      height: logicalHeight,
      page: built.pages[HMI_GALLERY_SCREEN] ?? 0,
      design: false,
    })
    let bounds: HmiPreviewBounds[] = []
    for (let i = 0; i < HMI_GALLERY_FRAMES; i++) {
      const frame = await session.frame(i * FRAME_STEP_MS, size)
      if (frame.pixels) applyRows(image, frame.pixels)
      bounds = frame.bounds
    }
    return { thumbnails: cropThumbnails(image, size, bounds, built.elementIds), errors: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { thumbnails: [], errors: [{ file: 'HMI', message: `The palette could not be drawn: ${message}` }] }
  } finally {
    session.close()
  }
}
