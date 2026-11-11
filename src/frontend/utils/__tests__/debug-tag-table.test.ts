import type { DebugTreeNode, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import {
  assignTagToView,
  buildTagRows,
  createMonitorView,
  filterTagRows,
  type MonitorView,
  nextMonitorViewName,
  pruneMonitorViews,
  removeMonitorView,
  renameMonitorView,
  rowsOfView,
} from '../debug-tag-table'

function makeVariable(name: string, overrides: Partial<PLCVariable> = {}): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'base-type', value: 'BOOL' },
    location: '',
    documentation: '',
    ...overrides,
  }
}

function makePou(name: string, variables: PLCVariable[]): PLCPou {
  return {
    name,
    pouType: 'program',
    language: 'st',
    body: { language: 'st', value: '' },
    interface: { returnType: { definition: 'base-type', value: 'BOOL' }, variables },
  } as unknown as PLCPou
}

function makeLeaf(compositeKey: string, name: string, type: string, debugIndex?: number): DebugTreeNode {
  return {
    name,
    fullPath: compositeKey.replace(':', '.'),
    compositeKey,
    type,
    isComplex: false,
    ...(debugIndex !== undefined ? { debugIndex } : {}),
  }
}

function makeComplex(compositeKey: string, name: string, type: string, children: DebugTreeNode[]): DebugTreeNode {
  return {
    name,
    fullPath: compositeKey.replace(':', '.'),
    compositeKey,
    type,
    isComplex: true,
    children,
  }
}

describe('buildTagRows', () => {
  const motor = makeVariable('motor', { location: '%QX0.0', documentation: 'Main motor' })
  const setpoint = makeVariable('setpoint', {
    type: { definition: 'base-type', value: 'INT' },
    location: '%IW10',
    documentation: 'Tank setpoint',
  })
  const pous = [makePou('main', [motor]), makePou('aux', [setpoint])]

  it('lists every variable of the project with its address, type and comment', () => {
    const rows = buildTagRows({
      trees: [makeLeaf('aux:setpoint', 'setpoint', 'INT', 7), makeLeaf('main:motor', 'motor', 'BOOL', 3)],
      pous,
      globalVariables: [],
      views: [],
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      compositeKey: 'aux:setpoint',
      name: 'setpoint',
      scope: 'aux',
      area: '',
      address: '%IW10',
      type: 'INT',
      comment: 'Tank setpoint',
      depth: 0,
      debugIndex: 7,
    })
    expect(rows[1]).toMatchObject({ compositeKey: 'main:motor', scope: 'main', address: '%QX0.0', debugIndex: 3 })
  })

  it('reads a global variable under the Global scope', () => {
    const start = makeVariable('start', { location: '%IX0.1', documentation: 'Start button' })

    const rows = buildTagRows({
      trees: [makeLeaf('Config0:start', 'start', 'BOOL', 1)],
      pous: [],
      globalVariables: [start],
      views: [],
    })

    expect(rows[0]).toMatchObject({ scope: 'Global', address: '%IX0.1', comment: 'Start button' })
  })

  it('falls back to a GVL declaration when the resource does not declare the global', () => {
    const level = makeVariable('level', { location: '%IW4', documentation: 'Tank level' })

    const rows = buildTagRows({
      trees: [makeLeaf('Config0:level', 'level', 'INT', 2)],
      pous: [],
      globalVariables: [],
      globalVariableLists: [{ name: 'SETPOINT', variables: [level] }],
      views: [],
    })

    expect(rows[0]).toMatchObject({ scope: 'Global', address: '%IW4', comment: 'Tank level' })
  })

  it('keeps a structured node collapsed until its key is expanded', () => {
    const timer = makeComplex('main:t1', 't1', 'TON', [
      makeLeaf('main:t1.Q', 'Q', 'BOOL', 11),
      makeLeaf('main:t1.ET', 'ET', 'TIME', 12),
    ])

    const collapsed = buildTagRows({ trees: [timer], pous: [], globalVariables: [], views: [] })
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]).toMatchObject({ isComplex: true, hasChildren: true, depth: 0 })

    const expanded = buildTagRows({
      trees: [timer],
      pous: [],
      globalVariables: [],
      views: [],
      expandedKeys: new Set(['main:t1']),
    })
    expect(expanded.map((row) => row.compositeKey)).toEqual(['main:t1', 'main:t1.Q', 'main:t1.ET'])
    expect(expanded[1]).toMatchObject({ depth: 1, name: 'Q', address: '', comment: '' })
  })

  it('shows the view a tag was moved to in its Area column', () => {
    const views: MonitorView[] = [{ name: 'Motors', entries: ['main:motor'] }]

    const rows = buildTagRows({
      trees: [makeLeaf('main:motor', 'motor', 'BOOL', 3), makeLeaf('aux:setpoint', 'setpoint', 'INT', 7)],
      pous,
      globalVariables: [],
      views,
    })

    expect(rows.find((row) => row.compositeKey === 'main:motor')?.area).toBe('Motors')
    expect(rows.find((row) => row.compositeKey === 'aux:setpoint')?.area).toBe('')
  })
})

describe('filterTagRows', () => {
  const rows = buildTagRows({
    trees: [makeLeaf('main:motor', 'motor', 'BOOL', 3), makeLeaf('aux:setpoint', 'setpoint', 'INT', 7)],
    pous: [
      makePou('main', [makeVariable('motor', { location: '%QX0.0', documentation: 'Main motor' })]),
      makePou('aux', [
        makeVariable('setpoint', { type: { definition: 'base-type', value: 'INT' }, location: '%IW10' }),
      ]),
    ],
    globalVariables: [],
    views: [],
  })

  it('returns every row when the filter is empty', () => {
    expect(filterTagRows(rows, '   ')).toHaveLength(2)
  })

  it('matches any part of a name, ignoring case', () => {
    expect(filterTagRows(rows, 'MOT').map((row) => row.compositeKey)).toEqual(['main:motor'])
  })

  it('matches the address, the type and the comment too', () => {
    expect(filterTagRows(rows, '%iw10').map((row) => row.compositeKey)).toEqual(['aux:setpoint'])
    expect(filterTagRows(rows, 'bool').map((row) => row.compositeKey)).toEqual(['main:motor'])
    expect(filterTagRows(rows, 'Main motor').map((row) => row.compositeKey)).toEqual(['main:motor'])
  })

  it('does not match across two columns', () => {
    expect(filterTagRows(rows, 'motorbool').map((row) => row.compositeKey)).toEqual([])
  })
})

describe('rowsOfView', () => {
  const rows = buildTagRows({
    trees: [makeLeaf('main:motor', 'motor', 'BOOL', 3), makeLeaf('aux:setpoint', 'setpoint', 'INT', 7)],
    pous: [],
    globalVariables: [],
    views: [{ name: 'Motors', entries: ['main:motor'] }],
  })
  const views: MonitorView[] = [{ name: 'Motors', entries: ['main:motor'] }]

  it('returns the whole table for the empty view name', () => {
    expect(rowsOfView(rows, views, '')).toHaveLength(2)
  })

  it('returns only the tags of the named view', () => {
    expect(rowsOfView(rows, views, 'Motors').map((row) => row.compositeKey)).toEqual(['main:motor'])
  })

  it('returns nothing for a view that no longer exists', () => {
    expect(rowsOfView(rows, views, 'Gone')).toEqual([])
  })

  it('keeps the members of a structured tag the view holds', () => {
    const timer = makeComplex('main:t1', 't1', 'TON', [
      makeLeaf('main:t1.Q', 'Q', 'BOOL', 11),
      makeLeaf('main:t1[0]', '[0]', 'BOOL', 12),
    ])
    const timerViews: MonitorView[] = [{ name: 'Timers', entries: ['main:t1'] }]
    const expanded = buildTagRows({
      trees: [timer, makeLeaf('main:t10', 't10', 'BOOL', 13)],
      pous: [],
      globalVariables: [],
      views: timerViews,
      expandedKeys: new Set(['main:t1']),
    })

    expect(rowsOfView(expanded, timerViews, 'Timers').map((row) => row.compositeKey)).toEqual([
      'main:t1',
      'main:t1.Q',
      'main:t1[0]',
    ])
  })
})

describe('nextMonitorViewName', () => {
  it('numbers the next view from the ones that exist', () => {
    expect(nextMonitorViewName([])).toBe('View 1')
    expect(nextMonitorViewName([{ name: 'Motors', entries: [] }])).toBe('View 2')
  })

  it('skips a name already taken after a view was deleted', () => {
    expect(nextMonitorViewName([{ name: 'View 2', entries: [] }])).toBe('View 3')
    expect(
      nextMonitorViewName([
        { name: 'view 2', entries: [] },
        { name: 'View 3', entries: [] },
      ]),
    ).toBe('View 4')
  })
})

describe('monitor views', () => {
  it('creates a view with a trimmed name', () => {
    const result = createMonitorView([], '  Motors  ')
    expect(result.error).toBeUndefined()
    expect(result.views).toEqual([{ name: 'Motors', entries: [] }])
  })

  it('refuses an empty name and a duplicate, ignoring case', () => {
    expect(createMonitorView([], '   ').error).toBe('The view needs a name.')
    const existing: MonitorView[] = [{ name: 'Motors', entries: [] }]
    expect(createMonitorView(existing, 'motors').error).toBe('A view named "motors" already exists.')
    expect(createMonitorView(existing, 'motors').views).toBe(existing)
  })

  it('renames a view and keeps its entries', () => {
    const views: MonitorView[] = [{ name: 'Motors', entries: ['main:motor'] }]
    const result = renameMonitorView(views, 'Motors', 'Drives')
    expect(result.views).toEqual([{ name: 'Drives', entries: ['main:motor'] }])
  })

  it('refuses to rename onto another view and to rename what does not exist', () => {
    const views: MonitorView[] = [
      { name: 'Motors', entries: [] },
      { name: 'Valves', entries: [] },
    ]
    expect(renameMonitorView(views, 'Motors', 'valves').error).toBe('A view named "valves" already exists.')
    expect(renameMonitorView(views, 'Gone', 'Valves').error).toBe('There is no view named "Gone".')
  })

  it('accepts a rename that only changes the case of the same view', () => {
    const views: MonitorView[] = [{ name: 'Motors', entries: [] }]
    expect(renameMonitorView(views, 'Motors', 'MOTORS').views).toEqual([{ name: 'MOTORS', entries: [] }])
  })

  it('removes a view', () => {
    const views: MonitorView[] = [
      { name: 'Motors', entries: ['main:motor'] },
      { name: 'Valves', entries: [] },
    ]
    expect(removeMonitorView(views, 'Motors')).toEqual([{ name: 'Valves', entries: [] }])
  })

  it('moves a tag between views and out of every view', () => {
    const views: MonitorView[] = [
      { name: 'Motors', entries: ['main:motor'] },
      { name: 'Valves', entries: [] },
    ]

    const moved = assignTagToView(views, 'main:motor', 'Valves')
    expect(moved).toEqual([
      { name: 'Motors', entries: [] },
      { name: 'Valves', entries: ['main:motor'] },
    ])

    expect(assignTagToView(moved, 'main:motor', '')).toEqual([
      { name: 'Motors', entries: [] },
      { name: 'Valves', entries: [] },
    ])
  })

  it('never lists a tag twice in the same view', () => {
    const views: MonitorView[] = [{ name: 'Motors', entries: ['main:motor'] }]
    expect(assignTagToView(views, 'main:motor', 'Motors')).toEqual([{ name: 'Motors', entries: ['main:motor'] }])
  })

  it('drops entries whose variables the project no longer declares', () => {
    const views: MonitorView[] = [{ name: 'Motors', entries: ['main:motor', 'main:gone'] }]
    expect(pruneMonitorViews(views, new Set(['main:motor']))).toEqual([{ name: 'Motors', entries: ['main:motor'] }])
  })
})
