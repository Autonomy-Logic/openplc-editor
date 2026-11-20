import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type { ESIDeviceSummary, ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { ESIRepository } from '../esi-repository'
import { ESIRepositoryTable } from '../esi-repository-table'
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

/** The EsiPort methods the upload flow calls. */
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

/** Build a device summary with an invented identity. */
function device(name: string, productCode: string): ESIDeviceSummary {
  return {
    type: { productCode, revisionNo: '0x00000001', name },
    name,
    inputChannelCount: 0,
    outputChannelCount: 0,
    totalInputBytes: 0,
    totalOutputBytes: 0,
  }
}

const FIRST_ITEM: ESIRepositoryItemLight = {
  id: 'item-a',
  filename: 'Alpha Coupler.xml',
  vendor: { id: '0x00000A01', name: 'Alpha Devices' },
  devices: [device('AX100', '0x00000101'), device('AX200', '0x00000102')],
  loadedAt: '2026-01-01T00:00:00.000Z',
  warnings: ['Synthetic warning'],
}

const SECOND_ITEM: ESIRepositoryItemLight = {
  id: 'item-b',
  filename: 'beta-io.xml',
  vendor: { id: '0x00000B02', name: 'Beta IO' },
  devices: [device('BX10', '0x00000201')],
  loadedAt: '2026-01-02T00:00:00.000Z',
}

/** Render the repository table with spies for its two callbacks. */
function renderTable(repository: ESIRepositoryItemLight[]) {
  const onRemoveItem = vi.fn()
  const onClearAll = vi.fn()
  render(<ESIRepositoryTable repository={repository} onRemoveItem={onRemoveItem} onClearAll={onClearAll} />)
  return { onRemoveItem, onClearAll }
}

/** Find the repository row whose `data-filename` matches the given filename. */
function rowFor(filename: string): HTMLElement {
  const row = screen.getAllByTestId('esi-repository-row').find((r) => r.getAttribute('data-filename') === filename)
  if (row === undefined) throw new Error(`No esi-repository-row with data-filename "${filename}"`)
  return row
}

/** Build an XML File whose `.text()` and `.arrayBuffer()` resolve regardless of jsdom version. */
function xmlFile(name: string, content = '<xml />'): File {
  const file = new File([content], name, { type: 'text/xml' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) })
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(new TextEncoder().encode(content).buffer),
  })
  return file
}

/** Locate the upload file input through the drop zone's accessible name, independent of test ids. */
function fileInput(): Element {
  const input = screen
    .getByRole('button', { name: 'Upload ESI XML files. Click or drag and drop.' })
    .querySelector('input[type="file"]')
  if (input === null) throw new Error('No file input inside the upload drop zone')
  return input
}

describe('ESIRepositoryTable test ids', () => {
  it('marks the empty state and renders no count header when the repository is empty', () => {
    renderTable([])

    expect(screen.getByTestId('esi-repository-empty').textContent).toContain('No ESI files loaded.')
    expect(screen.queryByTestId('esi-repository-count')).toBeNull()
  })

  it('marks the count header without changing its text', () => {
    renderTable([FIRST_ITEM, SECOND_ITEM])

    expect(screen.getByTestId('esi-repository-count').textContent).toBe('Loaded Files (2) - 3 device(s)')
    expect(screen.queryByTestId('esi-repository-empty')).toBeNull()
  })

  it('renders one esi-repository-row per item, each carrying its filename in data-filename', () => {
    renderTable([FIRST_ITEM, SECOND_ITEM])

    const filenames = screen.getAllByTestId('esi-repository-row').map((r) => r.getAttribute('data-filename'))
    expect(filenames).toEqual(['Alpha Coupler.xml', 'beta-io.xml'])
  })

  it('keeps esi-repository-row on the main rows only when an item is expanded', () => {
    renderTable([FIRST_ITEM, SECOND_ITEM])

    fireEvent.click(screen.getByRole('button', { name: 'Expand Alpha Coupler.xml' }))

    expect(screen.getByText('AX100')).toBeTruthy()
    expect(screen.getAllByTestId('esi-repository-row')).toHaveLength(2)
  })

  it('places exactly one esi-repository-remove inside each row', () => {
    renderTable([FIRST_ITEM, SECOND_ITEM])

    expect(within(rowFor('Alpha Coupler.xml')).getAllByTestId('esi-repository-remove')).toHaveLength(1)
    expect(within(rowFor('beta-io.xml')).getAllByTestId('esi-repository-remove')).toHaveLength(1)
  })

  it("removes the row's own item when that row's esi-repository-remove is clicked", () => {
    const { onRemoveItem } = renderTable([FIRST_ITEM, SECOND_ITEM])

    fireEvent.click(within(rowFor('beta-io.xml')).getByTestId('esi-repository-remove'))

    expect(onRemoveItem).toHaveBeenCalledTimes(1)
    expect(onRemoveItem).toHaveBeenCalledWith('item-b')
  })

  it('clears the repository when esi-repository-clear-all is clicked', () => {
    const { onClearAll, onRemoveItem } = renderTable([FIRST_ITEM, SECOND_ITEM])

    const clearAll = screen.getByTestId('esi-repository-clear-all')
    expect(clearAll.textContent).toBe('Clear All')
    fireEvent.click(clearAll)

    expect(onClearAll).toHaveBeenCalledTimes(1)
    expect(onRemoveItem).not.toHaveBeenCalled()
  })
})

describe('ESIUpload test ids', () => {
  it('marks the drop zone and the file input inside it', () => {
    render(<ESIUpload onFilesLoaded={vi.fn()} repository={[]} />, {
      wrapper: createStoreWrapper(createTestStore(), ports),
    })

    const dropzone = screen.getByTestId('esi-upload-dropzone')
    expect(dropzone.getAttribute('role')).toBe('button')
    const input = within(dropzone).getByTestId('esi-upload-input')
    expect(input.getAttribute('type')).toBe('file')
  })
})

describe('ESIRepository test ids', () => {
  beforeEach(() => {
    mockEsi.parseAndSaveFile.mockReset()
    mockEsi.loadRepositoryLight.mockReset()
  })

  it('marks the upload error summary after a failed upload', async () => {
    mockEsi.parseAndSaveFile.mockResolvedValueOnce({ success: false, error: 'Invalid ESI' })
    render(<ESIRepository repository={[]} onRepositoryChange={vi.fn()} projectPath='' />, {
      wrapper: createStoreWrapper(createTestStore(), ports),
    })
    expect(screen.queryByTestId('esi-upload-errors')).toBeNull()

    fireEvent.change(fileInput(), { target: { files: [xmlFile('broken.xml')] } })

    await waitFor(() => expect(screen.getByText('1 file(s) failed to parse')).toBeTruthy())
    expect(screen.getByTestId('esi-upload-errors').textContent).toContain('1 file(s) failed to parse')
  })
})
