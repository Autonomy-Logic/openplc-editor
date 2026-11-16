import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page } from '@playwright/test'

import { SOURCE_USER_DATA } from './arduino-build-project'

export const LIBRARY_VERSION = '1.0.0'

export interface GlobalVariableFixture {
  name: string
  type: string
  initialValue?: string
  flag?: 'constant' | 'retain'
}

export interface GlobalVariableListFixture {
  name: string
  variables: GlobalVariableFixture[]
}

export interface LibraryFixture {
  name: string
  globals: GlobalVariableFixture[]
  lists: GlobalVariableListFixture[]
  functionBlocks: Record<string, string>
}

export interface ConsumerFixture {
  name: string
  program: string
  library: { name: string; archive: string }
}

export interface ProjectOnDisk {
  project: string
  userData: string
}

export interface ManifestEntry {
  name: string
  constant?: boolean
}

export interface LibraryArchive {
  manifest: {
    functions: ManifestEntry[]
    functionBlocks: ManifestEntry[]
    globals: ManifestEntry[]
  }
  sources: Array<{ fileName: string; source: string }>
}

function variable(fixture: GlobalVariableFixture, variableClass?: 'global'): Record<string, unknown> {
  return {
    name: fixture.name,
    ...(variableClass === undefined ? {} : { class: variableClass }),
    type: { definition: 'base-type', value: fixture.type },
    location: '',
    documentation: '',
    initialValue: fixture.initialValue ?? null,
    ...(fixture.flag === undefined ? {} : { flag: fixture.flag }),
  }
}

export function freshRoot(name: string): string {
  const root = join(realpathSync(tmpdir()), name)
  rmSync(root, { recursive: true, force: true })
  return root
}

export function writeProfile(userData: string, projectName: string, project: string): void {
  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: projectName,
        path: project,
        projectFilePath: join(project, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  if (existsSync(join(SOURCE_USER_DATA, 'arduino', 'data'))) {
    symlinkSync(join(SOURCE_USER_DATA, 'arduino'), join(userData, 'arduino'))
  }
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
}

export function writeDevice(project: string): void {
  mkdirSync(join(project, 'devices'), { recursive: true })
  writeFileSync(
    join(project, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
}

export function writeLibraryProject(rootName: string, fixture: LibraryFixture): ProjectOnDisk {
  const root = freshRoot(rootName)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  mkdirSync(join(project, 'pous', 'function-blocks'), { recursive: true })
  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: fixture.name, type: 'plc-library' },
      data: {
        dataTypes: [],
        pous: [],
        globalVariableLists: fixture.lists.map((list) => ({
          name: list.name,
          variables: list.variables.map((member) => variable(member, 'global')),
        })),
        configuration: {
          resource: {
            tasks: [],
            instances: [],
            globalVariables: fixture.globals.map((global) => variable(global)),
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(project, 'library.json'),
    JSON.stringify({
      name: fixture.name,
      displayName: fixture.name,
      version: LIBRARY_VERSION,
      namespace: fixture.name,
      description: '',
    }),
  )
  for (const [name, source] of Object.entries(fixture.functionBlocks)) {
    writeFileSync(join(project, 'pous', 'function-blocks', `${name}.st`), source)
  }
  writeDevice(project)
  writeProfile(userData, fixture.name, project)
  return { project, userData }
}

export function writeConsumerProject(rootName: string, fixture: ConsumerFixture): ProjectOnDisk {
  const root = freshRoot(rootName)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: fixture.name, type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
            globalVariables: [],
          },
        },
        libraries: [{ name: fixture.library.name, version: LIBRARY_VERSION }],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(join(project, 'pous', 'programs', 'main.st'), fixture.program)
  writeDevice(project)
  writeProfile(userData, fixture.name, project)

  const libraries = join(userData, 'libraries')
  const libraryDir = join(libraries, fixture.library.name)
  mkdirSync(libraryDir, { recursive: true })
  const stlibPath = join(libraryDir, `${fixture.library.name}.stlib`)
  writeFileSync(stlibPath, fixture.library.archive)
  writeFileSync(
    join(libraries, 'registry.json'),
    JSON.stringify({
      formatVersion: '1.0',
      libraries: {
        [fixture.library.name]: {
          version: LIBRARY_VERSION,
          installedAt: new Date().toISOString(),
          stlibPath,
          origin: 'stlib',
        },
      },
    }),
  )
  return { project, userData }
}

export function builtLibraryPath(project: string, name: string): string {
  return join(project, 'build', `${name}.stlib`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function entriesOf(value: unknown): ManifestEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((entry) => ({
    name: String(entry.name),
    ...(entry.constant === true ? { constant: true } : {}),
  }))
}

export function readLibraryArchive(path: string): LibraryArchive {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
  if (!isRecord(parsed) || !isRecord(parsed.manifest)) throw new Error(`${path} has no manifest`)
  const sources = Array.isArray(parsed.sources) ? parsed.sources.filter(isRecord) : []
  return {
    manifest: {
      functions: entriesOf(parsed.manifest.functions),
      functionBlocks: entriesOf(parsed.manifest.functionBlocks),
      globals: entriesOf(parsed.manifest.globals),
    },
    sources: sources.map((source) => ({ fileName: String(source.fileName), source: String(source.source) })),
  }
}

export function consoleOf(page: Page): Locator {
  return page.getByRole('tabpanel', { name: 'Console' })
}

export async function buildLibrary(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Build Library', exact: true }).click({ timeout: 30000 })
  await expect(consoleOf(page).getByText('Starting library build...').first()).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('button', { name: 'Build Library', exact: true })).toBeEnabled({ timeout: 120000 })
}
