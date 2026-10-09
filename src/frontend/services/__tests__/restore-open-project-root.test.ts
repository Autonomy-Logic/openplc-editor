import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import { restoreOpenProjectRoot } from '../restore-open-project-root'

const openProjectByPath = jest.fn<ReturnType<ProjectPort['openProjectByPath']>, [string]>()
const projectPort = new Proxy<ProjectPort>(Object.create(null), {
  get: (_, prop) => (prop === 'openProjectByPath' ? openProjectByPath : () => undefined),
})

beforeEach(() => openProjectByPath.mockReset())

it('re-reads the project still open', () => {
  openProjectByPath.mockResolvedValue({ success: true })

  restoreOpenProjectRoot(projectPort, '/projects/current')

  expect(openProjectByPath).toHaveBeenCalledWith('/projects/current')
})

it('reads nothing when no project is open', () => {
  restoreOpenProjectRoot(projectPort, '')

  expect(openProjectByPath).not.toHaveBeenCalled()
})

it('swallows a failed re-read', async () => {
  let calls = 0
  const failingPort = new Proxy<ProjectPort>(Object.create(null), {
    get: (_, prop) =>
      prop === 'openProjectByPath'
        ? () => {
            calls += 1
            return Promise.reject(new Error('gone'))
          }
        : () => undefined,
  })

  restoreOpenProjectRoot(failingPort, '/projects/current')
  await Promise.resolve()

  expect(calls).toBe(1)
})
