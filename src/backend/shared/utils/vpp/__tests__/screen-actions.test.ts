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
    const actions = parseScreenActions([{ id: command, label: command, type: 'plugin-command', command, plugin: 'synergy' }])

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
    expect(parseScreenActions([{ id: 'd', label: 'Discover', type: 'plugin-command', command: 'discover' }])).toEqual([])
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

  it.each([null, 'plain text', [1, 2, 3]] as unknown[])('treats the unreadable body %j as a failure', (body: unknown) => {
    expect(interpretPluginCommandResponse(200, body)).toMatchObject({ ok: false })
  })
})
