import type { ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import { fireEvent, render, waitFor } from '@testing-library/react'

// Mocked EsiPort surface — the two methods the upload flow touches.
//
// Cross-runner compatibility relies on two independent mechanisms:
//   - Under Vitest, `vi.mock` is hoisted above imports, so the factory runs
//     before `import { ESIUpload }`. A hoisted factory may only reference names
//     that survive hoisting — hence the `mock`-prefixed `mockEsi`, read lazily
//     when `useEsi()` is called at render time (not at factory-eval time).
//   - Under the editor's Jest+vi shim, `vi.mock` is NOT hoisted (ts-jest's
//     transformer only hoists `jest.mock`). It works because the
//     `import { ESIUpload }` below is deliberately placed AFTER this `vi.mock`
//     call. That import position is load-bearing: do NOT move it into the top
//     import block, or ESIUpload binds to the real platform-context module
//     before the mock is registered.
const mockEsi = {
  parseAndSaveFile: vi.fn(),
  loadRepositoryLight: vi.fn(),
}

vi.mock('@root/middleware/shared/providers/platform-context', () => ({
  useEsi: () => mockEsi,
}))

import { ESIUpload } from '../esi-upload'

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
  const { container } = render(<ESIUpload onFilesLoaded={onFilesLoaded} repository={repository} />)
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
    const { container } = render(<ESIUpload onFilesLoaded={onFilesLoaded} repository={existing} />)
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
