import { createStore } from 'zustand/vanilla'

import type { HistorySlice, HistorySnapshot } from '../slices/history'
import { createHistorySlice, HISTORY_LIMIT } from '../slices/history'

function makeStore() {
  return createStore<HistorySlice>()(createHistorySlice)
}

function makeSnapshot(overrides?: Partial<HistorySnapshot>): HistorySnapshot {
  return {
    variables: overrides?.variables ?? [
      {
        name: 'var1',
        class: 'local',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '',
        documentation: '',
        debug: false,
      },
    ],
    body: overrides?.body ?? '<ST>some code</ST>',
    ladderFlow: overrides?.ladderFlow,
    fbdFlow: overrides?.fbdFlow,
    globalVariables: overrides?.globalVariables,
    tasks: overrides?.tasks,
    instances: overrides?.instances,
    dataTypes: overrides?.dataTypes,
  }
}

describe('createHistorySlice', () => {
  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('should have a default-history bucket with empty past and future', () => {
      const store = makeStore()
      const { history } = store.getState()

      expect(history).toHaveProperty('default-history')
      expect(history['default-history']).toEqual({ past: [], future: [], savedAtDepth: null })
    })

    it('should expose all history actions', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      expect(typeof historyActions.addPastHistory).toBe('function')
      expect(typeof historyActions.addFutureHistory).toBe('function')
      expect(typeof historyActions.popPastHistory).toBe('function')
      expect(typeof historyActions.popFutureHistory).toBe('function')
      expect(typeof historyActions.undo).toBe('function')
      expect(typeof historyActions.redo).toBe('function')
      expect(typeof historyActions.clearHistory).toBe('function')
    })
  })

  // ---------------------------------------------------------------------------
  // addPastHistory
  // ---------------------------------------------------------------------------

  describe('addPastHistory', () => {
    it('should push a snapshot to the past stack of an existing bucket', () => {
      const store = makeStore()
      const snapshot = makeSnapshot()

      store.getState().historyActions.addPastHistory('default-history', snapshot)

      const bucket = store.getState().history['default-history']
      expect(bucket.past).toHaveLength(1)
      expect(bucket.past[0].variables).toEqual(snapshot.variables)
      expect(bucket.past[0].body).toBe(snapshot.body)
    })

    it('should create a new bucket if the pouName does not exist', () => {
      const store = makeStore()
      const snapshot = makeSnapshot({ body: 'new-pou-body' })

      store.getState().historyActions.addPastHistory('myPOU', snapshot)

      const bucket = store.getState().history['myPOU']
      expect(bucket).toBeDefined()
      expect(bucket.past).toHaveLength(1)
      expect(bucket.past[0].body).toBe('new-pou-body')
      expect(bucket.future).toEqual([])
    })

    it('should clear the future stack when adding past history', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      // First add a future entry
      historyActions.addFutureHistory('pou-A', makeSnapshot({ body: 'future-1' }))
      expect(store.getState().history['pou-A'].future).toHaveLength(1)

      // Now add a past entry — should clear future
      historyActions.addPastHistory('pou-A', makeSnapshot({ body: 'past-1' }))

      const bucket = store.getState().history['pou-A']
      expect(bucket.past).toHaveLength(1)
      expect(bucket.future).toEqual([])
    })

    it('should respect HISTORY_LIMIT by removing oldest entry when exceeding 50', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      // Push exactly HISTORY_LIMIT items
      for (let i = 0; i < HISTORY_LIMIT; i++) {
        historyActions.addPastHistory('pou-limit', makeSnapshot({ body: `body-${i}` }))
      }
      expect(store.getState().history['pou-limit'].past).toHaveLength(HISTORY_LIMIT)

      // Push one more — oldest should be evicted
      historyActions.addPastHistory('pou-limit', makeSnapshot({ body: 'body-overflow' }))
      const past = store.getState().history['pou-limit'].past
      expect(past).toHaveLength(HISTORY_LIMIT)

      // Oldest item should now be body-1 (body-0 was shifted out)
      expect(past[0].body).toBe('body-1')
      // Newest item should be the overflow
      expect(past[past.length - 1].body).toBe('body-overflow')
    })

    it('should confirm HISTORY_LIMIT equals 50', () => {
      expect(HISTORY_LIMIT).toBe(50)
    })
  })

  // ---------------------------------------------------------------------------
  // addFutureHistory
  // ---------------------------------------------------------------------------

  describe('addFutureHistory', () => {
    it('should push a snapshot to the future stack of an existing bucket', () => {
      const store = makeStore()
      const snapshot = makeSnapshot({ body: 'future-snap' })

      store.getState().historyActions.addFutureHistory('default-history', snapshot)

      const bucket = store.getState().history['default-history']
      expect(bucket.future).toHaveLength(1)
      expect(bucket.future[0].body).toBe('future-snap')
    })

    it('should create a new bucket if the pouName does not exist', () => {
      const store = makeStore()
      const snapshot = makeSnapshot({ body: 'new-future' })

      store.getState().historyActions.addFutureHistory('new-pou', snapshot)

      const bucket = store.getState().history['new-pou']
      expect(bucket).toBeDefined()
      expect(bucket.future).toHaveLength(1)
      expect(bucket.future[0].body).toBe('new-future')
      expect(bucket.past).toEqual([])
    })

    it('should not affect the past stack', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      historyActions.addPastHistory('pou-X', makeSnapshot({ body: 'past-entry' }))
      historyActions.addFutureHistory('pou-X', makeSnapshot({ body: 'future-entry' }))

      // addPastHistory clears future, so we need to add future on a bucket that already has past
      // but addPastHistory cleared future — re-add future after past
      const bucket = store.getState().history['pou-X']
      expect(bucket.past).toHaveLength(1)
      expect(bucket.future).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // popPastHistory
  // ---------------------------------------------------------------------------

  describe('popPastHistory', () => {
    it('should pop and return the most recent past snapshot', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      historyActions.addPastHistory('pou-pop', makeSnapshot({ body: 'first' }))
      historyActions.addPastHistory('pou-pop', makeSnapshot({ body: 'second' }))

      const popped = historyActions.popPastHistory('pou-pop')

      expect(popped).toBeDefined()
      expect(popped!.body).toBe('second')
      expect(store.getState().history['pou-pop'].past).toHaveLength(1)
      expect(store.getState().history['pou-pop'].past[0].body).toBe('first')
    })

    it('should return undefined for an empty past stack', () => {
      const store = makeStore()

      const popped = store.getState().historyActions.popPastHistory('default-history')

      expect(popped).toBeUndefined()
    })

    it('should return undefined and create bucket for a missing pouName', () => {
      const store = makeStore()

      const popped = store.getState().historyActions.popPastHistory('nonexistent')

      expect(popped).toBeUndefined()
      // Bucket should now exist (created inside the produce)
      expect(store.getState().history['nonexistent']).toEqual({ past: [], future: [], savedAtDepth: null })
    })

    it('should return a deep clone — mutating the returned snapshot must not affect the store', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      historyActions.addPastHistory('pou-clone', makeSnapshot({ body: 'original' }))
      historyActions.addPastHistory('pou-clone', makeSnapshot({ body: 'to-pop' }))

      const popped = historyActions.popPastHistory('pou-clone')
      expect(popped).toBeDefined()

      // Mutate the returned snapshot
      popped!.body = 'MUTATED'
      popped!.variables.push({
        name: 'injected',
        class: 'local',
        type: { definition: 'base-type', value: 'INT' },
        location: '',
        documentation: '',
        debug: false,
      })

      // Store should be unaffected
      const remaining = store.getState().history['pou-clone'].past[0]
      expect(remaining.body).toBe('original')
      expect(remaining.variables).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // popFutureHistory
  // ---------------------------------------------------------------------------

  describe('popFutureHistory', () => {
    it('should pop and return the most recent future snapshot', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      historyActions.addFutureHistory('pou-fut', makeSnapshot({ body: 'fut-1' }))
      historyActions.addFutureHistory('pou-fut', makeSnapshot({ body: 'fut-2' }))

      const popped = historyActions.popFutureHistory('pou-fut')

      expect(popped).toBeDefined()
      expect(popped!.body).toBe('fut-2')
      expect(store.getState().history['pou-fut'].future).toHaveLength(1)
      expect(store.getState().history['pou-fut'].future[0].body).toBe('fut-1')
    })

    it('should return undefined for an empty future stack', () => {
      const store = makeStore()

      const popped = store.getState().historyActions.popFutureHistory('default-history')

      expect(popped).toBeUndefined()
    })

    it('should return undefined and create bucket for a missing pouName', () => {
      const store = makeStore()

      const popped = store.getState().historyActions.popFutureHistory('missing-pou')

      expect(popped).toBeUndefined()
      expect(store.getState().history['missing-pou']).toEqual({ past: [], future: [], savedAtDepth: null })
    })

    it('should return a deep clone — mutating the returned snapshot must not affect the store', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      historyActions.addFutureHistory('pou-fclone', makeSnapshot({ body: 'remaining-future' }))
      historyActions.addFutureHistory('pou-fclone', makeSnapshot({ body: 'to-pop-future' }))

      const popped = historyActions.popFutureHistory('pou-fclone')
      expect(popped).toBeDefined()

      // Mutate the returned snapshot
      popped!.body = 'MUTATED'
      popped!.variables = []

      // Store should be unaffected
      const remaining = store.getState().history['pou-fclone'].future[0]
      expect(remaining.body).toBe('remaining-future')
      expect(remaining.variables).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // undo / redo (no-ops)
  // ---------------------------------------------------------------------------

  describe('undo', () => {
    it('should not throw when called', () => {
      const store = makeStore()
      expect(() => store.getState().historyActions.undo('default-history')).not.toThrow()
    })

    it('should not mutate state', () => {
      const store = makeStore()
      const before = store.getState().history
      store.getState().historyActions.undo('default-history')
      const after = store.getState().history
      expect(after).toBe(before)
    })
  })

  describe('redo', () => {
    it('should not throw when called', () => {
      const store = makeStore()
      expect(() => store.getState().historyActions.redo('default-history')).not.toThrow()
    })

    it('should not mutate state', () => {
      const store = makeStore()
      const before = store.getState().history
      store.getState().historyActions.redo('some-pou')
      const after = store.getState().history
      expect(after).toBe(before)
    })
  })

  // ---------------------------------------------------------------------------
  // clearHistory
  // ---------------------------------------------------------------------------

  describe('clearHistory', () => {
    it('should reset all buckets and reinitialize default-history', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      // Populate multiple buckets
      historyActions.addPastHistory('pou-A', makeSnapshot({ body: 'A-past' }))
      historyActions.addFutureHistory('pou-B', makeSnapshot({ body: 'B-future' }))
      historyActions.addPastHistory('default-history', makeSnapshot({ body: 'default-past' }))

      expect(Object.keys(store.getState().history).length).toBeGreaterThan(1)

      // Clear
      historyActions.clearHistory()

      const history = store.getState().history
      expect(Object.keys(history)).toEqual(['default-history'])
      expect(history['default-history']).toEqual({ past: [], future: [], savedAtDepth: null })
    })

    it('should remove custom buckets after clear', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      historyActions.addPastHistory('custom-1', makeSnapshot())
      historyActions.addPastHistory('custom-2', makeSnapshot())
      historyActions.clearHistory()

      expect(store.getState().history['custom-1']).toBeUndefined()
      expect(store.getState().history['custom-2']).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle multiple POU buckets coexisting independently', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      historyActions.addPastHistory('pou-1', makeSnapshot({ body: 'pou-1-past-1' }))
      historyActions.addPastHistory('pou-1', makeSnapshot({ body: 'pou-1-past-2' }))
      historyActions.addFutureHistory('pou-2', makeSnapshot({ body: 'pou-2-fut-1' }))
      historyActions.addPastHistory('pou-3', makeSnapshot({ body: 'pou-3-past-1' }))

      const history = store.getState().history
      expect(history['pou-1'].past).toHaveLength(2)
      expect(history['pou-1'].future).toEqual([])
      expect(history['pou-2'].past).toEqual([])
      expect(history['pou-2'].future).toHaveLength(1)
      expect(history['pou-3'].past).toHaveLength(1)
      expect(history['pou-3'].future).toEqual([])
      // default-history should still be there untouched
      expect(history['default-history']).toEqual({ past: [], future: [], savedAtDepth: null })
    })

    it('should handle popping from a bucket until empty', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      historyActions.addPastHistory('drain', makeSnapshot({ body: 'one' }))
      historyActions.addPastHistory('drain', makeSnapshot({ body: 'two' }))

      const first = historyActions.popPastHistory('drain')
      expect(first!.body).toBe('two')

      const second = historyActions.popPastHistory('drain')
      expect(second!.body).toBe('one')

      const third = historyActions.popPastHistory('drain')
      expect(third).toBeUndefined()

      expect(store.getState().history['drain'].past).toHaveLength(0)
    })

    it('should handle snapshots with optional fields', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      const fullSnapshot = makeSnapshot({
        body: 'full',
        ladderFlow: { name: 'ladder-1', rungs: [] } as unknown as HistorySnapshot['ladderFlow'],
        fbdFlow: { name: 'fbd-1', rungs: [] } as unknown as HistorySnapshot['fbdFlow'],
        globalVariables: [
          {
            name: 'gVar',
            class: 'global',
            type: { definition: 'base-type', value: 'REAL' },
            location: '',
            documentation: '',
            debug: false,
          },
        ],
        tasks: [{ name: 'task-1', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
        instances: [{ name: 'inst-1', task: 'task-1', program: 'myPOU' }],
        dataTypes: [],
      })

      historyActions.addPastHistory('full-pou', fullSnapshot)
      const popped = historyActions.popPastHistory('full-pou')

      expect(popped).toBeDefined()
      expect(popped!.ladderFlow).toEqual({ name: 'ladder-1', rungs: [] })
      expect(popped!.fbdFlow).toEqual({ name: 'fbd-1', rungs: [] })
      expect(popped!.globalVariables).toHaveLength(1)
      expect(popped!.tasks).toHaveLength(1)
      expect(popped!.instances).toHaveLength(1)
      expect(popped!.dataTypes).toEqual([])
    })

    it('should handle addPastHistory clearing future on a newly created bucket', () => {
      const store = makeStore()

      // addPastHistory on a non-existent bucket: it creates the bucket, clears future (already empty), pushes
      store.getState().historyActions.addPastHistory('brand-new', makeSnapshot({ body: 'first' }))

      const bucket = store.getState().history['brand-new']
      expect(bucket.past).toHaveLength(1)
      expect(bucket.future).toEqual([])
    })

    it('should preserve snapshots through deep clone on popFutureHistory', () => {
      const store = makeStore()
      const { historyActions } = store.getState()

      const snap = makeSnapshot({
        body: { nested: { value: 42 } },
        variables: [
          {
            name: 'v',
            class: 'local',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
            debug: false,
          },
        ],
      })

      historyActions.addFutureHistory('deep-pou', snap)
      historyActions.addFutureHistory('deep-pou', snap)

      const popped = historyActions.popFutureHistory('deep-pou')
      expect(popped).toBeDefined()

      // Mutate nested object in popped result
      ;(popped!.body as { nested: { value: number } }).nested.value = 999

      // Remaining snapshot in store should be unaffected
      const remaining = store.getState().history['deep-pou'].future[0]
      expect((remaining.body as { nested: { value: number } }).nested.value).toBe(42)
    })
  })
})
