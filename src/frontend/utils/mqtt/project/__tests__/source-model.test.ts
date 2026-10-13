import type { PLCDataType, PLCPou, PLCVariable } from '../../../../../middleware/shared/ports/types'
import type { MqttSourceToken } from '../../contract/contract'
import {
  buildMqttSourceTree,
  collectMqttLeaves,
  countMqttLeaves,
  describeMqttSource,
  MQTT_GLOBAL_SCOPE_NAME,
  mqttArrayElement,
  mqttArrayElements,
  mqttArrayIndicesAt,
  type MqttModelVariable,
  type MqttSourceModel,
  mqttSourceKey,
  mqttSourceModelFromCompileProject,
  mqttSourceModelFromPortProject,
  type MqttTreeNode,
  parseMqttArrayDimension,
} from '../source-model'

const base = (value: string): MqttModelVariable['type'] => ({ definition: 'base-type', value })
const derived = (value: string): MqttModelVariable['type'] => ({ definition: 'derived', value })
const udt = (value: string): MqttModelVariable['type'] => ({ definition: 'user-data-type', value })
const array = (element: { definition: string; value: string }, ...dimensions: string[]): MqttModelVariable['type'] => ({
  definition: 'array',
  value: 'ARRAY',
  data: { baseType: element, dimensions: dimensions.map((dimension) => ({ dimension })) },
})
const v = (name: string, type: MqttModelVariable['type'], cls = 'local'): MqttModelVariable => ({
  name,
  class: cls,
  type,
})

const model = (overrides: Partial<MqttSourceModel> = {}): MqttSourceModel => ({
  instances: [
    { name: 'instance0', program: 'Main' },
    { name: 'Inst1', program: 'Main' },
  ],
  pous: [
    {
      name: 'Main',
      kind: 'program',
      variables: [
        v('In1', base('INT'), 'input'),
        v('Out1', base('BOOL'), 'output'),
        v('Grid', array({ definition: 'base-type', value: 'INT' }, '-1..0', '2..3')),
        v('Pts', array({ definition: 'user-data-type', value: 'Point' }, '0..1')),
        v('P', udt('Point')),
        v('Fb1', derived('MyFb')),
        v('Fbs', array({ definition: 'user-data-type', value: 'MyFb' }, '1..2')),
        v('C', udt('Color')),
        v('S', base('string')),
        v('W', base('WSTRING')),
        v('Tod1', base('TIME_OF_DAY')),
        v('Dt1', base('DATE_AND_TIME')),
        v('Tmp', base('INT'), 'temp'),
        v('GCount', base('DINT'), 'external'),
        v('X', base('__XWORD')),
        v('Mystery', derived('NOT_DECLARED')),
        v('Loop', udt('Node')),
        v('Rows', udt('Row')),
        v('Bad', array({ definition: 'base-type', value: 'INT' }, '5..1')),
        v('NoBounds', { definition: 'array', value: 'ARRAY' }),
        v('Wide', array(base('INT'), '0..1', '0..1', '0..1', '0..1', '0..1', '0..1', '0..1', '0..1', '0..1')),
        v('Flat', array(base('INT'))),
      ],
    },
    {
      name: 'MyFb',
      kind: 'function-block',
      variables: [
        v('En', base('BOOL'), 'input'),
        v('Cnt', base('DINT'), 'output'),
        v('Inner', derived('TON')),
        v('Scratch', base('INT'), 'temp'),
      ],
    },
    { name: 'Helper', kind: 'function-block', variables: [] },
  ],
  dataTypes: [
    {
      name: 'Point',
      derivation: 'structure',
      variable: [
        { name: 'X', type: base('REAL') },
        { name: 'Tags', type: array({ definition: 'base-type', value: 'INT' }, '1..2') },
      ],
    },
    { name: 'Color', derivation: 'enumerated' },
    { name: 'Node', derivation: 'structure', variable: [{ name: 'Next', type: udt('Node') }] },
    {
      name: 'Row',
      derivation: 'array',
      baseType: { definition: 'base-type', value: 'SINT' },
      dimensions: [{ dimension: '5..6' }],
    },
  ],
  globalVariables: [v('GCount', base('DINT')), v('GArr', array({ definition: 'base-type', value: 'BOOL' }, '1..2'))],
  libraryFunctionBlocks: [
    {
      name: 'TON',
      kind: 'function-block',
      variables: [
        v('IN', base('BOOL'), 'input'),
        v('PT', base('TIME'), 'input'),
        v('Q', base('BOOL'), 'output'),
        v('ET', base('TIME'), 'output'),
        v('STATE', base('INT'), 'local'),
      ],
    },
  ],
  ...overrides,
})

const progTokens = (...rest: MqttSourceToken[]): MqttSourceToken[] => [
  { role: 'instance', name: 'instance0' },
  { role: 'program', name: 'Main' },
  ...rest,
]
const variable = (name: string): MqttSourceToken => ({ role: 'variable', name })
const field = (name: string): MqttSourceToken => ({ role: 'field', name })
const index = (...indices: number[]): MqttSourceToken => ({ role: 'index', indices })

const child = (node: MqttTreeNode, label: string): MqttTreeNode => {
  if (node.kind !== 'scope' && node.kind !== 'composite') throw new Error(`${node.label} has no children`)
  const found = node.children.find((c) => c.label === label)
  if (!found) throw new Error(`${label} not under ${node.label}`)
  return found
}

const asArray = (node: MqttTreeNode): Extract<MqttTreeNode, { kind: 'array' }> => {
  if (node.kind !== 'array') throw new Error(`${node.label} is not an array`)
  return node
}

describe('buildMqttSourceTree', () => {
  const tree = buildMqttSourceTree(model())
  const main = tree[0]

  it('creates one scope per Resources instance plus the configuration globals', () => {
    expect(tree.map((n) => [n.kind, n.label, n.tokens])).toEqual([
      [
        'scope',
        'instance0',
        [
          { role: 'instance', name: 'instance0' },
          { role: 'program', name: 'Main' },
        ],
      ],
      [
        'scope',
        'Inst1',
        [
          { role: 'instance', name: 'Inst1' },
          { role: 'program', name: 'Main' },
        ],
      ],
      ['scope', MQTT_GLOBAL_SCOPE_NAME, [{ role: 'instance', name: MQTT_GLOBAL_SCOPE_NAME }]],
    ])
  })

  it('lists persistent program variables only: temporaries and externals are not program storage', () => {
    if (main.kind !== 'scope') throw new Error('scope expected')
    expect(main.children.map((c) => c.label)).not.toContain('Tmp')
    expect(main.children.map((c) => c.label)).not.toContain('GCount')
    expect(main.children.map((c) => c.label)).toEqual(
      expect.arrayContaining(['In1', 'Out1', 'Grid', 'Pts', 'P', 'Fb1', 'Fbs', 'C', 'S', 'W']),
    )
  })

  it('keeps instance, program, variable and field tokens on leaves of structs and blocks', () => {
    expect(child(child(main, 'P'), 'X')).toMatchObject({
      kind: 'leaf',
      iecType: 'REAL',
      size: 4,
      tokens: progTokens(variable('P'), field('X')),
      id: mqttSourceKey(progTokens(variable('P'), field('X'))),
    })
    expect(child(child(child(main, 'Fb1'), 'Inner'), 'ET')).toMatchObject({
      kind: 'leaf',
      iecType: 'TIME',
      tokens: progTokens(variable('Fb1'), field('Inner'), field('ET')),
    })
  })

  it('normalises base type spelling and aliases to the contract types', () => {
    expect(child(main, 'S')).toMatchObject({ kind: 'leaf', iecType: 'STRING', size: 127 })
    expect(child(main, 'W')).toMatchObject({ kind: 'leaf', iecType: 'WSTRING', size: 253 })
    expect(child(main, 'Tod1')).toMatchObject({ kind: 'leaf', iecType: 'TOD', size: 8 })
    expect(child(main, 'Dt1')).toMatchObject({ kind: 'leaf', iecType: 'DT', size: 8 })
  })

  it('shows unsupported types as non-selectable with the reason', () => {
    expect(child(main, 'C')).toMatchObject({ kind: 'unsupported', reason: 'type_enumeration', typeName: 'Color' })
    expect(child(main, 'X')).toMatchObject({ kind: 'unsupported', reason: 'type_unsupported' })
    expect(child(main, 'Mystery')).toMatchObject({ kind: 'unsupported', reason: 'type_unknown' })
    expect(child(child(main, 'Loop'), 'Next')).toMatchObject({ kind: 'unsupported', reason: 'type_recursive' })
    expect(child(main, 'Bad')).toMatchObject({ kind: 'unsupported', reason: 'array_bounds_invalid' })
    expect(child(main, 'NoBounds')).toMatchObject({ kind: 'unsupported', reason: 'array_bounds_invalid' })
    expect(child(main, 'Flat')).toMatchObject({ kind: 'unsupported', reason: 'array_bounds_invalid' })
    expect(child(main, 'Wide')).toMatchObject({ kind: 'unsupported', reason: 'array_rank_too_high' })
  })

  it('exposes only the public interface of library blocks, every persistent member of user blocks', () => {
    expect(
      (child(child(main, 'Fb1'), 'Inner') as Extract<MqttTreeNode, { kind: 'composite' }>).children.map((c) => c.label),
    ).toEqual(['IN', 'PT', 'Q', 'ET'])
    expect((child(main, 'Fb1') as Extract<MqttTreeNode, { kind: 'composite' }>).children.map((c) => c.label)).toEqual([
      'En',
      'Cnt',
      'Inner',
    ])
  })

  it('marks library blocks as opaque when the loaded libraries are unknown', () => {
    const opaqueTree = buildMqttSourceTree(model({ libraryFunctionBlocks: undefined }))
    expect(child(child(opaqueTree[0], 'Fb1'), 'Inner')).toMatchObject({ kind: 'opaque', typeName: 'TON' })
  })

  it('keeps arrays collapsed with their real bounds, including negative and multi-dimensional ones', () => {
    expect(asArray(child(main, 'Grid'))).toMatchObject({
      dimensions: [
        { lower: -1, upper: 0 },
        { lower: 2, upper: 3 },
      ],
      elementCount: 4,
    })
    expect(asArray(child(main, 'Rows'))).toMatchObject({ typeName: 'Row', dimensions: [{ lower: 5, upper: 6 }] })
  })

  it('omits the global scope when the configuration declares no globals', () => {
    expect(buildMqttSourceTree(model({ globalVariables: [] })).map((n) => n.label)).toEqual(['instance0', 'Inst1'])
  })

  it('leaves a scope empty when its program is not declared', () => {
    const orphan = buildMqttSourceTree(model({ instances: [{ name: 'I9', program: 'Gone' }] }))[0]
    expect(orphan).toMatchObject({ kind: 'scope', program: 'Gone', children: [] })
  })

  it('stops at the maximum source depth instead of producing paths the runtime refuses', () => {
    const deep: MqttSourceModel = model({
      dataTypes: Array.from({ length: 70 }, (_, i) => ({
        name: `S${i}`,
        derivation: 'structure' as const,
        variable: [{ name: 'F', type: i === 60 ? array(base('INT'), '0..1') : udt(`S${i + 1}`) }],
      })),
      pous: [{ name: 'Main', kind: 'program', variables: [v('Root', udt('S0'))] }],
      globalVariables: [],
    })
    let node = child(buildMqttSourceTree(deep)[0], 'Root')
    while (node.kind === 'composite') node = node.children[0]
    expect(node).toMatchObject({ kind: 'unsupported', reason: 'path_too_deep', typeName: 'ARRAY' })
    expect(node.tokens).toHaveLength(64)
  })
})

describe('array elements', () => {
  const m = model()
  const grid = asArray(child(buildMqttSourceTree(m)[0], 'Grid'))

  it('enumerates row-major indices with the original bounds', () => {
    expect([0, 1, 2, 3].map((o) => mqttArrayIndicesAt(grid.dimensions, o))).toEqual([
      [-1, 2],
      [-1, 3],
      [0, 2],
      [0, 3],
    ])
    expect(mqttArrayElements(m, grid, 1, 2).map((n) => n.tokens)).toEqual([
      progTokens(variable('Grid'), index(-1, 3)),
      progTokens(variable('Grid'), index(0, 2)),
    ])
    expect(mqttArrayElements(m, grid, 3, 10)).toHaveLength(1)
  })

  it('materialises one element for explicit indices and refuses out-of-range ones', () => {
    expect(mqttArrayElement(m, grid, [0, 3])).toMatchObject({ kind: 'leaf', iecType: 'INT', label: '[0,3]' })
    expect(mqttArrayElement(m, grid, [1, 3])).toBeNull()
    expect(mqttArrayElement(m, grid, [-2, 3])).toBeNull()
    expect(mqttArrayElement(m, grid, [0])).toBeNull()
    expect(mqttArrayElement(m, grid, [0.5, 3])).toBeNull()
  })

  it('expands arrays of structures and arrays of arrays into nested element nodes', () => {
    const pts = asArray(child(buildMqttSourceTree(m)[0], 'Pts'))
    const first = mqttArrayElement(m, pts, [0])
    if (!first) throw new Error('element expected')
    const tags = asArray(child(first, 'Tags'))
    expect(mqttArrayElement(m, tags, [2])?.tokens).toEqual(
      progTokens(variable('Pts'), index(0), field('Tags'), index(2)),
    )
    const rows = asArray(child(buildMqttSourceTree(m)[0], 'Rows'))
    expect(mqttArrayElement(m, rows, [6])).toMatchObject({ kind: 'leaf', iecType: 'SINT' })
  })
})

describe('leaf counting and collection', () => {
  const m = model()
  const main = buildMqttSourceTree(m)[0]

  it('counts expanded leaves, not complex roots', () => {
    expect(countMqttLeaves(m, child(main, 'P'))).toBe(3)
    expect(countMqttLeaves(m, child(main, 'Pts'))).toBe(6)
    expect(countMqttLeaves(m, child(main, 'Fb1'))).toBe(6)
    expect(countMqttLeaves(m, child(main, 'Fbs'))).toBe(12)
    expect(countMqttLeaves(m, child(main, 'Grid'))).toBe(4)
    expect(countMqttLeaves(m, child(main, 'C'))).toBe(0)
    expect(countMqttLeaves(m, child(main, 'In1'))).toBe(1)
  })

  it('collects leaves in tree order and reports truncation past the limit', () => {
    const big: MqttSourceModel = model({
      pous: [{ name: 'Main', kind: 'program', variables: [v('Big', array(base('DINT'), '0..1000'))] }],
    })
    const bigNode = child(buildMqttSourceTree(big)[0], 'Big')
    expect(countMqttLeaves(big, bigNode)).toBe(1001)
    const capped = collectMqttLeaves(big, bigNode, 1000)
    expect(capped.truncated).toBe(true)
    expect(capped.leaves).toHaveLength(1000)
    expect(capped.leaves[999].tokens).toEqual([
      { role: 'instance', name: 'instance0' },
      { role: 'program', name: 'Main' },
      variable('Big'),
      index(999),
    ])
    const all = collectMqttLeaves(m, child(main, 'Pts'), 1000)
    expect(all.truncated).toBe(false)
    expect(all.leaves.map((l) => l.label)).toEqual(['X', '[1]', '[2]', 'X', '[1]', '[2]'])
    expect(collectMqttLeaves(m, child(main, 'C'), 10)).toEqual({ leaves: [], truncated: false })
    expect(collectMqttLeaves(m, child(main, 'P'), 2).truncated).toBe(true)
  })
})

describe('describeMqttSource', () => {
  const m = model()

  it.each<[string, MqttSourceToken[], ReturnType<typeof describeMqttSource>]>([
    ['scalar', progTokens(variable('In1')), { status: 'leaf', iecType: 'INT', size: 2 }],
    ['case-insensitive', progTokens(variable('in1')), { status: 'leaf', iecType: 'INT', size: 2 }],
    ['struct field', progTokens(variable('P'), field('Tags'), index(1)), { status: 'leaf', iecType: 'INT', size: 2 }],
    [
      'block in array',
      progTokens(variable('Fbs'), index(2), field('Inner'), field('Q')),
      { status: 'leaf', iecType: 'BOOL', size: 1 },
    ],
    ['multi-dim', progTokens(variable('Grid'), index(-1, 3)), { status: 'leaf', iecType: 'INT', size: 2 }],
    ['container', progTokens(variable('P')), { status: 'container' }],
    ['array container', progTokens(variable('Grid')), { status: 'container' }],
    [
      'global',
      [{ role: 'instance', name: 'Config0' }, variable('GArr'), index(2)],
      { status: 'leaf', iecType: 'BOOL', size: 1 },
    ],
    ['enum', progTokens(variable('C')), { status: 'unsupported', reason: 'type_enumeration', typeName: 'Color' }],
    [
      'enum below',
      progTokens(variable('C'), field('X')),
      { status: 'unsupported', reason: 'type_enumeration', typeName: 'Color' },
    ],
    ['renamed', progTokens(variable('Gone')), { status: 'missing', reason: 'member_missing' }],
    ['renamed field', progTokens(variable('P'), field('Y')), { status: 'missing', reason: 'member_missing' }],
    ['out of range', progTokens(variable('Grid'), index(1, 2)), { status: 'missing', reason: 'index_out_of_range' }],
    ['rank', progTokens(variable('Grid'), index(0)), { status: 'missing', reason: 'index_rank_mismatch' }],
    ['not array', progTokens(variable('In1'), index(0)), { status: 'missing', reason: 'not_an_array' }],
    ['not composite', progTokens(variable('In1'), field('X')), { status: 'missing', reason: 'not_a_composite' }],
    [
      'instance',
      [{ role: 'instance', name: 'Ghost' }, { role: 'program', name: 'Main' }, variable('In1')],
      { status: 'missing', reason: 'instance_missing' },
    ],
    [
      'program swap',
      [{ role: 'instance', name: 'instance0' }, { role: 'program', name: 'Other' }, variable('In1')],
      { status: 'missing', reason: 'program_mismatch' },
    ],
    ['identifier', progTokens(variable('P.X')), { status: 'missing', reason: 'identifier_invalid' }],
    [
      'identifier in scope',
      [{ role: 'instance', name: 'a.b' }, { role: 'program', name: 'Main' }, variable('In1')],
      { status: 'missing', reason: 'identifier_invalid' },
    ],
    [
      'identifier in program',
      [{ role: 'instance', name: 'instance0' }, { role: 'program', name: 'M[0]' }, variable('In1')],
      { status: 'missing', reason: 'identifier_invalid' },
    ],
    [
      'identifier in field',
      progTokens(variable('P'), field('X Y')),
      { status: 'missing', reason: 'identifier_invalid' },
    ],
    ['shape: field first', progTokens(field('In1')), { status: 'missing', reason: 'token_shape' }],
    ['shape: variable twice', progTokens(variable('P'), variable('X')), { status: 'missing', reason: 'token_shape' }],
    [
      'shape: program only',
      [
        { role: 'instance', name: 'instance0' },
        { role: 'program', name: 'Main' },
      ],
      { status: 'missing', reason: 'token_shape' },
    ],
    [
      'shape: global not config',
      [{ role: 'instance', name: 'instance0' }, variable('In1')],
      { status: 'missing', reason: 'token_shape' },
    ],
    [
      'shape: first not instance',
      [{ role: 'program', name: 'Main' }, variable('In1')],
      { status: 'missing', reason: 'token_shape' },
    ],
    [
      'shape: second index',
      [{ role: 'instance', name: 'instance0' }, index(0)],
      { status: 'missing', reason: 'token_shape' },
    ],
    ['shape: too short', [{ role: 'instance', name: 'instance0' }], { status: 'missing', reason: 'token_shape' }],
  ])('%s', (_label, tokens, expected) => {
    expect(describeMqttSource(m, tokens)).toEqual(expected)
  })

  it('defers to the compiled program for library blocks it cannot see', () => {
    const opaque = model({ libraryFunctionBlocks: undefined })
    expect(describeMqttSource(opaque, progTokens(variable('Fb1'), field('Inner'), field('Q')))).toEqual({
      status: 'opaque',
      typeName: 'TON',
    })
    expect(describeMqttSource(opaque, progTokens(variable('Fb1'), field('Inner')))).toEqual({
      status: 'opaque',
      typeName: 'TON',
    })
  })

  it('reports a program that is instantiated but not declared', () => {
    const m2 = model({ instances: [{ name: 'I9', program: 'Gone' }] })
    expect(
      describeMqttSource(m2, [{ role: 'instance', name: 'I9' }, { role: 'program', name: 'Gone' }, variable('X')]),
    ).toEqual({ status: 'missing', reason: 'program_missing' })
  })
})

describe('parseMqttArrayDimension', () => {
  it.each([
    ['0..9', { lower: 0, upper: 9 }],
    [' -5 .. 5 ', { lower: -5, upper: 5 }],
    ['3..3', { lower: 3, upper: 3 }],
    ['5..1', null],
    ['1..*', null],
    ['10', null],
    ['a..b', null],
    ['-2147483649..0', null],
    ['0..2147483648', null],
  ])('%p', (input, expected) => {
    expect(parseMqttArrayDimension(input)).toEqual(expected)
  })
})

describe('model adapters', () => {
  const variables: PLCVariable[] = [
    { name: 'A', class: 'local', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' },
  ]

  it('reads the compile-pipeline project shape, global variable lists included', () => {
    const m = mqttSourceModelFromCompileProject({
      pous: [
        { type: 'program', data: { name: 'Main', variables } },
        { type: 'function', data: { name: 'F', variables: [] } },
        { type: 'function-block', data: { name: 'Fb', variables } },
      ],
      dataTypes: [
        { name: 'E', derivation: 'enumerated' },
        {
          name: 'Arr',
          derivation: 'array',
          baseType: { definition: 'base-type', value: 'INT' },
          dimensions: [{ dimension: '0..1' }],
        },
        {
          name: 'S',
          derivation: 'structure',
          variable: [{ name: 'X', type: { definition: 'base-type', value: 'INT' } }],
        },
        { name: 'Odd', derivation: 'subrange' },
      ],
      globalVariableLists: [
        { name: 'Plant', variables: [{ name: 'Speed', type: { definition: 'base-type', value: 'REAL' } }] },
        { name: 'Empty', variables: [] },
      ],
      configuration: {
        resource: {
          instances: [{ name: 'I0', program: 'Main' }],
          globalVariables: [{ name: 'G', type: { definition: 'base-type', value: 'BOOL' } }],
        },
      },
    })
    expect(m.pous.map((p) => [p.name, p.kind])).toEqual([
      ['Main', 'program'],
      ['Fb', 'function-block'],
    ])
    expect(m.dataTypes.map((d) => [d.name, d.derivation])).toEqual([
      ['E', 'enumerated'],
      ['Arr', 'array'],
      ['S', 'structure'],
      ['Plant_TYPE', 'structure'],
    ])
    expect(m.globalVariables.map((g) => g.name)).toEqual(['G', 'Plant'])
    expect(m.libraryFunctionBlocks).toBeUndefined()
    expect(describeMqttSource(m, [{ role: 'instance', name: 'Config0' }, variable('Plant'), field('Speed')])).toEqual({
      status: 'leaf',
      iecType: 'REAL',
      size: 4,
    })
  })

  it('reads the store project shape and the loaded libraries', () => {
    const pous: PLCPou[] = [
      { name: 'Main', pouType: 'program', interface: { variables }, body: { language: 'st', value: '' } },
      { name: 'Fb', pouType: 'function-block', body: { language: 'st', value: '' } },
      { name: 'F', pouType: 'function', interface: { variables: [] }, body: { language: 'st', value: '' } },
    ]
    const dataTypes: PLCDataType[] = [{ name: 'E', derivation: 'enumerated', values: [] }]
    const m = mqttSourceModelFromPortProject(
      {
        pous,
        dataTypes,
        globalVariableLists: [{ name: 'L', variables }],
        configurations: { resource: { instances: [{ name: 'I0', program: 'Main' }], globalVariables: [] } },
      },
      [
        {
          pous: [
            {
              name: 'TON',
              type: 'function-block',
              variables: [{ name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } }],
            },
            { name: 'ADD', type: 'function', variables: [] },
          ],
        },
      ],
    )
    expect(m.pous.map((p) => [p.name, p.kind, p.variables.length])).toEqual([
      ['Main', 'program', 1],
      ['Fb', 'function-block', 0],
    ])
    expect(m.libraryFunctionBlocks?.map((p) => p.name)).toEqual(['TON'])
    expect(m.globalVariables.map((g) => g.name)).toEqual(['L'])
    expect(
      mqttSourceModelFromPortProject({
        pous: [],
        dataTypes: [],
        configurations: { resource: { instances: [], globalVariables: [] } },
      }).libraryFunctionBlocks,
    ).toBeUndefined()
  })
})
