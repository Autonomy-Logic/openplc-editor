import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { MqttSourceToken } from '../../contract/contract'
import { mqttDebugPath, parseMqttProgramMap, resolveMqttSource } from '../program-map'

const FIXTURE_DEBUG_MAP = readFileSync(
  join(__dirname, '..', '..', 'contract', 'fixtures', 'runtime-config', 'debug-map.json'),
  'utf-8',
)
const MD5 = '3f2c9d0e8b7a6f5e4d3c2b1a09f8e7d6'
const instances = [{ name: 'Inst0', program: 'Main' }]

const mapOf = (leaves: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 2, md5: MD5, typeTags: {}, arrays: [], leaves, ...extra })

const leaf = (arrayIdx: number, elemIdx: number, path: string, type = 'INT', size = 2) => ({
  arrayIdx,
  elemIdx,
  path,
  type,
  size,
})

const tokens = (...rest: MqttSourceToken[]): MqttSourceToken[] => [
  { role: 'instance', name: 'Inst0' },
  { role: 'program', name: 'Main' },
  ...rest,
]
const variable = (name: string): MqttSourceToken => ({ role: 'variable', name })
const field = (name: string): MqttSourceToken => ({ role: 'field', name })
const index = (...indices: number[]): MqttSourceToken => ({ role: 'index', indices })

describe('parseMqttProgramMap', () => {
  it('indexes the C0 fixture debug map', () => {
    const map = parseMqttProgramMap(FIXTURE_DEBUG_MAP)
    expect(map?.md5).toBe(MD5)
    expect(map?.leaves.size).toBe(1030)
    expect(map?.leaves.get('INST0.TEMPS[-2]')).toEqual({
      arr: 0,
      elem: 24,
      path: 'INST0.TEMPS[-2]',
      type: 'INT',
      size: 2,
    })
    expect([...(map?.containers ?? [])].sort()).toEqual([
      'INST0',
      'INST0.BIG',
      'INST0.MOTOR1',
      'INST0.MOTOR2',
      'INST0.TEMPS',
      'INST0.TIMER1',
    ])
  })

  it('keeps the exact path text the compiler wrote', () => {
    const map = parseMqttProgramMap(mapOf([leaf(0, 0, 'Inst0.Mixed')]))
    expect(map?.leaves.get('INST0.MIXED')?.path).toBe('Inst0.Mixed')
  })

  it.each<[string, string]>([
    ['not JSON', '{'],
    ['not an object', '[]'],
    ['other version', mapOf([], { version: 1 })],
    ['md5 missing', JSON.stringify({ version: 2, leaves: [] })],
    ['md5 upper-case', mapOf([], { md5: MD5.toUpperCase() })],
    ['leaves missing', JSON.stringify({ version: 2, md5: MD5 })],
    ['leaf not object', mapOf([1])],
    ['arr out of range', mapOf([leaf(256, 0, 'A')])],
    ['elem out of range', mapOf([leaf(0, 65536, 'A')])],
    ['elem not integer', mapOf([leaf(0, 1.5, 'A')])],
    ['size zero', mapOf([leaf(0, 0, 'A', 'INT', 0)])],
    ['empty path', mapOf([leaf(0, 0, '')])],
    ['type missing', mapOf([{ arrayIdx: 0, elemIdx: 0, path: 'A', size: 2 }])],
    ['duplicate path', mapOf([leaf(0, 0, 'A'), leaf(0, 1, 'a')])],
    ['duplicate address', mapOf([leaf(0, 0, 'A'), leaf(0, 0, 'B')])],
  ])('rejects %s', (_label, content) => {
    expect(parseMqttProgramMap(content)).toBeNull()
  })
})

describe('mqttDebugPath', () => {
  it.each<[string, MqttSourceToken[], string]>([
    ['program variable', tokens(variable('Motor1'), field('Speed')), 'INST0.MOTOR1.SPEED'],
    ['negative index', tokens(variable('Temps'), index(-2)), 'INST0.TEMPS[-2]'],
    ['multi-dimensional index', tokens(variable('Grid'), index(-1, 2)), 'INST0.GRID[-1][2]'],
    ['array of arrays', tokens(variable('Nest'), index(0), index(5)), 'INST0.NEST[0][5]'],
    ['field after index', tokens(variable('Pts'), index(1), field('Tags'), index(2)), 'INST0.PTS[1].TAGS[2]'],
    ['global', [{ role: 'instance', name: 'config0' }, variable('GArr'), index(1)], 'GARR[1]'],
    ['global list member', [{ role: 'instance', name: 'Config0' }, variable('Plant'), field('Speed')], 'PLANT.SPEED'],
  ])('%s', (_label, source, expected) => {
    expect(mqttDebugPath(source, instances)).toEqual({ path: expected })
  })

  it.each<[string, MqttSourceToken[], string]>([
    [
      'instance missing',
      [{ role: 'instance', name: 'Ghost' }, { role: 'program', name: 'Main' }, variable('A')],
      'instance_missing',
    ],
    [
      'program swapped',
      [{ role: 'instance', name: 'Inst0' }, { role: 'program', name: 'Other' }, variable('A')],
      'program_mismatch',
    ],
    ['dot in a name', tokens(variable('Motor1.Speed')), 'identifier_invalid'],
    ['bracket in a field', tokens(variable('Temps'), field('X[0]')), 'identifier_invalid'],
    [
      'bad program name',
      [{ role: 'instance', name: 'Inst0' }, { role: 'program', name: 'M.N' }, variable('A')],
      'identifier_invalid',
    ],
    [
      'bad instance name',
      [{ role: 'instance', name: '' }, { role: 'program', name: 'Main' }, variable('A')],
      'identifier_invalid',
    ],
    ['global outside the configuration', [{ role: 'instance', name: 'Inst0' }, variable('A')], 'token_shape'],
    ['too short', [{ role: 'instance', name: 'Inst0' }], 'token_shape'],
    ['first not instance', [variable('A'), field('B')], 'token_shape'],
    ['second is a field', [{ role: 'instance', name: 'Inst0' }, field('A')], 'token_shape'],
    ['no variable after the program', tokens(), 'token_shape'],
    ['field before variable', tokens(field('A')), 'token_shape'],
    ['variable twice', tokens(variable('A'), variable('B')), 'token_shape'],
    ['empty index', tokens(variable('A'), index()), 'token_shape'],
    ['unsafe index', tokens(variable('A'), index(2 ** 60)), 'token_shape'],
  ])('refuses %s', (_label, source, reason) => {
    expect(mqttDebugPath(source, instances)).toEqual({ reason })
  })
})

describe('resolveMqttSource', () => {
  const map = parseMqttProgramMap(FIXTURE_DEBUG_MAP)
  if (map === null) throw new Error('fixture map')

  it('returns the compiled leaf with its exact address, type and size', () => {
    expect(resolveMqttSource(tokens(variable('Timer1'), field('ET')), instances, map)).toEqual({
      ok: true,
      leaf: { arr: 0, elem: 27, path: 'INST0.TIMER1.ET', type: 'TIME', size: 8 },
    })
    expect(resolveMqttSource(tokens(variable('big'), index(1000)), instances, map)).toMatchObject({
      ok: true,
      leaf: { arr: 1, elem: 1000 },
    })
  })

  it('tells a container from a missing leaf and never retries another scope', () => {
    expect(resolveMqttSource(tokens(variable('Motor1')), instances, map)).toEqual({
      ok: false,
      reason: 'not_a_leaf',
      debugPath: 'INST0.MOTOR1',
    })
    expect(resolveMqttSource(tokens(variable('Temps'), index(1)), instances, map)).toEqual({
      ok: false,
      reason: 'leaf_missing',
      debugPath: 'INST0.TEMPS[1]',
    })
    expect(resolveMqttSource([{ role: 'instance', name: 'Config0' }, variable('V_BOOL')], instances, map)).toEqual({
      ok: false,
      reason: 'leaf_missing',
      debugPath: 'V_BOOL',
    })
    expect(resolveMqttSource(tokens(variable('A.B')), instances, map)).toEqual({
      ok: false,
      reason: 'identifier_invalid',
      debugPath: null,
    })
  })
})
