/**
 * Making a retrieved project the open one, on the desktop.
 *
 * The property worth pinning is the one that was missing: a retrieve that
 * reports success must leave a project OPEN. `openProjectByPath` only parses,
 * so a composition that forwards its `success` without loading the result
 * reports a project nobody opened — and because the picker closes the previous
 * project before this runs, the app is left on the start screen with a success
 * toast over it.
 */

import type { ProjectPort } from '../../../shared/ports/project-port'
import type { FetchedProject } from '../../../shared/ports/runtime-port'
import { openPLCStoreBase } from '../../../../frontend/store'
import { openFetchedProject } from '../open-fetched-project'

const fetched: FetchedProject = { projectName: 'Irrigation Controller', payload: '/tmp/retrieved/irrigation' }

/** The shape `parseProjectFiles` hands back, trimmed to what the store reads. */
const parsedProject = {
  meta: { name: 'Irrigation Controller', path: '/tmp/retrieved/irrigation', type: 'plc-project' },
  projectData: { pous: [], dataTypes: [], globalVariableLists: [] },
}

/** A project port that answers `openProjectByPath` and nothing else. */
const portReturning = (response: unknown): ProjectPort =>
  ({ openProjectByPath: jest.fn().mockResolvedValue(response) }) as unknown as ProjectPort

describe('openFetchedProject', () => {
  it('leaves the retrieved project open, not merely parsed', async () => {
    const port = portReturning({ success: true, data: parsedProject })

    const result = await openFetchedProject(fetched, port)

    expect(result).toEqual({ success: true })
    // The point of the whole module: the store now holds what was retrieved.
    // Reporting success without this is what dropped the user on the start
    // screen after a retrieve that had actually worked.
    expect(openPLCStoreBase.getState().project.meta.name).toBe('Irrigation Controller')
  })

  it('unpacks the payload as the path to open', async () => {
    const port = portReturning({ success: true, data: parsedProject })

    await openFetchedProject(fetched, port)

    expect(port.openProjectByPath).toHaveBeenCalledWith('/tmp/retrieved/irrigation')
  })

  it('reports the port error rather than a bare failure', async () => {
    const port = portReturning({ success: false, error: { description: 'The project directory is unreadable' } })

    const result = await openFetchedProject(fetched, port)

    expect(result).toEqual({ success: false, error: 'The project directory is unreadable' })
  })

  it('refuses a success that carries no project', async () => {
    // A response claiming success with nothing to open would otherwise be
    // reported as an open project that is not there.
    const port = portReturning({ success: true })

    const result = await openFetchedProject(fetched, port)

    expect(result.success).toBe(false)
    expect(result.error).toBe('The retrieved project could not be opened.')
  })
})
