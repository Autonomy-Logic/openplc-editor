/**
 * Publishing a local project to Edge, with HTTP stubbed and a real directory on disk.
 *
 * The archive is built from an actual temporary project rather than from a mocked
 * filesystem, because what matters here is what ends up INSIDE the zip: the importer
 * refuses an archive with no `project.json` at its root, and it reads paths with forward
 * slashes. A mock would happily agree with whatever the code did.
 *
 * The other half is the limits. They are the server's, mirrored locally so a doomed upload
 * fails before someone waits out a zip and a slow connection for a rejection that was
 * certain from the start.
 */

import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import JSZip from 'jszip'

import { edgeAuthedRequest } from '../../edge-account/edge-account-service'
import { buildProjectArchive, listCloudFolders, uploadProjectToCloud } from '..'

jest.mock('../../edge-account/edge-account-service', () => ({
  edgeAuthedRequest: jest.fn(),
}))

const request = edgeAuthedRequest as jest.MockedFunction<typeof edgeAuthedRequest>

let projectDir: string

/** A project on disk, as the editor would have written one. */
async function writeProject(files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(projectDir, relative)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, contents)
  }
}

/** The entry names inside a built archive. */
async function entriesOf(zip: Buffer): Promise<string[]> {
  const loaded = await JSZip.loadAsync(zip)

  return Object.keys(loaded.files)
    .filter((name) => !loaded.files[name].dir)
    .sort()
}

beforeEach(async () => {
  jest.clearAllMocks()
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openplc-upload-'))
})

afterEach(async () => {
  await fs.rm(projectDir, { recursive: true, force: true })
})

describe('building the archive', () => {
  it('packs the project files with the manifest at the root', async () => {
    await writeProject({
      'project.json': '{"meta":{"name":"Irrigation"}}',
      'pous/programs/main.st': 'x := TRUE;',
      'devices/configuration.json': '{}',
    })

    const result = await buildProjectArchive(projectDir)

    expect(result.ok).toBe(true)

    if (result.ok) {
      // Forward slashes, and `project.json` at the top — both are what the importer
      // looks for. `path.join` would emit backslashes on Windows, which the server then
      // reads as characters in a filename rather than as folders.
      expect(await entriesOf(result.zip)).toEqual([
        'devices/configuration.json',
        'pous/programs/main.st',
        'project.json',
      ])
      expect(result.fileCount).toBe(3)
    }
  })

  it('leaves out files the importer would not accept', async () => {
    await writeProject({
      'project.json': '{}',
      'pous/programs/main.st': 'x;',
      '.DS_Store': 'junk',
      'build/output.bin': 'binary',
      'notes.txt': 'personal',
    })

    const result = await buildProjectArchive(projectDir)

    // Dropped rather than fatal: a stray OS file or a build artefact is not a reason to
    // refuse to publish someone's work.
    expect(result.ok && (await entriesOf(result.zip))).toEqual(['pous/programs/main.st', 'project.json'])
  })

  it('refuses a folder that is not an OpenPLC project', async () => {
    await writeProject({ 'pous/programs/main.st': 'x;' })

    // Checked here so the user is told the folder is wrong, rather than being handed the
    // server's accurate but unhelpful "archive must contain a project.json".
    await expect(buildProjectArchive(projectDir)).resolves.toEqual({ ok: false, failure: { reason: 'no-manifest' } })
  })

  it('refuses a folder with nothing in it', async () => {
    await expect(buildProjectArchive(projectDir)).resolves.toEqual({ ok: false, failure: { reason: 'empty' } })
  })

  it('names the file that is too big, not just the fact', async () => {
    await writeProject({ 'project.json': '{}' })
    // 50MB + 1 byte, in an allowed extension so it is not simply skipped. A Uint8Array
    // rather than a Buffer: this project's TS/@types/node pairing rejects a Buffer here,
    // the same mismatch the runtime uploader documents.
    await fs.writeFile(path.join(projectDir, 'huge.st'), new Uint8Array(50 * 1024 * 1024 + 1))

    const result = await buildProjectArchive(projectDir)

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.failure.reason).toBe('file-too-large')
      // The path, because "a file is too large" in a project of hundreds is not actionable.
      expect(result.failure).toMatchObject({ relativePath: 'huge.st' })
    }
  })

  it('refuses a project nested deeper than the importer allows', async () => {
    const deep = Array.from({ length: 12 }, (_, i) => `d${i}`).join('/')
    await writeProject({ 'project.json': '{}', [`${deep}/main.st`]: 'x;' })

    await expect(buildProjectArchive(projectDir)).resolves.toMatchObject({ failure: { reason: 'too-deep' } })
  })

  it('reports a directory it cannot read instead of publishing a partial project', async () => {
    await expect(buildProjectArchive(path.join(projectDir, 'does-not-exist'))).resolves.toMatchObject({
      ok: false,
      failure: { reason: 'unreadable' },
    })
  })
})

describe('uploading', () => {
  beforeEach(async () => {
    await writeProject({ 'project.json': '{"meta":{"name":"Irrigation"}}', 'pous/programs/main.st': 'x;' })
  })

  /** The multipart body of the nth call, as text (the zip bytes are not valid UTF-8). */
  function sentBody(index = 0): string {
    const init = request.mock.calls[index][1]

    return init && 'raw' in init && init.raw ? init.raw.body.toString('latin1') : ''
  }

  it('posts a multipart form with the destination and visibility', async () => {
    request.mockResolvedValueOnce({ status: 201, body: JSON.stringify({ data: { project: { id: 'p9' } } }) })

    const result = await uploadProjectToCloud({
      projectPath: projectDir,
      parentFolderId: 'folder-1',
      visibility: 'private',
    })

    expect(result).toEqual({ status: 'ok', projectId: 'p9', uploadedFiles: 2 })

    const [path_, init] = request.mock.calls[0]
    expect(path_).toBe('/projects/import')
    expect(init).toMatchObject({ method: 'POST' })
    expect(init && 'raw' in init && init.raw?.contentType).toMatch(/^multipart\/form-data; boundary=/)

    const body = sentBody()
    expect(body).toContain('name="parentFolderId"')
    expect(body).toContain('folder-1')
    expect(body).toContain('name="visibility"')
    expect(body).toContain('private')
    expect(body).toContain('name="file"; filename=')
    expect(body).toContain('Content-Type: application/zip')
  })

  it('omits the name when the user did not change it', async () => {
    request.mockResolvedValueOnce({ status: 201, body: '{}' })

    await uploadProjectToCloud({ projectPath: projectDir, parentFolderId: 'f1', visibility: 'private' })

    // Absent means "use the name in project.json", which is what the importer does.
    expect(sentBody()).not.toContain('name="projectName"')
  })

  it('sends a name the user did choose', async () => {
    request.mockResolvedValueOnce({ status: 201, body: '{}' })

    await uploadProjectToCloud({
      projectPath: projectDir,
      parentFolderId: 'f1',
      projectName: 'Renamed Project',
      visibility: 'public',
    })

    const body = sentBody()
    expect(body).toContain('Renamed Project')
    expect(body).toContain('public')
  })

  it('cannot be made to forge a header through the filename', async () => {
    request.mockResolvedValueOnce({ status: 201, body: '{}' })
    const nasty = await fs.mkdtemp(path.join(os.tmpdir(), 'evil"\r\nX-Injected: 1'))

    try {
      await fs.writeFile(path.join(nasty, 'project.json'), '{}')
      await uploadProjectToCloud({ projectPath: nasty, parentFolderId: 'f1', visibility: 'private' })

      const lines = sentBody().split('\r\n')

      // The property that matters is that the break is gone, not that the text is: a
      // forged header would have to start its own line. The characters survive inside the
      // filename, harmlessly, which is why asserting on the substring would be asserting
      // the wrong thing.
      expect(lines.some((line) => line.startsWith('X-Injected'))).toBe(false)
      expect(lines.filter((line) => line.includes('filename='))).toHaveLength(1)
    } finally {
      await fs.rm(nasty, { recursive: true, force: true })
    }
  })

  it('does not upload at all when the archive could not be built', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'openplc-empty-'))

    try {
      await expect(
        uploadProjectToCloud({ projectPath: empty, parentFolderId: 'f1', visibility: 'private' }),
      ).resolves.toMatchObject({ failure: { reason: 'empty' } })
      expect(request).not.toHaveBeenCalled()
    } finally {
      await fs.rm(empty, { recursive: true, force: true })
    }
  })

  it('reports no session', async () => {
    request.mockResolvedValueOnce(null)

    await expect(
      uploadProjectToCloud({ projectPath: projectDir, parentFolderId: 'f1', visibility: 'private' }),
    ).resolves.toEqual({ status: 'failed', failure: { reason: 'signed-out' } })
  })

  it('passes the server refusal through, because it says what is wrong', async () => {
    request.mockResolvedValueOnce({
      status: 409,
      body: JSON.stringify({ message: 'Project with name "Irrigation" already exists for this user' }),
    })

    await expect(
      uploadProjectToCloud({ projectPath: projectDir, parentFolderId: 'f1', visibility: 'private' }),
    ).resolves.toEqual({
      status: 'failed',
      failure: { reason: 'rejected', status: 409, message: 'Project with name "Irrigation" already exists for this user' },
    })
  })

  it('does NOT claim the upload failed when the server never answered', async () => {
    request.mockRejectedValueOnce(new Error('ECONNRESET'))

    // The import is not idempotent: an unanswered POST may have created the project.
    // Calling that a failure invites a duplicate.
    await expect(
      uploadProjectToCloud({ projectPath: projectDir, parentFolderId: 'f1', visibility: 'private' }),
    ).resolves.toMatchObject({ failure: { reason: 'unreachable' } })
  })

  it('still succeeds when the response carries no project id', async () => {
    request.mockResolvedValueOnce({ status: 201, body: 'not json' })

    // The project was created; we just cannot link to it.
    await expect(
      uploadProjectToCloud({ projectPath: projectDir, parentFolderId: 'f1', visibility: 'private' }),
    ).resolves.toEqual({ status: 'ok', projectId: null, uploadedFiles: 2 })
  })
})

describe('listing destinations', () => {
  const tree = [
    {
      id: 'root-1',
      name: 'cmsdgkcy3000407lmry3tj53c',
      type: 'root',
      deletedAt: null,
      children: [
        { id: 'dir-1', name: 'Machines', type: 'directory', deletedAt: null, children: [] },
        { id: 'proj-1', name: 'Irrigation', type: 'project', deletedAt: null, children: [] },
        { id: 'dir-2', name: 'Old', type: 'directory', deletedAt: '2026-08-01T00:00:00.000Z', children: [] },
      ],
    },
  ]

  function respond(folders: unknown) {
    request.mockResolvedValueOnce({ status: 200, body: JSON.stringify({ data: { folders } }) })
  }

  it('asks for the hierarchy, so the list can be indented', async () => {
    respond([])

    await listCloudFolders()

    expect(request.mock.calls[0][0]).toBe('/folders?includeHierarchy=true')
  })

  it('offers folders, not projects, and never the bin', async () => {
    respond(tree)

    // A project folder IS a project; offering it would invite nesting one inside another.
    // A trashed folder would accept the import and then be invisible.
    await expect(listCloudFolders()).resolves.toEqual({
      status: 'ok',
      folders: [
        { id: 'root-1', name: 'Root (/)', depth: 0 },
        { id: 'dir-1', name: 'Machines', depth: 1 },
      ],
    })
  })

  it('never shows the account id as a folder name', async () => {
    respond(tree)

    const result = await listCloudFolders()

    // The root folder is named after the user on the wire — meaningless and slightly
    // alarming in a menu. Same label Edge's own dialog uses.
    expect(result.status === 'ok' && result.folders[0].name).toBe('Root (/)')
  })

  it('keeps walking past a project folder to the directories under it', async () => {
    respond([
      {
        id: 'p1',
        type: 'project',
        deletedAt: null,
        children: [{ id: 'inner', name: 'Shared', type: 'directory', deletedAt: null, children: [] }],
      },
    ])

    await expect(listCloudFolders()).resolves.toEqual({
      status: 'ok',
      folders: [{ id: 'inner', name: 'Shared', depth: 1 }],
    })
  })

  it('reports no session rather than an empty account', async () => {
    request.mockResolvedValueOnce({ status: 401, body: '{}' })

    await expect(listCloudFolders()).resolves.toEqual({ status: 'signed-out' })
  })

  it('reports unreachable on a transport failure', async () => {
    request.mockRejectedValueOnce(new Error('ENOTFOUND'))

    await expect(listCloudFolders()).resolves.toEqual({ status: 'unreachable' })
  })

  it('drops a folder with no id instead of listing something unclickable', async () => {
    respond([{ name: 'No id', type: 'directory', deletedAt: null, children: [] }])

    await expect(listCloudFolders()).resolves.toEqual({ status: 'ok', folders: [] })
  })
})
