import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type { ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { fireEvent, render, waitFor } from '@testing-library/react'

import { ESIUpload } from '../esi-upload'

/** A port whose every method answers `undefined`, except the ones handed in. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

// The two EsiPort methods the upload flow touches.
const mockEsi = {
  parseAndSaveFile: vi.fn(),
  loadRepositoryLight: vi.fn(),
}

const ports: PlatformPorts = {
  compiler: stubPort(),
  runtime: stubPort(),
  debugger: stubPort(),
  simulator: stubPort(),
  project: stubPort(),
  device: stubPort(),
  orchestrator: stubPort(),
  system: stubPort(),
  window: stubPort(),
  accelerator: stubPort(),
  theme: stubPort(),
  versionControl: stubPort(),
  navigation: stubPort(),
  library: stubPort(),
  esi: stubPort<EsiPort>(mockEsi),
  capabilities: WEB_CAPABILITIES,
}

function renderUpload(onFilesLoaded: () => void, repository: ESIRepositoryItemLight[]) {
  return render(<ESIUpload onFilesLoaded={onFilesLoaded} repository={repository} />, {
    wrapper: createStoreWrapper(createTestStore(), ports),
  })
}

const SAMPLE_ITEM: ESIRepositoryItemLight = {
  id: 'item-1',
  filename: 'Beckhoff.xml',
  vendor: { id: '0x0002', name: 'Beckhoff' },
  devices: [],
  loadedAt: '2026-01-01T00:00:00.000Z',
}

/** Build an XML File whose `.text()` resolves regardless of jsdom version. */
function xmlFile(name = 'Beckhoff.xml', content = '<xml />'): File {
  const file = new File([content], name, { type: 'text/xml' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) })
  return file
}

/** Render the component and drive a single-file upload through the input. */
function uploadFile(repository: ESIRepositoryItemLight[] = []) {
  const onFilesLoaded = vi.fn()
  const { container } = renderUpload(onFilesLoaded, repository)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [xmlFile()] } })
  return { onFilesLoaded }
}

describe('ESIUpload — dedupAfterRetry handling', () => {
  beforeEach(() => {
    mockEsi.parseAndSaveFile.mockReset()
    mockEsi.loadRepositoryLight.mockReset()
  })

  it('appends a newly added item without re-listing the repository', async () => {
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: true, item: SAMPLE_ITEM })

    const { onFilesLoaded } = uploadFile()

    await waitFor(() => expect(onFilesLoaded).toHaveBeenCalled())
    expect(onFilesLoaded).toHaveBeenCalledWith([SAMPLE_ITEM], undefined)
    expect(mockEsi.loadRepositoryLight).not.toHaveBeenCalled()
  })

  it('re-lists the repository when a dedupAfterRetry lands without an item', async () => {
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: true, dedupAfterRetry: true })
    mockEsi.loadRepositoryLight.mockResolvedValueOnce({ success: true, items: [SAMPLE_ITEM] })

    const { onFilesLoaded } = uploadFile()

    await waitFor(() => expect(onFilesLoaded).toHaveBeenCalled())
    expect(mockEsi.loadRepositoryLight).toHaveBeenCalledTimes(1)
    // The refreshed list is authoritative — the recovered row appears here.
    expect(onFilesLoaded).toHaveBeenCalledWith([SAMPLE_ITEM], undefined)
  })

  it('falls back to the local list when the refresh itself fails', async () => {
    const existing: ESIRepositoryItemLight[] = [{ ...SAMPLE_ITEM, id: 'old', filename: 'Old.xml' }]
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: true, dedupAfterRetry: true })
    mockEsi.loadRepositoryLight.mockResolvedValueOnce({ success: false, error: 'list failed' })

    const onFilesLoaded = vi.fn()
    const { container } = renderUpload(onFilesLoaded, existing)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [xmlFile()] } })

    await waitFor(() => expect(onFilesLoaded).toHaveBeenCalled())
    expect(mockEsi.loadRepositoryLight).toHaveBeenCalledTimes(1)
    // No new item was returned, so the fallback keeps the existing repository.
    expect(onFilesLoaded).toHaveBeenCalledWith(existing, undefined)
  })

  it('dedups a recovered add that already exists in the repository', async () => {
    // dedupAfterRetry recovery: the retry hit the backend dedup against a row
    // that was already present in `repository`, and the adapter returns that
    // same row as `item`. The merged list must not contain it twice.
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: true, item: SAMPLE_ITEM, dedupAfterRetry: true })

    const { onFilesLoaded } = uploadFile([SAMPLE_ITEM])

    await waitFor(() => expect(onFilesLoaded).toHaveBeenCalled())
    expect(onFilesLoaded).toHaveBeenCalledWith([SAMPLE_ITEM], undefined)
    expect(mockEsi.loadRepositoryLight).not.toHaveBeenCalled()
  })

  it('skips a real duplicate silently without re-listing', async () => {
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: true, duplicate: true })

    const { onFilesLoaded } = uploadFile()

    await waitFor(() => expect(onFilesLoaded).toHaveBeenCalled())
    expect(onFilesLoaded).toHaveBeenCalledWith([], undefined)
    expect(mockEsi.loadRepositoryLight).not.toHaveBeenCalled()
  })
})
