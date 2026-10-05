import { renderHook } from '@testing-library/react'

import type { OpenPLCStore } from '../../store'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { usePouSnapshot } from '../use-pou-snapshot'

describe('usePouSnapshot', () => {
  let store: OpenPLCStore

  beforeEach(() => {
    store = createTestStore()
  })

  describe('captureAndPush', () => {
    it('captures a data type snapshot keyed by the data type name', () => {
      const created = store.getState().datatypeActions.create({
        name: 'CaptureColors',
        derivation: 'enumerated',
      })
      expect(created.ok).toBe(true)

      const { result } = renderHook(() => usePouSnapshot(), { wrapper: createStoreWrapper(store) })
      result.current.captureAndPush('CaptureColors')

      const bucket = store.getState().undoRedo['CaptureColors']
      expect(bucket.past).toHaveLength(1)
      expect(bucket.past[0].variables).toEqual([])
      expect(bucket.past[0].body).toBeNull()
      expect(bucket.past[0].dataTypes).toEqual([
        expect.objectContaining({ name: 'CaptureColors', derivation: 'enumerated' }),
      ])
    })

    it('captures the current data type state, not the creation-time state', () => {
      store.getState().datatypeActions.create({ name: 'CaptureDims', derivation: 'array' })
      const current = store.getState().project.data.dataTypes.find((d) => d.name === 'CaptureDims')
      if (!current || current.derivation !== 'array') throw new Error('CaptureDims array data type missing')
      store.getState().projectActions.updateDatatype('CaptureDims', {
        ...current,
        dimensions: [{ dimension: '0..7' }],
      })

      const { result } = renderHook(() => usePouSnapshot(), { wrapper: createStoreWrapper(store) })
      result.current.captureAndPush('CaptureDims')

      const bucket = store.getState().undoRedo['CaptureDims']
      expect(bucket.past[0].dataTypes).toEqual([
        expect.objectContaining({ name: 'CaptureDims', dimensions: [{ dimension: '0..7' }] }),
      ])
    })

    it('captures a POU snapshot for POU names', () => {
      store.getState().pouActions.create({ type: 'program', name: 'CaptureMain', language: 'st' })

      const { result } = renderHook(() => usePouSnapshot(), { wrapper: createStoreWrapper(store) })
      result.current.captureAndPush('CaptureMain')

      const bucket = store.getState().undoRedo['CaptureMain']
      expect(bucket.past).toHaveLength(1)
      expect(bucket.past[0].dataTypes).toBeUndefined()
      const pou = store.getState().project.data.pous.find((p) => p.name === 'CaptureMain')
      if (!pou) throw new Error('CaptureMain POU missing')
      expect(bucket.past[0].body).toBe(pou.body.value)
    })

    it('is a no-op for names matching neither a POU nor a data type', () => {
      const { result } = renderHook(() => usePouSnapshot(), { wrapper: createStoreWrapper(store) })
      result.current.captureAndPush('CaptureGhost')

      expect(store.getState().undoRedo['CaptureGhost']).toBeUndefined()
    })
  })
})
