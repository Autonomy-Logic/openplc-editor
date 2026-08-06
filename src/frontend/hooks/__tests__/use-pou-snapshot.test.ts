import { renderHook } from '@testing-library/react'

import { useOpenPLCStore } from '../../store'
import { usePouSnapshot } from '../use-pou-snapshot'

describe('usePouSnapshot', () => {
  describe('captureAndPush', () => {
    it('captures a data type snapshot keyed by the data type name', () => {
      const created = useOpenPLCStore.getState().datatypeActions.create({
        name: 'CaptureColors',
        derivation: 'enumerated',
      })
      expect(created.ok).toBe(true)

      const { result } = renderHook(() => usePouSnapshot())
      result.current.captureAndPush('CaptureColors')

      const bucket = useOpenPLCStore.getState().undoRedo['CaptureColors']
      expect(bucket.past).toHaveLength(1)
      expect(bucket.past[0].variables).toEqual([])
      expect(bucket.past[0].body).toBeNull()
      expect(bucket.past[0].dataTypes).toEqual([
        expect.objectContaining({ name: 'CaptureColors', derivation: 'enumerated' }),
      ])
    })

    it('captures the current data type state, not the creation-time state', () => {
      useOpenPLCStore.getState().datatypeActions.create({ name: 'CaptureDims', derivation: 'array' })
      const current = useOpenPLCStore.getState().project.data.dataTypes.find((d) => d.name === 'CaptureDims')
      if (!current || current.derivation !== 'array') throw new Error('CaptureDims array data type missing')
      useOpenPLCStore.getState().projectActions.updateDatatype('CaptureDims', {
        ...current,
        dimensions: [{ dimension: '0..7' }],
      })

      const { result } = renderHook(() => usePouSnapshot())
      result.current.captureAndPush('CaptureDims')

      const bucket = useOpenPLCStore.getState().undoRedo['CaptureDims']
      expect(bucket.past[0].dataTypes).toEqual([
        expect.objectContaining({ name: 'CaptureDims', dimensions: [{ dimension: '0..7' }] }),
      ])
    })

    it('captures a POU snapshot for POU names', () => {
      useOpenPLCStore.getState().pouActions.create({ type: 'program', name: 'CaptureMain', language: 'st' })

      const { result } = renderHook(() => usePouSnapshot())
      result.current.captureAndPush('CaptureMain')

      const bucket = useOpenPLCStore.getState().undoRedo['CaptureMain']
      expect(bucket.past).toHaveLength(1)
      expect(bucket.past[0].dataTypes).toBeUndefined()
      const pou = useOpenPLCStore.getState().project.data.pous.find((p) => p.name === 'CaptureMain')
      if (!pou) throw new Error('CaptureMain POU missing')
      expect(bucket.past[0].body).toBe(pou.body.value)
    })

    it('is a no-op for names matching neither a POU nor a data type', () => {
      const { result } = renderHook(() => usePouSnapshot())
      result.current.captureAndPush('CaptureGhost')

      expect(useOpenPLCStore.getState().undoRedo['CaptureGhost']).toBeUndefined()
    })
  })
})
