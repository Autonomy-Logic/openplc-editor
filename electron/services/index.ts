import 'reflect-metadata'

import { container } from 'tsyringe'

import { ProjectService } from './project-service'

// Resolve the ProjectService instance with dependencies injected.
export const projectService = container.resolve(ProjectService)

/**
 * Re-exports the createProjectService from the corresponding module.
 * @module Services
 */
export { default as createProjectService } from './createProjectService'
/**
 * Re-exports the getProjectService from the corresponding module.
 * @module Services
 */
export { default as getProjectService } from './getProjectService'
/**
 * Re-exports the saveProjectService from the corresponding module.
 * @module Services
 */
export { default as saveProjectService } from './saveProjectService'
