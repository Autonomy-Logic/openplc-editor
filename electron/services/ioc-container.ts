import { readFile, writeFile } from 'node:fs'

import { formatDate } from '@shared/utils'
import { dialog } from 'electron'
import { container } from 'tsyringe'

// Wip: Implements dependencies for project services.
export interface IProjectServiceDependencies {
  dialog: typeof dialog
  readFile: typeof readFile
  writeFile: typeof writeFile
  formatDate: (date: Date) => string
}
// Wip: Implements dependencies for project services.
class ProjectServiceProvider implements IProjectServiceDependencies {
  dialog = dialog
  readFile = readFile
  writeFile = writeFile
  formatDate = formatDate
}

container.register('ProjectDependencies', {
  useClass: ProjectServiceProvider,
})
