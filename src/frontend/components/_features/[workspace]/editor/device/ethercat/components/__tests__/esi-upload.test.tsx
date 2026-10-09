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

// The two EsiPort methods the upload flow touches. ZIP expansion is a pure
// shared-utility call (`importESIZip` from middleware/shared/utils/ethercat),
// not a port method — jszip works identically in both runtimes so the port
// surface stays minimal and the adapters only carry what architecturally
// differs between web and desktop.
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

/**
 * DOPE-704 E1 UI: ZIP import.
 *
 * The upload component accepts a .zip file alongside .xml files. For a ZIP it calls
 * the pure `importESIZip` helper from middleware/shared/utils/ethercat (works in
 * Node and browser identically — no port needed), then feeds each imported XML
 * through the same `parseAndSaveFile` loop a plain .xml upload uses. Dropped
 * entries land in the error report with the "<zipname> → <entry>" prefix the user
 * needs to find them.
 *
 * Tests drive real ZIP bytes through the real importESIZip, which keeps the UI
 * contract honest end-to-end instead of mocking around the pure helper.
 */
import JSZip from 'jszip'

async function makeZipFile(name: string, entries: Array<{ path: string; content: string }>): Promise<File> {
  const zip = new JSZip()
  for (const entry of entries) zip.file(entry.path, entry.content)
  const buf = await zip.generateAsync({ type: 'uint8array' })
  const file = new File([buf], name, { type: 'application/zip' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(buf.buffer) })
  return file
}

describe('ESIUpload — ZIP import (DOPE-704 E1)', () => {
  beforeEach(() => {
    mockEsi.parseAndSaveFile.mockReset()
    mockEsi.loadRepositoryLight.mockReset()
  })

  it('expands a ZIP and saves every imported ESI through parseAndSaveFile', async () => {
    const zip = await makeZipFile('ur20.zip', [
      { path: 'ur20-coupler.xml', content: '<EtherCATInfo />' },
      { path: 'modules/ur20-slot.xml', content: '<EtherCATInfo />' },
    ])
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: true, item: SAMPLE_ITEM })
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({
      success: true,
      item: { ...SAMPLE_ITEM, id: 'item-2', filename: 'ur20-slot.xml' },
    })

    const onFilesLoaded = vi.fn()
    const { container } = renderUpload(onFilesLoaded, [])
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [zip] } })

    await waitFor(() => expect(mockEsi.parseAndSaveFile).toHaveBeenCalledTimes(2))
    const calls = mockEsi.parseAndSaveFile.mock.calls.map((c) => c[0] as string).sort()
    expect(calls).toEqual(['ur20-coupler.xml', 'ur20-slot.xml'])
  })

  it('reports dropped ZIP entries with a <zipname> → <entry> prefix', async () => {
    const zip = await makeZipFile('weidmueller.zip', [
      { path: 'ur20-coupler.xml', content: '<EtherCATInfo />' },
      { path: 'readme.txt', content: 'hello' },
    ])
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: true, item: SAMPLE_ITEM })

    const onFilesLoaded = vi.fn()
    const { container } = renderUpload(onFilesLoaded, [])
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [zip] } })

    await waitFor(() => expect(onFilesLoaded).toHaveBeenCalled())
    const errors = onFilesLoaded.mock.calls[0]?.[1] as Array<{ filename: string; error: string }> | undefined
    expect(errors?.some((e) => e.filename === 'weidmueller.zip → readme.txt')).toBe(true)
  })

  it('reports a ZIP containing no .xml entries as an explicit error', async () => {
    const zip = await makeZipFile('empty.zip', [])

    const onFilesLoaded = vi.fn()
    const { container } = renderUpload(onFilesLoaded, [])
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [zip] } })

    await waitFor(() => expect(onFilesLoaded).toHaveBeenCalled())
    const errors = onFilesLoaded.mock.calls[0]?.[1] as Array<{ filename: string; error: string }> | undefined
    expect(errors?.some((e) => e.filename === 'empty.zip' && e.error.includes('no .xml'))).toBe(true)
    expect(mockEsi.parseAndSaveFile).not.toHaveBeenCalled()
  })

  it('mixes XML files and ZIP contents in a single upload', async () => {
    const zip = await makeZipFile('ur20.zip', [{ path: 'inside.xml', content: '<EtherCATInfo />' }])
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: true, item: SAMPLE_ITEM })
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({
      success: true,
      item: { ...SAMPLE_ITEM, id: 'item-zip', filename: 'inside.xml' },
    })

    const onFilesLoaded = vi.fn()
    const { container } = renderUpload(onFilesLoaded, [])
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [xmlFile(), zip] } })

    await waitFor(() => expect(mockEsi.parseAndSaveFile).toHaveBeenCalledTimes(2))
    // XML inputs are processed first in the work queue, then ZIP-expanded entries.
    expect(mockEsi.parseAndSaveFile).toHaveBeenNthCalledWith(1, 'Beckhoff.xml', '<xml />')
    expect(mockEsi.parseAndSaveFile).toHaveBeenNthCalledWith(2, 'inside.xml', '<EtherCATInfo />')
  })
})
