// Polyfill structuredClone for test environments that do not provide it (e.g. jsdom)
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
}

import type { PLCInstance, PLCProjectData, PLCTask } from '../../../../middleware/shared/ports/open-plc-types'
import { migrateProjectToNameTypeSystem, needsMigration } from '../migrate-project-to-name-type-system'

// ---------------------------------------------------------------------------
// Helpers — minimal project data factory
// ---------------------------------------------------------------------------

function makeProjectData(overrides: Partial<PLCProjectData> = {}): PLCProjectData {
  return {
    dataTypes: [],
    pous: [],
    configuration: {
      resource: {
        tasks: [],
        instances: [],
        globalVariables: [],
      },
    },
    ...overrides,
  }
}

function makeVariable(name: string, extras: Record<string, unknown> = {}) {
  return {
    name,
    class: 'local' as const,
    type: { definition: 'base-type' as const, value: 'int' as const },
    location: '',
    documentation: '',
    ...extras,
  }
}

function makePou(name: string, variables: ReturnType<typeof makeVariable>[]) {
  return {
    type: 'program' as const,
    data: {
      language: 'st' as const,
      name,
      variables,
      body: { language: 'st' as const, value: '' },
      documentation: '',
    },
  }
}

// ---------------------------------------------------------------------------
// needsMigration
// ---------------------------------------------------------------------------

describe('needsMigration', () => {
  it('returns false for a project with no id fields', () => {
    const data = makeProjectData({
      pous: [makePou('Prog1', [makeVariable('x')])],
    })
    expect(needsMigration(data)).toBe(false)
  })

  it('returns true when a local POU variable has an id field', () => {
    const data = makeProjectData({
      pous: [makePou('Prog1', [makeVariable('x', { id: 'abc123' })])],
    })
    expect(needsMigration(data)).toBe(true)
  })

  it('returns true when a global variable has an id field', () => {
    const data = makeProjectData({
      configuration: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [makeVariable('gVar', { id: 'gid1' })],
        },
      },
    })
    expect(needsMigration(data)).toBe(true)
  })

  it('returns true when a structure data type variable has an id field', () => {
    const structVar = {
      name: 'field1',
      type: { definition: 'base-type' as const, value: 'int' as const },
    }
    ;(structVar as Record<string, unknown>).id = 'sid1'
    const data = makeProjectData({
      dataTypes: [
        {
          name: 'MyStruct',
          derivation: 'structure' as const,
          variable: [structVar],
        },
      ],
    })
    expect(needsMigration(data)).toBe(true)
  })

  it('returns false when structure data type variables have no id', () => {
    const data = makeProjectData({
      dataTypes: [
        {
          name: 'MyStruct',
          derivation: 'structure' as const,
          variable: [
            {
              name: 'field1',
              type: { definition: 'base-type' as const, value: 'int' as const },
            },
          ],
        },
      ],
    })
    expect(needsMigration(data)).toBe(false)
  })

  it('returns false for enumerated data types (no variable ids to check)', () => {
    const data = makeProjectData({
      dataTypes: [
        {
          name: 'MyEnum',
          derivation: 'enumerated' as const,
          values: [{ description: 'A' }],
        },
      ],
    })
    expect(needsMigration(data)).toBe(false)
  })

  it('returns false when variable id is explicitly undefined', () => {
    const data = makeProjectData({
      pous: [makePou('Prog1', [makeVariable('x', { id: undefined })])],
    })
    expect(needsMigration(data)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// migrateProjectToNameTypeSystem
// ---------------------------------------------------------------------------

describe('migrateProjectToNameTypeSystem', () => {
  it('returns a successful report with no changes on an empty project', () => {
    const data = makeProjectData()
    const { migratedProject, report } = migrateProjectToNameTypeSystem(data)

    expect(report.success).toBe(true)
    expect(report.variablesMigrated).toBe(0)
    expect(report.unresolvedReferences).toHaveLength(0)
    expect(report.errors).toHaveLength(0)
    expect(migratedProject).not.toBe(data) // structuredClone creates a new object
  })

  it('removes id fields from POU variables and counts them', () => {
    const data = makeProjectData({
      pous: [makePou('P1', [makeVariable('x', { id: 'id1' }), makeVariable('y', { id: 'id2' })])],
    })

    const { migratedProject, report } = migrateProjectToNameTypeSystem(data)

    expect(report.success).toBe(true)
    expect(report.variablesMigrated).toBe(2)

    const migratedVars = migratedProject.pous[0].data.variables
    expect('id' in migratedVars[0]).toBe(false)
    expect('id' in migratedVars[1]).toBe(false)
  })

  it('removes id fields from global variables', () => {
    const gVar = makeVariable('gv', { id: 'gid', class: 'global' })
    const data = makeProjectData({
      configuration: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [gVar],
        },
      },
    })

    const { migratedProject, report } = migrateProjectToNameTypeSystem(data)

    expect(report.variablesMigrated).toBe(1)
    expect('id' in migratedProject.configuration.resource.globalVariables[0]).toBe(false)
  })

  it('removes id fields from structure data type variables', () => {
    const structVar = {
      name: 'f1',
      type: { definition: 'base-type' as const, value: 'int' as const },
    }
    // Simulate a legacy variable that has an extra `id` field at runtime
    ;(structVar as Record<string, unknown>).id = 'sid1'

    const data = makeProjectData({
      dataTypes: [
        {
          name: 'MyStruct',
          derivation: 'structure' as const,
          variable: [structVar],
        },
      ],
    })

    const { migratedProject, report } = migrateProjectToNameTypeSystem(data)

    expect(report.variablesMigrated).toBe(1)
    const structType = migratedProject.dataTypes[0]
    expect(structType.derivation).toBe('structure')
    if (structType.derivation === 'structure') {
      expect('id' in structType.variable[0]).toBe(false)
    }
  })

  it('skips non-structure data types when removing ids', () => {
    const data = makeProjectData({
      dataTypes: [
        {
          name: 'MyEnum',
          derivation: 'enumerated' as const,
          values: [{ description: 'A' }],
        },
      ],
    })

    const { report } = migrateProjectToNameTypeSystem(data)
    expect(report.variablesMigrated).toBe(0)
  })

  it('removes id fields from tasks', () => {
    const data = makeProjectData({
      configuration: {
        resource: {
          tasks: [
            { name: 'T1', triggering: 'Cyclic', interval: 't#20ms', priority: 1, id: 'tid1' } as unknown as PLCTask,
          ],
          instances: [],
          globalVariables: [],
        },
      },
    })

    const { migratedProject } = migrateProjectToNameTypeSystem(data)
    expect('id' in migratedProject.configuration.resource.tasks[0]).toBe(false)
  })

  it('removes id fields from instances', () => {
    const data = makeProjectData({
      configuration: {
        resource: {
          tasks: [],
          instances: [{ name: 'I1', task: 'T1', program: 'P1', id: 'iid1' } as unknown as PLCInstance],
          globalVariables: [],
        },
      },
    })

    const { migratedProject } = migrateProjectToNameTypeSystem(data)
    expect('id' in migratedProject.configuration.resource.instances[0]).toBe(false)
  })

  it('detects duplicate local variable names (case-insensitive) and marks report as failed', () => {
    const data = makeProjectData({
      pous: [makePou('P1', [makeVariable('MyVar'), makeVariable('myvar')])],
    })

    const { report } = migrateProjectToNameTypeSystem(data)

    expect(report.success).toBe(false)
    expect(report.unresolvedReferences).toHaveLength(1)
    expect(report.unresolvedReferences[0].pouName).toBe('P1')
    expect(report.unresolvedReferences[0].variableName).toBe('myvar')
    expect(report.unresolvedReferences[0].reason).toContain('Duplicate variable name')
  })

  it('detects duplicate global variable names (case-insensitive)', () => {
    const data = makeProjectData({
      configuration: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [makeVariable('GlobVar'), makeVariable('globvar')],
        },
      },
    })

    const { report } = migrateProjectToNameTypeSystem(data)

    expect(report.success).toBe(false)
    expect(report.unresolvedReferences).toHaveLength(1)
    expect(report.unresolvedReferences[0].pouName).toBe('Global')
    expect(report.unresolvedReferences[0].reason).toContain('Duplicate global variable name')
  })

  it('returns original project data on caught error and adds to errors array', () => {
    // Create a data object that will cause an error during the migration process.
    // We create an object that structuredClone succeeds on, but then accessing
    // .pous throws by using a getter on the cloned object via a Proxy-like approach.
    // The simplest way: pass null/undefined where an array is expected, causing
    // the .map() call to throw.
    const badData = {
      pous: null,
      dataTypes: [],
      configuration: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [],
        },
      },
    } as unknown as PLCProjectData

    const { migratedProject, report } = migrateProjectToNameTypeSystem(badData)

    expect(report.success).toBe(false)
    expect(report.errors.length).toBeGreaterThanOrEqual(1)
    expect(migratedProject).toBe(badData)
  })
})
