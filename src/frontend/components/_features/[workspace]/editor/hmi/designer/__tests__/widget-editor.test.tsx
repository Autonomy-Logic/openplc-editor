/**
 * @jest-environment jsdom
 */
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import type { HmiPreviewPort, HmiPreviewSession, HmiPreviewStart } from '@root/middleware/shared/ports/hmi-preview-port'
import { WIDGET_PREVIEW_SCREEN } from '@root/middleware/shared/ports/hmi-preview-types'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import { cleanup, render, waitFor } from '@testing-library/react'

import { HmiWidgetEditor } from '../hmi-designer'

/** jsdom has no ImageData; the preview only stores pixels in it. */
class TestImageData {
  readonly data: Uint8ClampedArray
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}
if (typeof globalThis.ImageData === 'undefined') Reflect.set(globalThis, 'ImageData', TestImageData)

afterEach(cleanup)

describe('HmiWidgetEditor', () => {
  it("starts the widget's own preview page, not the project's first screen", async () => {
    const starts: HmiPreviewStart[] = []
    const session: HmiPreviewSession = {
      load: (_wasm, start) => {
        starts.push(start)
        return Promise.resolve()
      },
      frame: () => Promise.resolve({ page: 0, status: 0, pixels: null, bounds: [] }),
      show: () => Promise.resolve(),
      resize: () => Promise.resolve(),
      pointer: () => Promise.resolve(),
      key: () => Promise.resolve(),
      setNumber: () => Promise.resolve(true),
      setText: () => Promise.resolve(true),
      change: () => Promise.resolve([]),
      onStop: () => () => undefined,
      close: () => undefined,
    }
    const hmiPreview: HmiPreviewPort = {
      build: () =>
        Promise.resolve({
          ok: true,
          wasm: new Uint8Array([0]),
          pages: { Overview: 0, [WIDGET_PREVIEW_SCREEN]: 1 },
          setters: {},
          elementIds: [],
          factory: { types: {} },
          warnings: [],
          stats: { units: 1, cached: 1 },
        }),
      catalog: () => Promise.reject(new Error('not used')),
      thumbnails: () => Promise.reject(new Error('not used')),
      codeContext: () => Promise.reject(new Error('not used')),
      openSession: () => session,
      holdToolchain: () => Promise.resolve(),
    }
    const store = createTestStore()
    store.getState().hmiActions.create('screen', 'Overview')
    store.getState().hmiActions.create('widget', 'Badge')
    const ports = createTestPorts({ capabilities: EDITOR_CAPABILITIES, hmiPreview })
    render(<HmiWidgetEditor name='Badge' />, { wrapper: createStoreWrapper(store, ports) })
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0].page).toBe(1)
  })
})
