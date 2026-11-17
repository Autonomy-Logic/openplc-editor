/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HmiPreviewInstance } from '../preview-instance'
import { fakeHost } from './fixtures/support'

describe('HmiPreviewInstance', () => {
  it('starts the viewer and runs frames on the page it shows', async () => {
    const preview = await HmiPreviewInstance.create(fakeHost(), 16, 8)
    preview.show(3)
    expect(preview.frame(0)).toEqual({ page: 3, status: 0 })
    expect(preview.frame(500)).toEqual({ page: 3, status: 1 })
  })

  it('refuses to start when the module has no memory for the viewer', async () => {
    await expect(HmiPreviewInstance.create(fakeHost(), 0, 8)).rejects.toThrow('The preview does not fit in memory')
  })

  it('returns every row first, then only the rows that changed, then nothing', async () => {
    const preview = await HmiPreviewInstance.create(fakeHost(), 16, 8)
    preview.frame(0)
    const first = preview.render(16, 8, 1)
    expect(first).toMatchObject({ width: 16, height: 8, y0: 0, rows: 8 })
    expect(first?.rgba).toHaveLength(16 * 8 * 4)
    preview.frame(50)
    expect(preview.render(16, 8, 1)).toBeNull()
    expect(preview.setNumber(0, 1, 7)).toBe(true)
    preview.frame(100)
    const changed = preview.render(16, 8, 2)
    expect(changed).toMatchObject({ y0: 2, rows: 4 })
    expect(changed?.rgba).toHaveLength(16 * 4 * 4)
  })

  it('reports a surface it cannot draw', async () => {
    const preview = await HmiPreviewInstance.create(fakeHost(), 16, 8)
    preview.frame(0)
    expect(() => preview.render(64, 64, 1)).toThrow('The preview could not draw the frame')
  })

  it('reads bounds in logical units', async () => {
    const preview = await HmiPreviewInstance.create(fakeHost(), 16, 8)
    expect(preview.bounds()).toEqual([
      { id: 1, x: 1, y: 2, width: 10, height: 5 },
      { id: 2, x: 0, y: 0, width: 1, height: 1 },
    ])
  })

  it('passes pointer input, keys, design mode and resizes to the module', async () => {
    const preview = await HmiPreviewInstance.create(fakeHost(), 16, 8)
    preview.pointer('up', 2.5, 3)
    preview.key(13)
    preview.design(true)
    preview.resize(32, 16)
    expect(preview.frame(0).page).toBe(0)
  })

  it('applies setters the module has and refuses the others, cutting long texts', async () => {
    const preview = await HmiPreviewInstance.create(fakeHost(), 16, 8)
    expect(preview.setNumber(0, 1, 42)).toBe(true)
    expect(preview.setNumber(0, 2, 42)).toBe(false)
    expect(preview.setText(0, 1, 'x'.repeat(400))).toBe(true)
    expect(preview.setText(1, 1, 'y')).toBe(false)
  })

  it('answers WASI calls as not supported, and stops when the module exits', async () => {
    const preview = await HmiPreviewInstance.create(fakeHost(), 16, 8)
    expect(() => preview.key(1)).not.toThrow()
    expect(() => preview.key(2)).toThrow('The preview module exited')
  })

  it('refuses a module importing anything but WASI', async () => {
    const foreign = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'foreign-import.wasm')))
    await expect(HmiPreviewInstance.create(foreign, 16, 8)).rejects.toThrow(
      'The preview module imports env.host_call, which the preview does not provide',
    )
  })

  it('refuses a module that is not a preview host', async () => {
    const empty = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
    await expect(HmiPreviewInstance.create(empty, 16, 8)).rejects.toThrow('The preview module exports no memory')
  })
})
