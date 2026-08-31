/**
 * Writing a retrieved project to disk.
 *
 * The archive comes from a device where the stored project is neither signed
 * nor encrypted, so anyone with filesystem access could have replaced it. It is
 * untrusted input all the way to the write, and a rejected archive has to leave
 * nothing behind -- a partially written project would be worse than none, since
 * it looks openable.
 *
 * The project name is part of that: it lands in a filesystem path here, so it
 * gets the same treatment as any other untrusted path segment.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import JSZip from 'jszip'

import {
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_MANIFEST_PATH,
  SnapshotArchiveError,
  buildProjectSnapshot,
  hashText,
} from '../../../shared/project/project-snapshot-archive'
import { materializeRetrievedProject, safeFolderName } from '../materialize-retrieved-project'

let scratchRoot: string

beforeEach(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'openplc-retrieve-'))
})

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

async function makeArchive(
  files: Record<string, string> = {
    'project.json': '{"meta":{"name":"Traffic Light"}}',
    'pous/programs/MAIN.st': 'PROGRAM MAIN END_PROGRAM',
  },
  projectName = 'Traffic Light',
): Promise<Uint8Array> {
  const built = await buildProjectSnapshot({
    files: new Map(Object.entries(files)),
    projectName,
    editorVersion: '4.2.0',
    uploadedBy: 'op',
    timestamp: '2026-08-31T12:00:00.000Z',
  })
  return built.archive
}

// --- the happy path ------------------------------------------------------

describe('materializeRetrievedProject', () => {
  it('writes the project tree into a fresh directory', async () => {
    const result = await materializeRetrievedProject(await makeArchive(), {
      scratchRoot,
      folderName: 'proj',
    })

    expect(result.projectPath).toBe(join(scratchRoot, 'proj'))
    expect(result.projectName).toBe('Traffic Light')
    expect(readFileSync(join(result.projectPath, 'project.json'), 'utf-8')).toContain('Traffic Light')
    expect(readFileSync(join(result.projectPath, 'pous/programs/MAIN.st'), 'utf-8')).toBe(
      'PROGRAM MAIN END_PROGRAM',
    )
  })

  it('never writes into the caller directory itself', async () => {
    // The retrieved project has to be its own directory: dropping it into the
    // scratch root would mix two retrievals together.
    await materializeRetrievedProject(await makeArchive(), { scratchRoot, folderName: 'proj' })
    expect(readdirSync(scratchRoot)).toEqual(['proj'])
  })

  it('hands back the metadata and bundled libraries for the caller to act on', async () => {
    const archiveText = JSON.stringify({ manifest: { name: 'Motion', version: '1.2.0' } })
    const built = await buildProjectSnapshot({
      files: new Map([['project.json', '{}']]),
      projectName: 'P',
      editorVersion: '4.2.0',
      uploadedBy: 'op',
      libraries: [
        { name: 'Motion', version: '1.2.0', hash: await hashText(archiveText), archive: archiveText },
      ],
    })

    const result = await materializeRetrievedProject(built.archive, { scratchRoot, folderName: 'p' })
    expect(result.metadata.editorVersion).toBe('4.2.0')
    expect(result.libraries.map((library) => library.name)).toEqual(['Motion'])
  })

  it('keeps bundled libraries out of the written project tree', async () => {
    // They are the caller's to install, not files the project owns.
    const archiveText = JSON.stringify({ manifest: { name: 'Motion', version: '1' } })
    const built = await buildProjectSnapshot({
      files: new Map([['project.json', '{}']]),
      projectName: 'P',
      editorVersion: '4.2.0',
      uploadedBy: 'op',
      libraries: [{ name: 'Motion', version: '1', hash: await hashText(archiveText), archive: archiveText }],
    })

    const result = await materializeRetrievedProject(built.archive, { scratchRoot, folderName: 'p' })
    expect(existsSync(join(result.projectPath, '.openplc-snapshot'))).toBe(false)
  })
})

// --- refusing what should not be written --------------------------------

describe('untrusted archives', () => {
  it('writes nothing at all when the archive is rejected', async () => {
    // A partially written project is worse than none: it looks openable.
    const notAZip = new TextEncoder().encode('definitely not a zip')
    await expect(
      materializeRetrievedProject(notAZip, { scratchRoot, folderName: 'proj' }),
    ).rejects.toThrow(SnapshotArchiveError)
    expect(existsSync(join(scratchRoot, 'proj'))).toBe(false)
  })

  it('refuses an archive with an absolute path before creating the directory', async () => {
    const zip = new JSZip()
    zip.file(
      SNAPSHOT_MANIFEST_PATH,
      JSON.stringify({ formatVersion: SNAPSHOT_FORMAT_VERSION, projectName: 'P', libraries: [] }),
    )
    zip.file('project.json', '{}')
    zip.file('/etc/passwd', 'pwned')

    await expect(
      materializeRetrievedProject(await zip.generateAsync({ type: 'uint8array' }), {
        scratchRoot,
        folderName: 'proj',
      }),
    ).rejects.toThrow(SnapshotArchiveError)
    expect(existsSync(join(scratchRoot, 'proj'))).toBe(false)
  })
})

// --- the project name as a path segment ---------------------------------

describe('safeFolderName', () => {
  it('keeps an ordinary name readable', () => {
    expect(safeFolderName('Traffic Light')).toBe('Traffic Light')
  })

  it('flattens separators instead of creating directories', () => {
    expect(safeFolderName('a/b')).toBe('a-b')
    expect(safeFolderName('a\\b')).toBe('a-b')
  })

  it('refuses to produce a relative directory reference', () => {
    // "..", or a name starting with one, would resolve somewhere other than
    // inside the scratch root.
    expect(safeFolderName('..')).toBe('retrieved-project')
    expect(safeFolderName('../../etc')).toBe('-..-etc')
    // The property that actually matters, stated directly rather than left to
    // be inferred from the expected strings above: whatever comes out, it
    // cannot resolve anywhere but inside the destination.
    for (const hostile of ['..', '../..', './../x', '....//..']) {
      const folder = safeFolderName(hostile)
      expect(folder.startsWith('.')).toBe(false)
      expect(folder.includes('/')).toBe(false)
      expect(folder.includes('\\')).toBe(false)
    }
  })

  it('drops control characters and the characters Windows reserves', () => {
    expect(safeFolderName('bad\u0000name')).toBe('badname')
    expect(safeFolderName('a:b*c?d"e<f>g|h')).toBe('abcdefgh')
  })

  it('falls back rather than producing an unnamed directory', () => {
    expect(safeFolderName('')).toBe('retrieved-project')
    expect(safeFolderName('   ')).toBe('retrieved-project')
    expect(safeFolderName('...')).toBe('retrieved-project')
  })

  it('bounds the length so a hostile name cannot blow the path limit', () => {
    expect(safeFolderName('x'.repeat(500)).length).toBe(80)
  })
})
