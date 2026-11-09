// Fixture tests: scenarios build the expected models and every intent is recorded.
import { createVariableListFixture, type VariableListScenario } from '..'

describe('variable list fixture', () => {
  it.each<[VariableListScenario, number, string]>([
    ['empty', 0, 'neutral'],
    ['populated', 3, 'neutral'],
    ['loading', 0, 'busy'],
    ['save-failed', 3, 'error'],
  ])('builds the %s scenario', (scenario, rows, tone) => {
    const model = createVariableListFixture(scenario).model.getSnapshot()
    expect(model.rows).toHaveLength(rows)
    expect(model.status.tone).toBe(tone)
  })

  it('simulates the editing flow and records every intent', () => {
    const fixture = createVariableListFixture('empty')
    let notified = 0
    const unsubscribe = fixture.model.subscribe(() => notified++)
    fixture.submitNew()
    fixture.changeNewName(' Pump ')
    fixture.changeNewType('INT')
    fixture.submitNew()
    fixture.startRename(1)
    fixture.changeRename('MainPump')
    fixture.commitRename()
    fixture.startRename(1)
    fixture.cancelRename()
    fixture.requestSave()
    fixture.remove(1)
    unsubscribe()
    fixture.changeRename('ignored')
    fixture.commitRename()
    fixture.cancelRename()
    const model = fixture.model.getSnapshot()
    expect(model.rows).toEqual([])
    expect(model.status.text).toBe('Simulated save: nothing was written.')
    expect(fixture.calls().map((call) => call.intent)).toEqual([
      'submitNew',
      'changeNewName',
      'changeNewType',
      'submitNew',
      'startRename',
      'changeRename',
      'commitRename',
      'startRename',
      'cancelRename',
      'requestSave',
      'remove',
      'changeRename',
      'commitRename',
      'cancelRename',
    ])
    expect(notified).toBe(10)
  })

  it('applies a committed rename to the row', () => {
    const fixture = createVariableListFixture('populated')
    fixture.startRename(2)
    fixture.changeRename('Rpm')
    fixture.commitRename()
    expect(fixture.model.getSnapshot().rows[1]).toEqual({ id: 2, name: 'Rpm', type: 'INT', rename: null })
  })
})
