/**
 * The desktop's ESI storage mechanism stores what it is given and nothing else.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ESIRepositorySummary } from '@root/middleware/shared/ports/esi-repository-mechanisms'

import { EsiDiskStore } from '../esi-disk-store'

const SUMMARY = {
  vendor: { id: '0x84', name: 'Phoenix Contact' },
  devices: [],
  modules: [{ ident: '0x000200D6', name: 'AXL F DI16/1 1H' }],
  aFieldAddedLater: { kept: true },
} as unknown as ESIRepositorySummary

describe('EsiDiskStore', () => {
  let project: string
  const store = new EsiDiskStore()

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'esi-store-'))
  })
  afterEach(() => rmSync(project, { recursive: true, force: true }))

  it('returns the summary exactly as it was stored', async () => {
    const { record } = await store.upload(project, { filename: 'a.xml', content: '<x/>', summary: SUMMARY })

    expect((await store.list(project))[0]).toEqual({ ...record, summary: SUMMARY })
    expect(await store.readXml(project, record!.id)).toBe('<x/>')
  })

  it('reports identical bytes as a duplicate whatever the filename, and echoes the stored row', async () => {
    const first = await store.upload(project, { filename: 'a.xml', content: '<x/>', summary: SUMMARY })
    const again = await store.upload(project, { filename: 'b.xml', content: '<x/>', summary: SUMMARY })

    expect(again).toEqual({ record: first.record, duplicate: true, retried: false })
    expect(await store.list(project)).toHaveLength(1)
  })

  it('reads an index written by Editor 4.3.3 as rows without a summary, and upgrades a row once given one', async () => {
    const esiDir = join(project, 'devices', 'esi')
    mkdirSync(esiDir, { recursive: true })
    const id = '5279f43b-65a4-479c-90f1-4c04acd45c57'
    writeFileSync(join(esiDir, `${id}.xml`), '<legacy/>')
    writeFileSync(
      join(esiDir, 'repository.json'),
      JSON.stringify({
        version: 2,
        items: [
          { id, filename: 'm.xml', vendorId: '0x84', vendorName: 'Phoenix', deviceCount: 0, loadedAt: 0, devices: [] },
        ],
      }),
    )

    expect(await store.list(project)).toEqual([{ id, filename: 'm.xml', loadedAt: '1970-01-01T00:00:00.000Z' }])

    await store.saveSummary(project, id, SUMMARY)

    const index = JSON.parse(readFileSync(join(esiDir, 'repository.json'), 'utf-8')) as { version: number }
    expect(index.version).toBe(3)
    expect((await store.list(project))[0].summary).toEqual(SUMMARY)
    const dup = await store.upload(project, { filename: 'other.xml', content: '<legacy/>', summary: SUMMARY })
    expect(dup.duplicate).toBe(true)
  })

  it('removes a row and its XML, and refuses ids that are not UUIDs', async () => {
    const { record } = await store.upload(project, { filename: 'a.xml', content: '<x/>', summary: SUMMARY })

    await store.remove(project, record!.id)

    expect(await store.list(project)).toEqual([])
    await expect(store.readXml(project, record!.id)).rejects.toThrow('XML file not found')
    await expect(store.readXml(project, '../../etc/passwd')).rejects.toThrow('Invalid item ID')
  })
})
