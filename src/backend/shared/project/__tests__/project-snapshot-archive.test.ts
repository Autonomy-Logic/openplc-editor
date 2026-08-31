/**
 * The archive stored on a device and read back from one.
 *
 * Two halves matter here. The round trip has to be exact, because anything the
 * archive loses is work the user cannot get back off the device. And the parse
 * side has to treat the archive as hostile input: it comes from a device where
 * the stored project is neither signed nor encrypted, so anyone with
 * filesystem access could have replaced it. Path traversal is the check that
 * actually bites -- a bomb only exhausts disk, while `../../` writes outside
 * the folder the user picked.
 */

import JSZip from 'jszip'

import type { WriteProjectFiles } from '../../../../middleware/shared/ports/project-port'
import {
  buildProjectSnapshot,
  hashLibraryArchive,
  hashText,
  parseProjectSnapshot,
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_LIBRARY_DIR,
  SNAPSHOT_LIMITS,
  SNAPSHOT_MANIFEST_PATH,
  assertSafeEntryPath,
  SnapshotArchiveError,
  toWriteProjectFiles,
  writeProjectFilesToMap,
  type SnapshotLibrary,
} from '../project-snapshot-archive'

function projectFiles(overrides: Partial<WriteProjectFiles> = {}): WriteProjectFiles {
  return {
    projectPath: '/tmp/project',
    projectJson: '{"meta":{"name":"Traffic Light"}}',
    deviceConfig: '{"board":"rpi"}',
    pinMapping: '{"pins":[]}',
    pouFiles: [
      { relativePath: 'pous/programs/MAIN.st', content: 'PROGRAM MAIN END_PROGRAM' },
      { relativePath: 'pous/function-blocks/TON2.st', content: 'FUNCTION_BLOCK TON2 END_FUNCTION_BLOCK' },
    ],
    serverFiles: [{ relativePath: 'devices/servers/modbus.json', content: '{"port":502}' }],
    remoteDeviceFiles: [{ relativePath: 'devices/remote/plc2.json', content: '{"ip":"10.0.0.2"}' }],
    dataTypeFiles: [{ relativePath: 'datatypes/Color.dt', content: 'TYPE Color END_TYPE' }],
    deletions: [],
    ...overrides,
  }
}

async function build(overrides: Partial<Parameters<typeof buildProjectSnapshot>[0]> = {}) {
  return buildProjectSnapshot({
    files: writeProjectFilesToMap(projectFiles()),
    projectName: 'Traffic Light',
    editorVersion: '4.2.0',
    uploadedBy: 'op',
    timestamp: '2026-08-31T12:00:00.000Z',
    ...overrides,
  })
}

async function library(name = 'Motion', version = '1.2.0'): Promise<SnapshotLibrary> {
  const archive = JSON.stringify({ name, version, blocks: [] })
  return { name, version, hash: await hashText(archive), archive }
}

// --- round trip ----------------------------------------------------------

describe('round trip', () => {
  it('carries every project file back unchanged', async () => {
    const original = projectFiles()
    const { archive } = await build({ files: writeProjectFilesToMap(original) })
    const parsed = await parseProjectSnapshot(archive)
    const restored = toWriteProjectFiles(parsed, '/somewhere/else')

    expect(restored.projectJson).toBe(original.projectJson)
    expect(restored.deviceConfig).toBe(original.deviceConfig)
    expect(restored.pinMapping).toBe(original.pinMapping)
    expect(restored.pouFiles).toEqual(expect.arrayContaining(original.pouFiles))
    expect(restored.pouFiles).toHaveLength(original.pouFiles.length)
    expect(restored.serverFiles).toEqual(original.serverFiles)
    expect(restored.remoteDeviceFiles).toEqual(original.remoteDeviceFiles)
    expect(restored.dataTypeFiles).toEqual(original.dataTypeFiles)
  })

  it('writes into the destination the caller chose, not the one the archive came from', async () => {
    const { archive } = await build()
    const restored = toWriteProjectFiles(await parseProjectSnapshot(archive), '/new/home')
    expect(restored.projectPath).toBe('/new/home')
  })

  it('never carries deletions across', async () => {
    // A retrieved project is written into an empty destination. Honouring
    // deletions from an archive would let a device name files to remove on the
    // opening machine.
    const { archive } = await build({
      files: writeProjectFilesToMap(projectFiles({ deletions: ['pous/programs/Gone.st'] })),
    })
    const restored = toWriteProjectFiles(await parseProjectSnapshot(archive), '/tmp/p')
    expect(restored.deletions).toEqual([])
  })

  it('keeps a library project manifest', async () => {
    const { archive } = await build({
      files: writeProjectFilesToMap(projectFiles({ libraryManifest: '{"name":"MyLib"}' })),
    })
    const restored = toWriteProjectFiles(await parseProjectSnapshot(archive), '/tmp/p')
    expect(restored.libraryManifest).toBe('{"name":"MyLib"}')
  })

  it('omits optional files a PLC project does not own rather than writing empty ones', async () => {
    const { archive } = await build({
      files: writeProjectFilesToMap(projectFiles({ deviceConfig: undefined, pinMapping: undefined })),
    })
    const restored = toWriteProjectFiles(await parseProjectSnapshot(archive), '/tmp/p')
    expect(restored.deviceConfig).toBeUndefined()
    expect(restored.pinMapping).toBeUndefined()
  })
})

// --- metadata ------------------------------------------------------------

describe('metadata', () => {
  it('is returned beside the bytes so the two cannot drift', async () => {
    // The device stores this separately and never opens the archive, so the
    // builder producing both is what keeps them describing the same thing.
    const { metadata } = await build()
    expect(metadata).toEqual({
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      projectName: 'Traffic Light',
      editorVersion: '4.2.0',
      uploadedBy: 'op',
      timestamp: '2026-08-31T12:00:00.000Z',
      libraries: [],
    })
  })

  it('matches the manifest embedded in the archive', async () => {
    const { archive, metadata } = await build()
    const parsed = await parseProjectSnapshot(archive)
    expect(parsed.metadata).toEqual(metadata)
  })
})

// --- libraries -----------------------------------------------------------

describe('libraries', () => {
  it('bundles archives so a retrieved project still compiles elsewhere', async () => {
    const motion = await library()
    const { archive, metadata } = await build({ libraries: [motion] })

    expect(metadata.libraries).toEqual([
      { name: motion.name, version: motion.version, hash: motion.hash },
    ])

    const parsed = await parseProjectSnapshot(archive)
    expect(parsed.libraries).toHaveLength(1)
    expect(parsed.libraries[0].archive).toBe(motion.archive)
    expect(parsed.libraries[0].name).toBe('Motion')
    expect(parsed.libraries[0].hash).toBe(motion.hash)
  })

  it('keeps library files out of the project tree', async () => {
    const { archive } = await build({ libraries: [await library()] })
    const parsed = await parseProjectSnapshot(archive)
    for (const path of parsed.files.keys()) {
      expect(path.startsWith(SNAPSHOT_LIBRARY_DIR)).toBe(false)
    }
  })

  it('distinguishes same name and version but different bytes', async () => {
    // The case that silently produces a different program, so the hash has to
    // be what identifies a library rather than the name/version pair.
    const first = await library('Motion', '1.2.0')
    const second: SnapshotLibrary = {
      name: 'Motion',
      version: '1.2.0',
      archive: JSON.stringify({ name: 'Motion', version: '1.2.0', blocks: ['tampered'] }),
      hash: await hashText(JSON.stringify({ name: 'Motion', version: '1.2.0', blocks: ['tampered'] })),
    }
    expect(first.hash).not.toBe(second.hash)
  })

  it('keeps two libraries whose names collide once sanitised', async () => {
    const a: SnapshotLibrary = { name: 'My Lib', version: '1', archive: 'A', hash: await hashText('A') }
    const b: SnapshotLibrary = { name: 'My/Lib', version: '1', archive: 'B', hash: await hashText('B') }
    const { archive } = await build({ libraries: [a, b] })
    const parsed = await parseProjectSnapshot(archive)
    expect(parsed.libraries.map((l) => l.archive).sort()).toEqual(['A', 'B'])
  })
})

describe('library identity', () => {
  it('ignores formatting so the two clients agree on the same library', async () => {
    // The editor holds an installed FILE; web holds the same archive parsed in
    // memory and never sees a file. Hashing raw text would make every project
    // uploaded from one and opened in the other report as differing -- the
    // exact false alarm the comparison exists to avoid.
    const pretty = JSON.stringify({ manifest: { name: 'Motion', version: '1' } }, null, 2)
    const compact = JSON.stringify({ manifest: { name: 'Motion', version: '1' } })
    expect(await hashLibraryArchive(pretty)).toBe(await hashLibraryArchive(compact))
  })

  it('still distinguishes a genuinely different archive', async () => {
    const theirs = JSON.stringify({ manifest: { name: 'Motion', version: '1' }, body: 'a' })
    const mine = JSON.stringify({ manifest: { name: 'Motion', version: '1' }, body: 'b' })
    expect(await hashLibraryArchive(theirs)).not.toBe(await hashLibraryArchive(mine))
  })

  it('falls back to hashing the bytes when the archive is not JSON', async () => {
    // No canonical form exists, and a stable hash of the bytes beats none.
    expect(await hashLibraryArchive('not json')).toBe(await hashText('not json'))
  })
})

// --- refusing hostile archives -------------------------------------------

describe('untrusted input', () => {
  async function zipWith(
    entries: Record<string, string>,
    includeManifest = true,
    compress = false,
  ): Promise<Uint8Array> {
    const zip = new JSZip()
    if (includeManifest) {
      zip.file(
        SNAPSHOT_MANIFEST_PATH,
        JSON.stringify({ formatVersion: SNAPSHOT_FORMAT_VERSION, projectName: 'P', libraries: [] }),
      )
    }
    for (const [path, content] of Object.entries(entries)) zip.file(path, content)
    // STORE by default so a fixture's declared sizes are predictable; the
    // ratio check needs a genuinely DEFLATEd entry to have a ratio at all.
    return zip.generateAsync(
      compress ? { type: 'uint8array', compression: 'DEFLATE' } : { type: 'uint8array' },
    )
  }

  it.each([
    ['../../../etc/passwd'],
    ['pous/../../escape.st'],
    ['..\\..\\evil.txt'],
    ['/etc/hosts'],
    ['C:/Windows/System32/x'],
    ['ok\u0000.st'],
  ])('refuses the entry path %s', (path) => {
    // Tested against the guard directly rather than through a built archive:
    // JSZip normalises a leading `../` away when it writes one, so a forged
    // traversal entry can only reach a reader from a hand-crafted archive.
    // Nothing here relies on that normalisation for correctness.
    expect(() => assertSafeEntryPath(path)).toThrow(SnapshotArchiveError)
  })

  it('accepts the ordinary project paths', () => {
    for (const path of ['project.json', 'pous/programs/MAIN.st', 'devices/servers/a.json']) {
      expect(() => assertSafeEntryPath(path)).not.toThrow()
    }
  })

  it('refuses a backslash-escaped path a Windows archive could carry', async () => {
    const archive = await zipWith({ 'project.json': '{}', '..\\..\\evil.txt': 'pwned' })
    await expect(parseProjectSnapshot(archive)).rejects.toThrow(/escapes the project/)
  })

  it('refuses an absolute path', async () => {
    const archive = await zipWith({ 'project.json': '{}', '/etc/hosts': 'pwned' })
    await expect(parseProjectSnapshot(archive)).rejects.toThrow(/absolute path/)
  })

  it('refuses a Windows drive-letter path', async () => {
    const archive = await zipWith({ 'project.json': '{}', 'C:/Windows/System32/x': 'pwned' })
    await expect(parseProjectSnapshot(archive)).rejects.toThrow(/absolute path/)
  })

  it('yields nothing at all when one entry is bad', async () => {
    // Validation completes before any content is handed back, so a rejected
    // archive can never leave a half-written project behind.
    const archive = await zipWith({ 'project.json': '{"real":true}', '/etc/escape.txt': 'x' })
    await expect(parseProjectSnapshot(archive)).rejects.toThrow(SnapshotArchiveError)
  })

  it('refuses bytes that are not a ZIP', async () => {
    await expect(parseProjectSnapshot(new TextEncoder().encode('not a zip'))).rejects.toThrow(
      /not a readable project archive/i,
    )
  })

  it('refuses an archive with no manifest', async () => {
    const archive = await zipWith({ 'project.json': '{}' }, false)
    await expect(parseProjectSnapshot(archive)).rejects.toThrow(/no project snapshot manifest/)
  })

  it('refuses an archive with no project.json', async () => {
    const archive = await zipWith({ 'pous/programs/MAIN.st': 'x' })
    await expect(parseProjectSnapshot(archive)).rejects.toThrow(/no project.json/)
  })

  it('refuses a manifest that is not JSON', async () => {
    const zip = new JSZip()
    zip.file(SNAPSHOT_MANIFEST_PATH, 'not json at all')
    zip.file('project.json', '{}')
    await expect(parseProjectSnapshot(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /not valid JSON/,
    )
  })

  it('refuses an archive written by a newer editor rather than guessing', async () => {
    const zip = new JSZip()
    zip.file(
      SNAPSHOT_MANIFEST_PATH,
      JSON.stringify({ formatVersion: SNAPSHOT_FORMAT_VERSION + 1, projectName: 'P', libraries: [] }),
    )
    zip.file('project.json', '{}')
    await expect(parseProjectSnapshot(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /newer editor/,
    )
  })

  it('refuses an archive with too many entries', async () => {
    const entries: Record<string, string> = { 'project.json': '{}' }
    for (let i = 0; i < 10; i += 1) entries[`pous/programs/P${i}.st`] = 'x'
    const archive = await zipWith(entries)
    await expect(
      parseProjectSnapshot(archive, { ...SNAPSHOT_LIMITS, maxEntries: 5 }),
    ).rejects.toThrow(/too many files/)
  })

  it('refuses an archive larger than the total limit', async () => {
    const archive = await zipWith({ 'project.json': '{}', 'pous/programs/Big.st': 'x'.repeat(5_000) })
    await expect(
      parseProjectSnapshot(archive, { ...SNAPSHOT_LIMITS, maxTotalBytes: 100 }),
    ).rejects.toThrow(/too large uncompressed|beyond the size limit/)
  })

  it('refuses a single entry larger than the per-entry limit', async () => {
    const archive = await zipWith({ 'project.json': '{}', 'pous/programs/Big.st': 'x'.repeat(5_000) })
    await expect(
      parseProjectSnapshot(archive, { ...SNAPSHOT_LIMITS, maxEntryBytes: 100 }),
    ).rejects.toThrow(/entry is too large/)
  })

  it('refuses an entry whose compression ratio looks like a bomb', async () => {
    // Highly compressible filler stands in for the real thing: what matters is
    // that the ratio is judged from the DECLARED sizes, before anything is
    // decompressed, because decompressing is the part that hurts.
    const archive = await zipWith(
      { 'project.json': '{}', 'pous/programs/Bomb.st': 'a'.repeat(200_000) },
      true,
      true,
    )
    await expect(
      parseProjectSnapshot(archive, { ...SNAPSHOT_LIMITS, maxCompressionRatio: 2 }),
    ).rejects.toThrow(/compression ratio/)
  })

  it('accepts a normal project under the real limits', async () => {
    const { archive } = await build()
    await expect(parseProjectSnapshot(archive)).resolves.toBeDefined()
  })

  it('drops files it cannot place rather than guessing at a location', async () => {
    // A path the writer cannot map is a file the next save would lose anyway,
    // so surfacing it as a project file would be a lie.
    const archive = await zipWith({ 'project.json': '{}', 'somewhere/odd/file.txt': 'x' })
    const restored = toWriteProjectFiles(await parseProjectSnapshot(archive), '/tmp/p')
    expect(restored.pouFiles).toHaveLength(0)
    expect(restored.dataTypeFiles).toHaveLength(0)
  })
})
