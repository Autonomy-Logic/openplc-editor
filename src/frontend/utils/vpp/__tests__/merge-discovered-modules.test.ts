import { describe, expect, it } from '@jest/globals'

import {
  type DiscoveryModuleDef,
  hwIdsEqual,
  mergeDiscoveredModules,
  type MergeDiscoveredModulesArgs,
  parseDiscoveredModules,
  type SlotConfigMap,
} from '../merge-discovered-modules'

const MAPPING = { path: 'modules', slotField: 'slot', moduleIdField: 'hwId' }
const STACKABLE = { maxSlots: 15, dense: true }
const PHYSICAL = { maxSlots: 8, dense: false }

const MODULES: DiscoveryModuleDef[] = [
  { id: 'ai8v', name: 'SLM-AI-8-V', hwId: '0x34A055EB' },
  { id: 'combo', name: 'SLM-ACDCI-8NP-RLY8', hwId: '0x24A500E1' },
  { id: 'thm4', name: 'SLM-THM-4', hwId: '0x34608CE1' },
  { id: 'rly16', name: 'SLM-RLY-16', hwId: '0x140400F1' },
  { id: 'manual', name: 'Manual only' },
]

function args(overrides: Partial<MergeDiscoveredModulesArgs>): MergeDiscoveredModulesArgs {
  return {
    slots: [null, null, null, null],
    slotsConfig: {},
    modules: MODULES,
    detected: [],
    maxSlots: 4,
    lockedSlotIndex: null,
    ...overrides,
  }
}

describe('parseDiscoveredModules', () => {
  it('reads the device contract', () => {
    const result = parseDiscoveredModules(
      {
        modules: [
          { slot: 1, hwId: '0x34A055EB' },
          { slot: 2, hwId: '0x24A500E1' },
        ],
        count: 2,
      },
      MAPPING,
      STACKABLE,
    )
    expect(result).toEqual({
      ok: true,
      modules: [
        { slot: 1, hwId: '0x34A055EB' },
        { slot: 2, hwId: '0x24A500E1' },
      ],
    })
  })

  it('accepts an empty backplane', () => {
    expect(parseDiscoveredModules({ modules: [], count: 0 }, MAPPING, STACKABLE)).toEqual({ ok: true, modules: [] })
  })

  it('orders the modules by slot', () => {
    const result = parseDiscoveredModules(
      {
        modules: [
          { slot: 2, hwId: 'B' },
          { slot: 1, hwId: 'A' },
        ],
      },
      MAPPING,
      STACKABLE,
    )
    expect(result).toEqual({
      ok: true,
      modules: [
        { slot: 1, hwId: 'A' },
        { slot: 2, hwId: 'B' },
      ],
    })
  })

  it('follows a dotted path and custom field names', () => {
    const result = parseDiscoveredModules(
      { result: { found: [{ position: 1, id: '0x1' }] } },
      { path: 'result.found', slotField: 'position', moduleIdField: 'id' },
      STACKABLE,
    )
    expect(result).toEqual({ ok: true, modules: [{ slot: 1, hwId: '0x1' }] })
  })

  it.each([
    ['no list at the path', { count: 0 }],
    ['a list that is not an array', { modules: { slot: 1 } }],
    ['a non-object entry', { modules: ['0x1'] }],
    ['a slot that is not a number', { modules: [{ slot: '1', hwId: '0x1' }] }],
    ['a slot below 1', { modules: [{ slot: 0, hwId: '0x1' }] }],
    ['a fractional slot', { modules: [{ slot: 1.5, hwId: '0x1' }] }],
    ['a slot beyond the last one', { modules: [{ slot: 9, hwId: '0x1' }] }],
    ['an empty hwId', { modules: [{ slot: 1, hwId: '  ' }] }],
    ['a missing hwId', { modules: [{ slot: 1 }] }],
    ['a fractional numeric hwId', { modules: [{ slot: 1, hwId: 1.5 }] }],
    ['a negative numeric hwId', { modules: [{ slot: 1, hwId: -1 }] }],
    ['a boolean hwId', { modules: [{ slot: 1, hwId: true }] }],
    [
      'a repeated slot',
      {
        modules: [
          { slot: 1, hwId: '0x1' },
          { slot: 1, hwId: '0x2' },
        ],
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    'refuses %s on any section',
    (_label: string, data: Record<string, unknown>) => {
      expect(parseDiscoveredModules(data, MAPPING, PHYSICAL)).toMatchObject({ ok: false })
      expect(parseDiscoveredModules(data, MAPPING, STACKABLE)).toMatchObject({ ok: false })
    },
  )

  it('accepts gaps and a first slot above 1 on a section that is not stackable', () => {
    const result = parseDiscoveredModules(
      {
        modules: [
          { slot: 2, hwId: '0x1' },
          { slot: 5, hwId: '0x2' },
        ],
      },
      MAPPING,
      PHYSICAL,
    )
    expect(result).toEqual({
      ok: true,
      modules: [
        { slot: 2, hwId: '0x1' },
        { slot: 5, hwId: '0x2' },
      ],
    })
  })

  it.each([
    [
      'a gap in the slots',
      [
        { slot: 1, hwId: '0x1' },
        { slot: 3, hwId: '0x2' },
      ],
    ],
    ['slots not starting at 1', [{ slot: 2, hwId: '0x1' }]],
  ] as Array<[string, unknown[]]>)('refuses %s on a stackable section', (_label: string, modules: unknown[]) => {
    const result = parseDiscoveredModules({ modules }, MAPPING, STACKABLE)
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.error).toContain('no gaps')
  })

  it('reads an integer hardware id as its decimal digits', () => {
    expect(parseDiscoveredModules({ modules: [{ slot: 1, hwId: 882922987 }] }, MAPPING, STACKABLE)).toEqual({
      ok: true,
      modules: [{ slot: 1, hwId: '882922987' }],
    })
  })

  it('keeps every digit of an integer id beyond the exact double range', () => {
    const result = parseDiscoveredModules({ modules: [{ slot: 1, hwId: 1e21 }] }, MAPPING, STACKABLE)
    expect(result).toEqual({ ok: true, modules: [{ slot: 1, hwId: '1000000000000000000000' }] })
  })
})

describe('hwIdsEqual', () => {
  it('compares hex ids numerically and without regard to case', () => {
    expect(hwIdsEqual('0x34a055eb', '0x34A055EB')).toBe(true)
    expect(hwIdsEqual('0x000000FF', '0xff')).toBe(true)
    expect(hwIdsEqual('0x34A055EB', '0x34A055EA')).toBe(false)
  })

  it('matches a decimal id against its hex form', () => {
    expect(hwIdsEqual('882922987', '0x34A055EB')).toBe(true)
  })

  it('does not collapse ids larger than a double can hold exactly', () => {
    expect(hwIdsEqual('0x20000000000001', '0x20000000000000')).toBe(false)
    expect(hwIdsEqual('0xFFFFFFFFFFFFFFFF', '18446744073709551615')).toBe(true)
    expect(hwIdsEqual('18446744073709551615', '18446744073709551614')).toBe(false)
  })

  it('falls back to case-insensitive text for ids that are not numbers', () => {
    expect(hwIdsEqual('ABC-1', 'abc-1')).toBe(true)
    expect(hwIdsEqual('ABC-1', 'ABC-2')).toBe(false)
  })
})

describe('mergeDiscoveredModules', () => {
  it('keeps a matching slot with its settings object untouched', () => {
    const thermocouple = { tc_type: 'K', burnout: 'upscale', units: 'C', ch1_enabled: true, scale_max: 27648 }
    const before = JSON.stringify(thermocouple)
    const slotsConfig: SlotConfigMap = { '1': thermocouple }

    const result = mergeDiscoveredModules(
      args({ slots: ['thm4', null, null, null], slotsConfig, detected: [{ slot: 1, hwId: '0x34608ce1' }] }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slots).toEqual(['thm4', null, null, null])
    expect(result.slotsConfig['1']).toBe(thermocouple)
    expect(JSON.stringify(result.slotsConfig['1'])).toBe(before)
    expect(result.changed).toBe(false)
    expect(result.changes).toEqual([
      {
        slot: 1,
        kind: 'keep',
        from: { id: 'thm4', name: 'SLM-THM-4' },
        to: { id: 'thm4', name: 'SLM-THM-4' },
      },
    ])
  })

  it('replaces a different module at default settings', () => {
    const result = mergeDiscoveredModules(
      args({
        slots: ['thm4', null, null, null],
        slotsConfig: { '1': { tc_type: 'J' } },
        detected: [{ slot: 1, hwId: '0x34A055EB' }],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slots[0]).toBe('ai8v')
    expect(result.slotsConfig['1']).toBeUndefined()
    expect(result.changes).toEqual([
      {
        slot: 1,
        kind: 'replace',
        from: { id: 'thm4', name: 'SLM-THM-4' },
        to: { id: 'ai8v', name: 'SLM-AI-8-V' },
      },
    ])
    expect(result.changed).toBe(true)
  })

  it('adds detected modules missing from the project at default settings', () => {
    const result = mergeDiscoveredModules(
      args({
        slots: ['ai8v', null, null, null],
        slotsConfig: { '1': { range: '0-10V' }, '2': { stale: 1 } },
        detected: [
          { slot: 1, hwId: '0x34A055EB' },
          { slot: 2, hwId: '0x24A500E1' },
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slots).toEqual(['ai8v', 'combo', null, null])
    expect(result.slotsConfig).toEqual({ '1': { range: '0-10V' } })
    expect(result.changes.map((c) => c.kind)).toEqual(['keep', 'add'])
  })

  it('removes project slots the device did not report', () => {
    const result = mergeDiscoveredModules(
      args({
        slots: ['ai8v', 'rly16', 'thm4', null],
        slotsConfig: { '1': { range: '0-5V' }, '2': { x: 1 }, '3': { tc_type: 'K' } },
        detected: [{ slot: 1, hwId: '0x34A055EB' }],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slots).toEqual(['ai8v', null, null, null])
    expect(result.slotsConfig).toEqual({ '1': { range: '0-5V' } })
    expect(result.changes.map((c) => [c.slot, c.kind])).toEqual([
      [1, 'keep'],
      [2, 'remove'],
      [3, 'remove'],
    ])
  })

  it('handles keep, replace, add and remove together', () => {
    const kept = { range: '0-10V', format: 'counts' }
    const result = mergeDiscoveredModules(
      args({
        slots: ['ai8v', 'rly16', null, null],
        slotsConfig: { '1': kept, '2': { inverted: true } },
        detected: [
          { slot: 1, hwId: '0x34A055EB' },
          { slot: 2, hwId: '0x34608CE1' },
          { slot: 3, hwId: '0x24A500E1' },
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slots).toEqual(['ai8v', 'thm4', 'combo', null])
    expect(result.slotsConfig).toEqual({ '1': kept })
    expect(result.slotsConfig['1']).toBe(kept)
    expect(result.changes.map((c) => c.kind)).toEqual(['keep', 'replace', 'add'])
  })

  it('empties every slot when the device reports no modules', () => {
    const result = mergeDiscoveredModules(args({ slots: ['ai8v', 'rly16', null, null], detected: [] }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slots).toEqual([null, null, null, null])
    expect(result.changed).toBe(true)
  })

  it('refuses the whole plan and names every unknown hardware id', () => {
    const result = mergeDiscoveredModules(
      args({
        slots: ['ai8v', null, null, null],
        detected: [
          { slot: 1, hwId: '0x34A055EB' },
          { slot: 2, hwId: '0xDEADBEEF' },
          { slot: 3, hwId: '0x00000001' },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('slot 2 (0xDEADBEEF)')
    expect(result.error).toContain('slot 3 (0x00000001)')
    expect(result.error).toContain('Nothing was changed')
  })

  it('does not match a module that declares no hardware id', () => {
    const result = mergeDiscoveredModules(
      args({ slots: ['manual', null, null, null], detected: [{ slot: 1, hwId: '' }] }),
    )
    expect(result.ok).toBe(false)
  })

  it('refuses more modules than the backplane has slots', () => {
    const result = mergeDiscoveredModules(
      args({
        maxSlots: 1,
        slots: [null],
        detected: [
          { slot: 1, hwId: '0x34A055EB' },
          { slot: 2, hwId: '0x34A055EB' },
        ],
      }),
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('keeps settings keys that are not slot numbers', () => {
    const shared = { note: 'x' }
    const result = mergeDiscoveredModules(args({ slotsConfig: { meta: shared }, detected: [] }))
    expect(result.ok && result.slotsConfig.meta).toBe(shared)
  })

  it('refuses a module reported beyond the last slot', () => {
    const result = mergeDiscoveredModules(args({ detected: [{ slot: 5, hwId: '0x34A055EB' }] }))
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.error).toContain('slot 5')
  })

  it('places gapped modules at their own slots on a section that is not stackable', () => {
    const kept = { range: '0-10V' }
    const result = mergeDiscoveredModules(
      args({
        slots: ['rly16', 'ai8v', null, 'thm4'],
        slotsConfig: { '1': { x: 1 }, '2': kept, '4': { tc_type: 'K' } },
        detected: [
          { slot: 2, hwId: '0x34A055EB' },
          { slot: 4, hwId: '0x24A500E1' },
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slots).toEqual([null, 'ai8v', null, 'combo'])
    expect(result.slotsConfig).toEqual({ '2': kept })
    expect(result.slotsConfig['2']).toBe(kept)
    expect(result.changes.map((c) => [c.slot, c.kind])).toEqual([
      [1, 'remove'],
      [2, 'keep'],
      [4, 'replace'],
    ])
  })

  it('matches a decimal id from the device against the hex id in the package', () => {
    const result = mergeDiscoveredModules(args({ detected: [{ slot: 1, hwId: '882922987' }] }))
    expect(result.ok && result.slots[0]).toBe('ai8v')
  })

  it('refuses a hardware id that two modules share instead of picking one', () => {
    const twins: DiscoveryModuleDef[] = [
      ...MODULES,
      { id: 'ai8v-clone', name: 'SLM-AI-8-V (rev B)', hwId: '0x34a055eb' },
    ]
    const result = mergeDiscoveredModules(args({ modules: twins, detected: [{ slot: 1, hwId: '0x34A055EB' }] }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('more than one module')
    expect(result.error).toContain('SLM-AI-8-V, SLM-AI-8-V (rev B)')
  })

  it('keeps the project module when it carries a shared hardware id', () => {
    const twins: DiscoveryModuleDef[] = [
      ...MODULES,
      { id: 'ai8v-clone', name: 'SLM-AI-8-V (rev B)', hwId: '0x34a055eb' },
    ]
    const config = { range: '0-5V' }
    const result = mergeDiscoveredModules(
      args({
        modules: twins,
        slots: ['ai8v-clone', null, null, null],
        slotsConfig: { '1': config },
        detected: [{ slot: 1, hwId: '0x34A055EB' }],
      }),
    )

    expect(result.ok && result.slots[0]).toBe('ai8v-clone')
    expect(result.ok && result.slotsConfig['1']).toBe(config)
  })

  describe('with a built-in locked slot', () => {
    const withFixed: DiscoveryModuleDef[] = [
      { id: 'builtin', name: 'Built-in I/O', hwId: '0x1', fixed: true },
      ...MODULES,
    ]

    it('keeps the locked slot and its settings even when the device does not report it', () => {
      const builtinConfig = { a1_mode: 'analog' }
      const result = mergeDiscoveredModules(
        args({
          modules: withFixed,
          slots: ['builtin', 'rly16', null, null],
          slotsConfig: { '1': builtinConfig },
          detected: [],
          lockedSlotIndex: 0,
        }),
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.slots).toEqual(['builtin', null, null, null])
      expect(result.slotsConfig['1']).toBe(builtinConfig)
    })

    it('refuses when the device reports a different module in the locked slot', () => {
      const result = mergeDiscoveredModules(
        args({
          modules: withFixed,
          slots: ['builtin', null, null, null],
          detected: [{ slot: 1, hwId: '0x34A055EB' }],
          lockedSlotIndex: 0,
        }),
      )
      expect(result).toMatchObject({ ok: false })
    })

    it('refuses a report at a locked slot whose module declares no hardware id', () => {
      const noId: DiscoveryModuleDef[] = [{ id: 'builtin', name: 'Built-in I/O', fixed: true }, ...MODULES]
      const result = mergeDiscoveredModules(
        args({
          modules: noId,
          slots: ['builtin', null, null, null],
          detected: [{ slot: 1, hwId: '0x34A055EB' }],
          lockedSlotIndex: 0,
        }),
      )

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('declares no hardware id')
      expect(result.error).toContain('Nothing was changed')
    })

    it('keeps a locked slot without a hardware id when the device does not report it', () => {
      const noId: DiscoveryModuleDef[] = [{ id: 'builtin', name: 'Built-in I/O', fixed: true }, ...MODULES]
      const result = mergeDiscoveredModules(
        args({
          modules: noId,
          slots: ['builtin', null, null, null],
          detected: [{ slot: 2, hwId: '0x34A055EB' }],
          lockedSlotIndex: 0,
        }),
      )
      expect(result.ok && result.slots.slice(0, 2)).toEqual(['builtin', 'ai8v'])
    })

    it('never places a fixed module in an expansion slot', () => {
      const result = mergeDiscoveredModules(
        args({
          modules: withFixed,
          slots: ['builtin', null, null, null],
          detected: [
            { slot: 1, hwId: '0x1' },
            { slot: 2, hwId: '0x1' },
          ],
          lockedSlotIndex: 0,
        }),
      )
      expect(result).toMatchObject({ ok: false })
    })
  })
})
