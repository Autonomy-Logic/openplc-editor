import type { PLCProjectData, PLCPou, PLCVariable } from '../../../../middleware/shared/ports/types'
import type { ProjectSearchOptions } from '../project-search'
import { searchProject } from '../project-search'

/** The reported failure: "3 matches", one row listed, and no graphical body ever scanned. */
const variable = (name: string, type = 'BOOL'): PLCVariable => ({
  name,
  type: { definition: 'base-type', value: type },
  location: '',
  documentation: '',
})

const stPou = (name: string, body: string, variables: PLCVariable[] = []): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables },
  body: { language: 'st', value: body },
})

const ladderPou = (name: string, variableNames: string[]): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables: [] },
  body: {
    language: 'ld',
    value: {
      name,
      rungs: [
        {
          id: 'rung-1',
          nodes: variableNames.map((variableName, index) => ({
            id: `contact-${index}`,
            type: 'contact',
            position: { x: 0, y: 0 },
            data: { variable: { name: variableName }, variant: 'default', numericId: '5487658' },
          })),
          edges: [],
        },
      ],
    },
  },
})

const projectWith = (overrides: Partial<PLCProjectData>): PLCProjectData => ({
  dataTypes: [],
  pous: [],
  configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
  ...overrides,
})

const options: ProjectSearchOptions = { caseSensitive: false, regularExpression: false, elementFilters: [] }

const matchesOf = (data: PLCProjectData, query: string, overrides: Partial<typeof options> = {}) => {
  const result = searchProject(data, query, { ...options, ...overrides })
  if (!result.ok) throw new Error(`expected a result, got ${result.reason}`)
  return result.matches
}

describe('searchProject', () => {
  it('lists every occurrence in a structured text body, with its line', () => {
    const data = projectWith({
      pous: [stPou('main', 'IF Motor THEN\n  Lamp := TRUE;\nEND_IF;\nMotor := FALSE;', [variable('Motor')])],
    })

    const matches = matchesOf(data, 'Motor')
    const bodyMatches = matches.filter((match) => match.field === 'body')

    expect(bodyMatches.map((match) => match.line)).toEqual([1, 4])
    expect(bodyMatches[0].preview).toBe('IF Motor THEN')
    expect(matches.filter((match) => match.field === 'variable')).toHaveLength(1)
  })

  it('finds a variable used on a ladder contact and keeps the node that holds it', () => {
    const data = projectWith({ pous: [ladderPou('main', ['Start', 'Start'])] })

    const matches = matchesOf(data, 'Start')

    expect(matches).toHaveLength(2)
    expect(matches.map((match) => match.nodeId)).toEqual(['contact-0', 'contact-1'])
    expect(matches.every((match) => match.rungId === 'rung-1')).toBe(true)
  })

  it('finds a variable in a python body', () => {
    const data = projectWith({
      pous: [
        {
          name: 'script',
          pouType: 'program',
          interface: { variables: [] },
          body: { language: 'python', value: 'value = Counter + 1' },
        },
      ],
    })

    expect(matchesOf(data, 'Counter')).toHaveLength(1)
  })

  it('matches inside a longer identifier, as the count always did', () => {
    const data = projectWith({
      pous: [stPou('main', 'MOTOR := xMOTOR_ON AND MOTOR_START;')],
    })

    expect(matchesOf(data, 'MOTOR')).toHaveLength(3)
  })

  it('treats the query literally unless a regular expression was asked for', () => {
    const data = projectWith({
      pous: [stPou('main', 'x AT %IX0.0 := TRUE;\nAT %IX010 := FALSE;')],
    })

    expect(matchesOf(data, '%IX0.0')).toHaveLength(1)
  })

  it('does not throw on a query that is not a valid expression', () => {
    const data = projectWith({ pous: [stPou('main', 'a := (b);')] })

    expect(matchesOf(data, '(')).toHaveLength(1)
    expect(searchProject(data, '(', { ...options, regularExpression: true })).toEqual({
      ok: false,
      reason: 'invalid-regular-expression',
    })
  })

  it('honours case sensitivity', () => {
    const data = projectWith({ pous: [stPou('main', 'Motor := motor;')] })

    expect(matchesOf(data, 'motor', { caseSensitive: true })).toHaveLength(1)
    expect(matchesOf(data, 'motor')).toHaveLength(2)
  })

  it('searches global variable lists, resource instances, servers and remote devices', () => {
    const data = projectWith({
      globalVariableLists: [{ name: 'GVL', variables: [variable('SharedFlag')] }],
      configurations: {
        resource: {
          tasks: [{ name: 'MainTask', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
          instances: [{ name: 'MainInstance', task: 'MainTask', program: 'main' }],
          globalVariables: [variable('GlobalCounter', 'INT')],
        },
      },
      servers: [{ name: 'PlantServer', protocol: 'modbus-tcp' }],
      remoteDevices: [{ name: 'PumpDevice', protocol: 'modbus-tcp' }],
    })

    expect(matchesOf(data, 'SharedFlag')).toHaveLength(1)
    expect(matchesOf(data, 'MainInstance')).toHaveLength(1)
    expect(matchesOf(data, 'GlobalCounter')).toHaveLength(1)
    expect(matchesOf(data, 'PlantServer')).toHaveLength(1)
    expect(matchesOf(data, 'PumpDevice')).toHaveLength(1)
  })

  it('reports nothing for a name no element carries', () => {
    const data = projectWith({ pous: [stPou('main', 'Motor := TRUE;', [variable('Motor')])] })

    expect(matchesOf(data, 'Conveyor')).toHaveLength(0)
  })

  it('keeps the element filters of the search modal', () => {
    const data = projectWith({
      pous: [stPou('main', 'Motor := TRUE;')],
      dataTypes: [{ name: 'MotorState', derivation: 'enumerated', values: [{ description: 'RUNNING' }] }],
    })

    const onlyDataTypes = matchesOf(data, 'Motor', { elementFilters: ['data-type'] })

    expect(onlyDataTypes).toHaveLength(1)
    expect(onlyDataTypes[0].container.kind).toBe('data-type')
  })

  it('reports nothing for a pattern that matches the empty string', () => {
    const data = projectWith({ pous: [stPou('main', 'Motor := TRUE;')] })

    expect(matchesOf(data, 'x*', { regularExpression: true })).toHaveLength(0)
    expect(matchesOf(data, 'Motor*', { regularExpression: true })).toHaveLength(1)
  })

  it('does not match the structural keys of a graphical body', () => {
    const data = projectWith({ pous: [ladderPou('main', ['Start'])] })

    expect(matchesOf(data, 'contact')).toHaveLength(0)
  })

  it('does not match the shape name or the numeric id of a graphical node', () => {
    const data = projectWith({ pous: [ladderPou('main', ['Start'])] })

    expect(matchesOf(data, 'default')).toHaveLength(0)
    expect(matchesOf(data, '5487658')).toHaveLength(0)
  })

  it('still finds the name of a block placed on a graphical body', () => {
    const pou = ladderPou('main', ['Start'])
    const body = pou.body.value as { rungs: Array<{ nodes: unknown[] }> }
    body.rungs[0].nodes.push({
      id: 'block-0',
      type: 'block',
      position: { x: 0, y: 0 },
      data: { numericId: '1027123', variant: { name: 'TON', variables: [] } },
    })

    expect(matchesOf(projectWith({ pous: [pou] }), 'TON')).toHaveLength(1)
  })
})
