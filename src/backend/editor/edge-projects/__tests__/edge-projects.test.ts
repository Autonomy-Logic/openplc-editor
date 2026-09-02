/**
 * The cloud round trip, with HTTP stubbed.
 *
 * Three things here are worth protecting, and each has bitten a real codebase:
 *
 *  - a remote list is narrowed field by field, not cast. A row missing an id would
 *    otherwise become a card the user can click and nothing happens.
 *  - a partial save is read-modify-write, and the read is MANDATORY: the backend deletes
 *    by omission, so sending only the changed file wipes the rest of the project.
 *  - "not signed in", "denied" and "unreachable" are three different answers, and the
 *    user needs a different thing from each.
 */

import { edgeAuthedRequest } from '../../edge-account/edge-account-service'
import { listRecentCloudProjects, readCloudProject, saveCloudFile, saveCloudProject } from '..'

jest.mock('../../edge-account/edge-account-service', () => ({
  edgeAuthedRequest: jest.fn(),
}))

const request = edgeAuthedRequest as jest.MockedFunction<typeof edgeAuthedRequest>

function ok(data: unknown) {
  return { status: 200, body: JSON.stringify({ data }) }
}

/** The envelope shape the API returns under `files`. */
const FILES = {
  'project.json': '{"meta":{"name":"Irrigation","type":"plc-project"}}',
  pous: { programs: { 'main.st': 'x := TRUE;' } },
  devices: { 'configuration.json': '{}', 'pin-mapping.json': '[]' },
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('listRecentCloudProjects', () => {
  it('asks the server for the newest first, and for no more than the limit', async () => {
    request.mockResolvedValueOnce(ok({ projects: [] }))

    await listRecentCloudProjects(5)

    const [path] = request.mock.calls[0]
    const query = new URL(path, 'https://example.test').searchParams

    // Ordering is the server's: the five newest of ten fetched rows are not the five
    // newest overall, so sorting a truncated page here would be wrong.
    expect(query.get('limit')).toBe('5')
    expect(query.get('sortBy')).toBe('updatedAt')
    expect(query.get('sortOrder')).toBe('desc')
  })

  it('maps the rows it can use', async () => {
    request.mockResolvedValueOnce(
      ok({
        projects: [
          { id: 'p1', name: 'Irrigation', language: 'st', updatedAt: '2026-08-24T19:40:51.962Z' },
          { id: 'p2', name: 'No language', language: null, updatedAt: '2026-08-23T10:00:00.000Z' },
        ],
      }),
    )

    await expect(listRecentCloudProjects(5)).resolves.toEqual({
      status: 'ok',
      projects: [
        { id: 'p1', name: 'Irrigation', language: 'st', updatedAt: '2026-08-24T19:40:51.962Z' },
        { id: 'p2', name: 'No language', language: null, updatedAt: '2026-08-23T10:00:00.000Z' },
      ],
    })
  })

  it('drops rows it cannot open instead of listing them', async () => {
    request.mockResolvedValueOnce(
      ok({
        projects: [
          { name: 'No id at all', updatedAt: '2026-08-24T00:00:00.000Z' },
          { id: 'p2', updatedAt: '2026-08-24T00:00:00.000Z' },
          { id: 'p3', name: 'Fine', updatedAt: '2026-08-24T00:00:00.000Z' },
          null,
        ],
      }),
    )

    // A card with no id is a card that does nothing when clicked.
    await expect(listRecentCloudProjects(5)).resolves.toEqual({
      status: 'ok',
      projects: [{ id: 'p3', name: 'Fine', language: null, updatedAt: '2026-08-24T00:00:00.000Z' }],
    })
  })

  /**
   * The three kinds of nothing, kept apart. Collapsing them into an empty list is what
   * makes a start screen tell an offline user to sign in — sending them to fix a problem
   * they do not have.
   */
  it('reports no session when there is no token to use', async () => {
    request.mockResolvedValueOnce(null)

    await expect(listRecentCloudProjects(5)).resolves.toEqual({ status: 'signed-out' })
  })

  it.each([401, 403])('reports no session when the server answers %i', async (status) => {
    request.mockResolvedValueOnce({ status, body: '{}' })

    await expect(listRecentCloudProjects(5)).resolves.toEqual({ status: 'signed-out' })
  })

  it('reports unreachable on a transport failure, NOT signed out', async () => {
    request.mockRejectedValueOnce(new Error('ENOTFOUND'))

    await expect(listRecentCloudProjects(5)).resolves.toEqual({ status: 'unreachable' })
  })

  it('reports unreachable on a 5xx, which says nothing about the session', async () => {
    request.mockResolvedValueOnce({ status: 503, body: '' })

    await expect(listRecentCloudProjects(5)).resolves.toEqual({ status: 'unreachable' })
  })

  it.each([
    ['a payload with no projects array', ok({})],
    ['an unparseable body', { status: 200, body: 'not json' }],
  ])('reports an empty account for %s', async (_label, response) => {
    // The server answered and the session is fine; there is simply nothing to list.
    request.mockResolvedValueOnce(response as never)

    await expect(listRecentCloudProjects(5)).resolves.toEqual({ status: 'ok', projects: [] })
  })
})

describe('readCloudProject', () => {
  it('translates the envelope into the shape the filesystem reader returns', async () => {
    request.mockResolvedValueOnce(ok({ files: FILES, capabilities: { canEdit: true } }))

    const result = await readCloudProject('p1')

    expect(result.success).toBe(true)
    expect(result.data?.projectPath).toBe('p1')
    expect(result.data?.canEdit).toBe(true)
    expect(result.data?.pouFiles).toEqual([{ relativePath: 'pous/programs/main.st', content: 'x := TRUE;' }])
  })

  it('sends the build id, so the endpoint does not answer with a hard-refresh stub', async () => {
    request.mockResolvedValueOnce(ok({ files: FILES }))

    await readCloudProject('p1')

    expect(request.mock.calls[0][0]).toMatch(/\/projects\/p1\/details\?uncached_version=.+/)
  })

  it('carries a read-only project through as read-only', async () => {
    request.mockResolvedValueOnce(ok({ files: FILES, capabilities: { canEdit: false } }))

    // Offering a save that the server will refuse is worse than not offering one.
    await expect(readCloudProject('p1')).resolves.toMatchObject({ data: { canEdit: false } })
  })

  it('says so plainly when there is no session', async () => {
    request.mockResolvedValueOnce(null)

    const result = await readCloudProject('p1')

    expect(result.success).toBe(false)
    expect(result.error?.title).toBe('Not signed in')
  })

  it('carries the status so a denial is not reported as a broken project', async () => {
    request.mockResolvedValueOnce({ status: 403, body: '{}' })

    await expect(readCloudProject('p1')).resolves.toMatchObject({
      success: false,
      error: { status: 403 },
    })
  })

  it('distinguishes unreachable from denied', async () => {
    request.mockRejectedValueOnce(new Error('ENOTFOUND'))

    const result = await readCloudProject('p1')

    // "You are offline" and "this project is broken" call for completely different things
    // from the user.
    expect(result.error?.title).toBe('Could not reach Autonomy Edge')
  })

  it('fails when the payload carries no files', async () => {
    request.mockResolvedValueOnce(ok({ capabilities: { canEdit: true } }))

    await expect(readCloudProject('p1')).resolves.toMatchObject({ success: false })
  })
})

describe('saveCloudFile', () => {
  it('reads the whole envelope, patches one slot and sends it all back', async () => {
    request
      // the mandatory read
      .mockResolvedValueOnce(ok({ files: structuredClone(FILES) }))
      // the write
      .mockResolvedValueOnce({ status: 200, body: '{}' })

    await expect(saveCloudFile('p1/pous/programs/main.st', 'x := FALSE;')).resolves.toEqual({ success: true })

    const [path, init] = request.mock.calls[1]
    expect(path).toBe('/projects/p1/files/save')

    const sent = (init as { json: { files: typeof FILES } }).json.files

    // The patched slot changed...
    expect(sent.pous.programs['main.st']).toBe('x := FALSE;')
    // ...and everything else is still there. The backend deletes by omission, so a
    // partial body would wipe the rest of the project.
    expect(sent['project.json']).toBe(FILES['project.json'])
    expect(sent.devices['pin-mapping.json']).toBe('[]')
  })

  it('serialises a non-string payload', async () => {
    request.mockResolvedValueOnce(ok({ files: structuredClone(FILES) })).mockResolvedValueOnce({
      status: 200,
      body: '{}',
    })

    await saveCloudFile('p1/devices/configuration.json', { baudRate: 9600 })

    const sent = (request.mock.calls[1][1] as { json: { files: { devices: Record<string, string> } } }).json.files

    expect(JSON.parse(sent.devices['configuration.json'])).toEqual({ baudRate: 9600 })
  })

  it('refuses a path with no project id rather than guessing one', async () => {
    await expect(saveCloudFile('main.st', 'x := TRUE;')).resolves.toMatchObject({ success: false })
    expect(request).not.toHaveBeenCalled()
  })

  it('does not write when the mandatory read failed', async () => {
    request.mockResolvedValueOnce({ status: 500, body: '{}' })

    const result = await saveCloudFile('p1/pous/programs/main.st', 'x := FALSE;')

    expect(result.success).toBe(false)
    // One call: the read. Writing after a failed read would send an envelope built from
    // nothing and delete the project.
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('saveCloudProject', () => {
  const files = {
    projectPath: 'p1',
    projectJson: '{"meta":{"name":"Irrigation"}}',
    deviceConfig: '{}',
    pinMapping: '[]',
    libraryManifest: '',
    pouFiles: [{ relativePath: 'pous/programs/main.st', content: 'x := TRUE;' }],
    serverFiles: [],
    remoteDeviceFiles: [],
    dataTypeFiles: [],
    deletions: [],
  }

  it('posts the whole envelope for the project', async () => {
    request.mockResolvedValueOnce({ status: 200, body: '{}' })

    await expect(saveCloudProject(files)).resolves.toEqual({ success: true })
    expect(request.mock.calls[0][0]).toBe('/projects/p1/files/save')
  })

  it('omits deletions when there are none, and sends them when there are', async () => {
    request.mockResolvedValueOnce({ status: 200, body: '{}' })
    await saveCloudProject(files)
    expect((request.mock.calls[0][1] as { json: Record<string, unknown> }).json).not.toHaveProperty('deletions')

    request.mockResolvedValueOnce({ status: 200, body: '{}' })
    await saveCloudProject({ ...files, deletions: ['pous/programs/old.st', ''] })

    // The empty entry is dropped: an empty path would ask the backend to delete the
    // project root.
    expect((request.mock.calls[1][1] as { json: { deletions: string[] } }).json.deletions).toEqual([
      'pous/programs/old.st',
    ])
  })

  it('reports a refusal rather than claiming success', async () => {
    request.mockResolvedValueOnce({ status: 403, body: '{}' })

    await expect(saveCloudProject(files)).resolves.toMatchObject({ success: false })
  })

  it('reports no session', async () => {
    request.mockResolvedValueOnce(null)

    await expect(saveCloudProject(files)).resolves.toEqual({
      success: false,
      error: 'Not signed in to Autonomy Edge.',
    })
  })

  it('reports a transport failure instead of throwing', async () => {
    request.mockRejectedValueOnce(new Error('ECONNRESET'))

    await expect(saveCloudProject(files)).resolves.toMatchObject({ success: false, error: 'ECONNRESET' })
  })
})

/**
 * The bytes as loaded.
 *
 * The save flow echoes these back for files the user did not touch. Without them every save
 * re-serialises the whole project in the editor's own formatting — same meaning, different
 * bytes — which grew a real project from 62KB to 147KB and reported every file as modified
 * against HEAD. The web build has had this since it shipped; these tests are the desktop
 * catching up, so they check the same keys the web adapter produces.
 */
describe('readCloudProject carries the raw bytes', () => {
  it('keys the project and device files exactly as the save flow asks for them', async () => {
    request.mockResolvedValueOnce(ok({ files: FILES }))

    const result = await readCloudProject('p1')

    expect(result.data?.rawLoadedFiles).toMatchObject({
      'project.json': FILES['project.json'],
      'devices/configuration.json': '{}',
      'devices/pin-mapping.json': '[]',
    })
  })

  it('includes every POU under its own relative path', async () => {
    request.mockResolvedValueOnce(ok({ files: FILES }))

    const result = await readCloudProject('p1')

    // The same path the parsed `pouFiles` entry carries, because that is the key
    // `pickContentForSave` looks up.
    expect(result.data?.rawLoadedFiles?.['pous/programs/main.st']).toBe('x := TRUE;')
  })

  it('hands back the bytes verbatim, not a re-serialisation', async () => {
    // Deliberately ugly formatting: the point of the map is that it survives untouched.
    const ugly = '{\n\t"meta" :   {"name":"Irrigation"}   }'
    request.mockResolvedValueOnce(ok({ files: { ...FILES, 'project.json': ugly } }))

    const result = await readCloudProject('p1')

    expect(result.data?.rawLoadedFiles?.['project.json']).toBe(ugly)
  })

  it('leaves out what the save flow never asks about', async () => {
    request.mockResolvedValueOnce(ok({ files: { ...FILES, 'README.md': '# hi' } }))

    const result = await readCloudProject('p1')

    // A key nobody reads is a key that can only drift. README is not produced by the save
    // flow, so echoing it would not save it either — that gap is its own problem.
    expect(result.data?.rawLoadedFiles).not.toHaveProperty('README.md')
  })
})
