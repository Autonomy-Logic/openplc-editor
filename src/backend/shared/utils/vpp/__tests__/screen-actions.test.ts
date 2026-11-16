import { describe, expect, it } from '@jest/globals'

import { interpretPluginCommandResponse, parseScreenActions } from '../screen-actions'

describe('parseScreenActions', () => {
  it('keeps the local action the layouts implement', () => {
    const actions = parseScreenActions([
      { id: 'clear', label: 'Clear All Slots', type: 'local', action: 'clear-module-slots', confirm: 'Sure?' },
    ])

    expect(actions).toEqual([
      { kind: 'local', id: 'clear', label: 'Clear All Slots', action: 'clear-module-slots', confirm: 'Sure?' },
    ])
  })

  it.each(['discover', 'discover_modules', 'test', 'status'])('keeps the %s plugin command', (command: string) => {
    const actions = parseScreenActions([
      { id: command, label: command, type: 'plugin-command', command, plugin: 'synergy' },
    ])

    expect(actions).toEqual([
      { kind: 'plugin-command', id: command, label: command, plugin: 'synergy', command, params: {} },
    ])
  })

  it('falls back to the screen default plugin when the action omits one', () => {
    const actions = parseScreenActions(
      [{ id: 'd', label: 'Discover', type: 'plugin-command', command: 'discover' }],
      'synergy',
    )

    expect(actions[0]).toMatchObject({ plugin: 'synergy' })
  })

  it('drops a plugin command with no plugin to route to', () => {
    expect(parseScreenActions([{ id: 'd', label: 'Discover', type: 'plugin-command', command: 'discover' }])).toEqual(
      [],
    )
  })

  it.each([
    ['an unknown local action', { id: 'x', label: 'X', type: 'local', action: 'rm-rf' }],
    ['an unknown command', { id: 'x', label: 'X', type: 'plugin-command', command: 'reboot', plugin: 'p' }],
    ['an unknown action type', { id: 'x', label: 'X', type: 'shell', command: 'ls' }],
    ['a missing label', { id: 'x', type: 'local', action: 'clear-module-slots' }],
    ['a missing id', { label: 'X', type: 'local', action: 'clear-module-slots' }],
    ['a non-object entry', 'clear-module-slots'],
  ] as Array<[string, unknown]>)('drops %s rather than rendering it', (_label: string, entry: unknown) => {
    expect(parseScreenActions([entry], 'synergy')).toEqual([])
  })

  it('drops a duplicate id so two buttons cannot share an identity', () => {
    const actions = parseScreenActions(
      [
        { id: 'go', label: 'First', type: 'plugin-command', command: 'status', plugin: 'p' },
        { id: 'go', label: 'Second', type: 'plugin-command', command: 'test', plugin: 'p' },
      ],
      'p',
    )

    expect(actions).toHaveLength(1)
    expect(actions[0].label).toBe('First')
  })

  it('strips prototype keys out of the params it will send', () => {
    const actions = parseScreenActions(
      [
        {
          id: 'd',
          label: 'Discover',
          type: 'plugin-command',
          command: 'discover',
          plugin: 'p',
          params: JSON.parse('{"slot":1,"__proto__":{"polluted":true}}') as Record<string, unknown>,
        },
      ],
      'p',
    )

    expect(actions[0]).toMatchObject({ params: { slot: 1 } })
    expect(Object.keys((actions[0] as { params: Record<string, unknown> }).params)).not.toContain('__proto__')
  })

  it('returns nothing for a screen with no actions', () => {
    expect(parseScreenActions(undefined)).toEqual([])
    expect(parseScreenActions({ id: 'nope' })).toEqual([])
  })
})

describe('interpretPluginCommandResponse', () => {
  it('reads a successful plugin response', () => {
    expect(interpretPluginCommandResponse(200, { modules: ['a', 'b'] })).toEqual({
      ok: true,
      data: { modules: ['a', 'b'] },
    })
  })

  it('treats an error key at HTTP 200 as a failure', () => {
    // The route answers 200 even when the plugin failed; the body is the
    // failure channel. Reading the status code alone is the mistake.
    expect(interpretPluginCommandResponse(200, { error: 'no backplane detected' })).toEqual({
      ok: false,
      error: 'no backplane detected',
    })
  })

  it('treats a non-string error value as a failure too', () => {
    expect(interpretPluginCommandResponse(200, { error: { code: 7 } })).toMatchObject({ ok: false })
  })

  it.each([404, 500, 502])('treats HTTP %s as a failure', (status: number) => {
    expect(interpretPluginCommandResponse(status, { modules: [] })).toMatchObject({ ok: false })
  })

  it.each([null, 'plain text', [1, 2, 3]] as unknown[])(
    'treats the unreadable body %j as a failure',
    (body: unknown) => {
      expect(interpretPluginCommandResponse(200, body)).toMatchObject({ ok: false })
    },
  )

  it('passes the device refusal through as the error to show', () => {
    expect(interpretPluginCommandResponse(200, { error: 'Stop the PLC before detecting modules.' })).toEqual({
      ok: false,
      error: 'Stop the PLC before detecting modules.',
    })
  })
})

describe('parseScreenActions with the package schema command type', () => {
  const detect = {
    id: 'detect_modules',
    label: 'Auto-Detect Modules',
    icon: 'search',
    type: 'command',
    command: 'discover_modules',
    requiresConnection: true,
    confirm: 'Replace the configuration?',
    resultMapping: { path: 'modules', slotField: 'slot', moduleIdField: 'hwId' },
  }

  it('reads a schema-valid command action as a plugin command', () => {
    expect(parseScreenActions([detect], 'synergy')).toEqual([
      {
        kind: 'plugin-command',
        id: 'detect_modules',
        label: 'Auto-Detect Modules',
        plugin: 'synergy',
        command: 'discover_modules',
        params: {},
        confirm: 'Replace the configuration?',
        requiresConnection: true,
        resultMapping: { path: 'modules', slotField: 'slot', moduleIdField: 'hwId' },
      },
    ])
  })

  it('sends the command payload as the params', () => {
    const actions = parseScreenActions([{ ...detect, payload: { verbose: true } }], 'synergy')
    expect(actions[0]).toMatchObject({ params: { verbose: true } })
  })

  it('omits requiresConnection and resultMapping when the screen does not declare them', () => {
    const actions = parseScreenActions(
      [{ id: 's', label: 'Status', type: 'command', command: 'status', requiresConnection: false }],
      'synergy',
    )
    expect(actions).toEqual([
      { kind: 'plugin-command', id: 's', label: 'Status', plugin: 'synergy', command: 'status', params: {} },
    ])
  })

  it('drops a command action without a plugin to route to', () => {
    expect(parseScreenActions([detect])).toEqual([])
  })

  it('drops a command outside the allowlist', () => {
    expect(parseScreenActions([{ ...detect, command: 'reboot' }], 'synergy')).toEqual([])
  })

  it.each([
    ['not an object', 'modules'],
    ['missing path', { slotField: 'slot', moduleIdField: 'hwId' }],
    ['missing slotField', { path: 'modules', moduleIdField: 'hwId' }],
    ['empty moduleIdField', { path: 'modules', slotField: 'slot', moduleIdField: '' }],
  ] as Array<[string, unknown]>)('drops an action whose resultMapping is %s', (_label: string, mapping: unknown) => {
    expect(parseScreenActions([{ ...detect, resultMapping: mapping }], 'synergy')).toEqual([])
  })

  it('still ignores the schema types it does not implement', () => {
    expect(
      parseScreenActions(
        [
          { id: 'q', label: 'Q', type: 'query', query: 'status' },
          { id: 'n', label: 'N', type: 'navigate', target: 'x' },
        ],
        'synergy',
      ),
    ).toEqual([])
  })
})
