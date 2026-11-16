import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { freshRoot, type ProjectOnDisk, writeDevice, writeProfile } from './library-project'

export interface EnumeratedTypeFixture {
  name: string
  values: string[]
}

export interface StProgramFixture {
  name: string
  program: string
  enums: EnumeratedTypeFixture[]
}

/** Writes a Runtime v4 project whose `main` program is the given ST text, and a profile that lists it. */
export function writeStProgramProject(rootName: string, fixture: StProgramFixture): ProjectOnDisk {
  const root = freshRoot(rootName)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: fixture.name, type: 'plc-project' },
      data: {
        dataTypes: fixture.enums.map((type) => ({
          name: type.name,
          derivation: 'enumerated',
          initialValue: '',
          values: type.values.map((description) => ({ description })),
        })),
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
            globalVariables: [],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(join(project, 'pous', 'programs', 'main.st'), fixture.program)
  writeDevice(project)
  writeProfile(userData, fixture.name, project)
  return { project, userData }
}
