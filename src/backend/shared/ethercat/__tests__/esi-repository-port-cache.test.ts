import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  EsiParserMechanism,
  EsiRowStore,
  EsiStoredRow,
} from '@root/middleware/shared/ports/esi-repository-mechanisms'
import { decodeXmlBytes } from '@root/middleware/shared/utils/ethercat/esi-zip-import'

import { toRepositoryItem as coreToRepositoryItem } from '../../device-description/description-repository'
import { runEsiParseOp } from '../esi-parse-ops'
import { createEsiRepositoryPort, toRepositoryItem } from '../esi-repository-port'

const read = (name: string): string =>
  decodeXmlBytes(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'esi-real', name))))

const AXL_COUPLER = read('phoenix-axl-f-bk-ec.xml')
const EK1818 = read('beckhoff-ek1818.xml')

/** A parser that runs the real parse ops and counts the `deviceFull` runs. */
function countingParser() {
  let deviceFullRuns = 0
  const parser: EsiParserMechanism = {
    run: (request) => {
      if (request.op === 'deviceFull') deviceFullRuns++
      return Promise.resolve(runEsiParseOp(request))
    },
  }
  return { parser, deviceFullRuns: () => deviceFullRuns }
}

/** A store that only keeps what it is given and records the ids whose XML was read. */
function memoryStore() {
  const rows: EsiStoredRow[] = []
  const xml = new Map<string, string>()
  const xmlReads: string[] = []
  const store: EsiRowStore = {
    list: () => Promise.resolve(rows.map((r) => ({ ...r }))),
    insert: (row, text) => {
      rows.push(row)
      xml.set(row.id, text)
      return Promise.resolve(row)
    },
    update: (row) => {
      rows.splice(
        rows.findIndex((r) => r.id === row.id),
        1,
        row,
      )
      return Promise.resolve()
    },
    remove: (id) => {
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      )
      xml.delete(id)
      return Promise.resolve()
    },
    clear: () => {
      rows.length = 0
      xml.clear()
      return Promise.resolve()
    },
    readXml: (id) => {
      xmlReads.push(id)
      const text = xml.get(id)
      return text === undefined ? Promise.reject(new Error('XML file not found')) : Promise.resolve(text)
    },
  }
  return { store, xmlReads: (id: string) => xmlReads.filter((readId) => readId === id).length }
}

/** A port over a counting parser and an in-memory store, with the given files uploaded. */
async function portWith(...files: Array<readonly [string, string]>) {
  const counting = countingParser()
  const memory = memoryStore()
  const port = createEsiRepositoryPort({ parser: counting.parser, store: memory.store })
  const ids: string[] = []
  for (const [filename, content] of files) {
    const upload = await port.parseAndSaveFile(filename, content)
    if (!upload.success || !upload.item) throw new Error(`upload of ${filename} failed`)
    ids.push(upload.item.id)
  }
  return { port, ids, deviceFullRuns: counting.deviceFullRuns, xmlReads: memory.xmlReads }
}

describe('ESI repository port device cache', () => {
  it('parses a device once per item and index, and hands each caller its own copy', async () => {
    const { port, ids, deviceFullRuns } = await portWith(['coupler.xml', AXL_COUPLER] as const)

    const first = await port.loadDeviceFull(ids[0], 0)
    const second = await port.loadDeviceFull(ids[0], 0)

    if (!first.success || !second.success) throw new Error('device load failed')
    expect(deviceFullRuns()).toBe(1)
    expect(second.device).toEqual(first.device)
    expect(second.device).not.toBe(first.device)
  })

  it('evicts the cached devices of a deleted item, so the next load reads its XML again', async () => {
    const { port, ids, xmlReads } = await portWith(
      ['coupler.xml', AXL_COUPLER] as const,
      ['ek1818.xml', EK1818] as const,
    )
    const [itemA, itemB] = ids
    expect((await port.loadDeviceFull(itemA, 0)).success).toBe(true)
    await port.loadDeviceFull(itemA, 0)
    await port.loadDeviceFull(itemB, 0)
    const readsBefore = xmlReads(itemA)

    expect(await port.deleteRepositoryItem(itemA)).toEqual({ success: true })

    expect(await port.loadDeviceFull(itemA, 0)).toEqual({ success: false, error: 'XML file not found' })
    expect(xmlReads(itemA)).toBe(readsBefore + 1)
  })

  it('keeps the cached devices of the other items when one item is deleted', async () => {
    const { port, ids, deviceFullRuns } = await portWith(
      ['coupler.xml', AXL_COUPLER] as const,
      ['ek1818.xml', EK1818] as const,
    )
    const [itemA, itemB] = ids
    await port.loadDeviceFull(itemA, 0)
    await port.loadDeviceFull(itemA, 0)
    expect((await port.loadDeviceFull(itemB, 0)).success).toBe(true)
    expect(deviceFullRuns()).toBe(2)

    await port.deleteRepositoryItem(itemA)

    expect(await port.loadDeviceFull(itemB, 0)).toMatchObject({ success: true })
    expect(deviceFullRuns()).toBe(2)
  })

  it('evicts every cached device on clear, so the next load reads the XML again', async () => {
    const { port, ids, xmlReads } = await portWith(['coupler.xml', AXL_COUPLER] as const)
    expect((await port.loadDeviceFull(ids[0], 0)).success).toBe(true)
    const readsBefore = xmlReads(ids[0])

    expect(await port.clearRepository()).toEqual({ success: true })

    expect(await port.loadDeviceFull(ids[0], 0)).toEqual({ success: false, error: 'XML file not found' })
    expect(xmlReads(ids[0])).toBe(readsBefore + 1)
  })
})

describe('ESI repository port item mapping', () => {
  it('re-exports the core row-to-item mapping', () => {
    expect(toRepositoryItem).toBe(coreToRepositoryItem)
  })

  it('maps a stored row to its summary plus the row identity, without the storage fields', () => {
    const row: EsiStoredRow & { summary: NonNullable<EsiStoredRow['summary']> } = {
      id: 'item-1',
      filename: 'coupler.xml',
      loadedAt: '2026-01-01T00:00:00.000Z',
      contentHash: 'abc',
      summaryVersion: 2,
      summary: { vendor: { id: '0x1', name: 'Vendor' }, devices: [] },
    }

    expect(toRepositoryItem(row)).toEqual({
      vendor: { id: '0x1', name: 'Vendor' },
      devices: [],
      id: 'item-1',
      filename: 'coupler.xml',
      loadedAt: '2026-01-01T00:00:00.000Z',
    })
  })
})
