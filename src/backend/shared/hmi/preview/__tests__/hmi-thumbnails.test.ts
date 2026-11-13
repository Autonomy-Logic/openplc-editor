import type { HmiPreviewSession, HmiPreviewStart } from '../../../../../middleware/shared/ports/hmi-preview-port'
import type {
  HmiPreviewBuild,
  HmiPreviewFrame,
  HmiPreviewRequest,
  HmiPreviewSurface,
} from '../../../../../middleware/shared/ports/hmi-preview-types'
import { defaultHmiSettings } from '../../../../../middleware/shared/utils/hmi/settings'
import { HMI_GALLERY_SCREEN } from '../../unit/generate-hmi-unit'
import {
  applyRows,
  cropThumbnails,
  HMI_GALLERY_FRAMES,
  HMI_GALLERY_ROW_HEIGHT,
  HMI_GALLERY_WIDTH,
  HMI_THUMBNAIL_PADDING,
  renderHmiThumbnails,
} from '../hmi-thumbnails'

const ELEMENT_IDS = [
  { id: 1, screen: HMI_GALLERY_SCREEN, element: 'HMI__Column' },
  { id: 2, screen: HMI_GALLERY_SCREEN, element: 'W_HmiLamp' },
  { id: 3, screen: HMI_GALLERY_SCREEN, element: 'W_Badge' },
]

/** An image whose every pixel holds its own x, y and 255, 255. */
function coordinates(width: number, height: number): Uint8ClampedArray {
  const image = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) image.set([x, y, 255, 255], (y * width + x) * 4)
  return image
}

const pixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 2))

describe('HMI palette thumbnails', () => {
  it('copies only the changed rows into the full image', () => {
    const image = new Uint8ClampedArray(2 * 3 * 4)
    applyRows(image, { width: 2, height: 3, y0: 1, rows: 1, rgba: new Uint8ClampedArray(8).fill(7) })
    expect(Array.from(image.subarray(0, 8))).toEqual(new Array(8).fill(0))
    expect(Array.from(image.subarray(8, 16))).toEqual(new Array(8).fill(7))
    expect(Array.from(image.subarray(16))).toEqual(new Array(8).fill(0))
  })

  it('crops each gallery widget by its bounds with padding, clamped to the image', () => {
    const size = { width: 100, height: 120, scale: 2 }
    const image = coordinates(size.width, size.height)
    const thumbnails = cropThumbnails(
      image,
      size,
      [
        { id: 1, x: 0, y: 0, width: 50, height: 60 },
        { id: 2, x: 10, y: 10, width: 20, height: 5 },
        { id: 3, x: 1, y: 50, width: 60, height: 20 },
        { id: 9, x: 0, y: 0, width: 10, height: 10 },
      ],
      ELEMENT_IDS,
    )
    expect(thumbnails.map((t) => [t.widget, t.width, t.height])).toEqual([
      ['HmiLamp', (20 + 2 * HMI_THUMBNAIL_PADDING) * 2, (5 + 2 * HMI_THUMBNAIL_PADDING) * 2],
      ['Badge', 100, 120 - (50 - HMI_THUMBNAIL_PADDING) * 2],
    ])
    const [lamp, badge] = thumbnails
    expect(pixel(lamp.rgba, lamp.width, 0, 0)).toEqual([
      (10 - HMI_THUMBNAIL_PADDING) * 2,
      (10 - HMI_THUMBNAIL_PADDING) * 2,
    ])
    expect(pixel(badge.rgba, badge.width, 0, 0)).toEqual([0, (50 - HMI_THUMBNAIL_PADDING) * 2])
  })

  it('draws the gallery in a session of its own and closes it', async () => {
    const requests: HmiPreviewRequest[] = []
    const starts: HmiPreviewStart[] = []
    const surfaces: HmiPreviewSurface[] = []
    let closed = false
    const build = (request: HmiPreviewRequest): Promise<HmiPreviewBuild> => {
      requests.push(request)
      return Promise.resolve({
        ok: true,
        wasm: new Uint8Array(),
        pages: { [HMI_GALLERY_SCREEN]: 0 },
        setters: {},
        elementIds: ELEMENT_IDS,
        warnings: [],
        stats: { units: 1, cached: 0, compileMs: 0, linkMs: 0 },
      })
    }
    const session: HmiPreviewSession = {
      load: (_wasm, start) => {
        starts.push(start)
        return Promise.resolve()
      },
      frame: (_time, surface): Promise<HmiPreviewFrame> => {
        surfaces.push(surface)
        const rgba = new Uint8ClampedArray(surface.width * surface.height * 4).fill(200)
        return Promise.resolve({
          page: 0,
          status: 0,
          pixels:
            surfaces.length === 1
              ? { width: surface.width, height: surface.height, y0: 0, rows: surface.height, rgba }
              : null,
          bounds: [{ id: 2, x: 10, y: 10, width: 20, height: 20 }],
        })
      },
      show: () => Promise.resolve(),
      resize: () => Promise.resolve(),
      pointer: () => Promise.resolve(),
      key: () => Promise.resolve(),
      setNumber: () => Promise.resolve(true),
      setText: () => Promise.resolve(true),
      onStop: () => () => undefined,
      close: () => {
        closed = true
      },
    }
    const sources = { widgets: [], settings: defaultHmiSettings(), projectNames: ['Main'] }
    const result = await renderHmiThumbnails(sources, 2, build, () => session)
    expect(result.errors).toEqual([])
    expect(requests).toEqual([{ ...sources, screens: [], plcVariables: [], gallery: true }])
    expect(starts).toEqual([{ width: HMI_GALLERY_WIDTH, height: 2 * HMI_GALLERY_ROW_HEIGHT, page: 0, design: false }])
    expect(surfaces).toHaveLength(HMI_GALLERY_FRAMES)
    expect(result.thumbnails.map((t) => t.widget)).toEqual(['HmiLamp'])
    expect(Array.from(result.thumbnails[0].rgba.subarray(0, 4))).toEqual([200, 200, 200, 200])
    expect(closed).toBe(true)
  })

  it('reports a build that fails, and a session that stops, without thumbnails', async () => {
    const sources = { widgets: [], settings: defaultHmiSettings(), projectNames: [] }
    const failed = await renderHmiThumbnails(
      sources,
      1,
      () => Promise.resolve({ ok: false, errors: [{ file: 'HMI', message: 'broken' }], warnings: [] }),
      () => {
        throw new Error('no session expected')
      },
    )
    expect(failed).toEqual({ thumbnails: [], errors: [{ file: 'HMI', message: 'broken' }] })

    let closed = false
    const built: HmiPreviewBuild = {
      ok: true,
      wasm: new Uint8Array(),
      pages: { [HMI_GALLERY_SCREEN]: 0 },
      setters: {},
      elementIds: ELEMENT_IDS,
      warnings: [],
      stats: { units: 1, cached: 0, compileMs: 0, linkMs: 0 },
    }
    const stopped = await renderHmiThumbnails(
      sources,
      1,
      () => Promise.resolve(built),
      () => ({
        load: () => Promise.reject(new Error('the preview stopped')),
        frame: () => Promise.reject(new Error('not loaded')),
        show: () => Promise.resolve(),
        resize: () => Promise.resolve(),
        pointer: () => Promise.resolve(),
        key: () => Promise.resolve(),
        setNumber: () => Promise.resolve(false),
        setText: () => Promise.resolve(false),
        onStop: () => () => undefined,
        close: () => {
          closed = true
        },
      }),
    )
    expect(stopped).toEqual({
      thumbnails: [],
      errors: [{ file: 'HMI', message: 'The palette could not be drawn: the preview stopped' }],
    })
    expect(closed).toBe(true)
  })
})
