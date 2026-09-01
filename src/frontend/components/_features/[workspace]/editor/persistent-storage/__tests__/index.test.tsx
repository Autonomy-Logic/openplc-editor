/**
 * The Persistent Storage screen is a PROJECT form. What is worth pinning down is
 * that it behaves like one — no device, no connection, edits landing in the
 * store — because the previous version of this screen read and wrote a
 * connected runtime, and the whole point of the change is that it no longer can.
 */

import { fireEvent, render, screen } from '@testing-library/react'

import { useOpenPLCStore } from '@root/frontend/store'
import { DEFAULT_RETAIN_FLUSH_SECONDS, RETAIN_MAX_FLUSH_SECONDS } from '@root/middleware/shared/ports/types'

import { PersistentStorageEditor } from '../index'

/** Narrow, don't assert.
 *
 *  CLAUDE.md forbids type assertions, and the reason applies here: `as
 *  HTMLInputElement` on a query that starts returning a wrapper would read
 *  `.disabled` as `undefined` and quietly pass. `instanceof` fails loudly. */
function input(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`expected an <input>, got <${el.tagName.toLowerCase()}>`)
  }
  return el
}

function settings() {
  return useOpenPLCStore.getState().deviceDefinitions.configuration.persistentStorage
}

function setSettings(value: { enabled: boolean; path: string; flushSeconds: number } | undefined) {
  useOpenPLCStore.setState((s) => ({
    ...s,
    deviceDefinitions: {
      ...s.deviceDefinitions,
      configuration: { ...s.deviceDefinitions.configuration, persistentStorage: value },
    },
  }))
}

beforeEach(() => {
  setSettings(undefined)
})

describe('PersistentStorageEditor', () => {
  it('renders with no device attached', () => {
    // The predecessor showed "you are not connected" here. There is nothing to
    // connect to now: the settings are part of the project.
    render(<PersistentStorageEditor />)

    expect(screen.getByRole('heading', { name: /persistent storage/i })).toBeTruthy()
    expect(screen.getByLabelText(/file location/i)).toBeTruthy()
    expect(screen.queryByText(/not connected/i)).toBeNull()
  })

  it('shows storage off for a project that never configured it', () => {
    render(<PersistentStorageEditor />)

    expect(input(screen.getByRole('checkbox')).checked).toBe(false)
    expect(input(screen.getByLabelText(/file location/i)).disabled).toBe(true)
  })

  it('writes the toggle into the project, materialising the record on first edit', () => {
    render(<PersistentStorageEditor />)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(settings()).toEqual({
      enabled: true,
      path: '',
      flushSeconds: DEFAULT_RETAIN_FLUSH_SECONDS,
    })
  })

  it('writes the path into the project', () => {
    setSettings({ enabled: true, path: '', flushSeconds: 5 })
    render(<PersistentStorageEditor />)

    fireEvent.change(screen.getByLabelText(/file location/i), { target: { value: '/data/retain.bin' } })

    expect(settings()?.path).toBe('/data/retain.bin')
  })

  it('writes the commit period into the project', () => {
    setSettings({ enabled: true, path: '/data/retain.bin', flushSeconds: 5 })
    render(<PersistentStorageEditor />)

    fireEvent.change(screen.getByLabelText(/save every/i), { target: { value: '30' } })

    expect(settings()?.flushSeconds).toBe(30)
  })

  it('leaves an empty path empty rather than inventing a device default', () => {
    // The editor does not know the device's filesystem layout, so the runtime
    // fills this in. Showing a made-up path here would be a claim about a box
    // the editor has never talked to.
    setSettings({ enabled: true, path: '', flushSeconds: 5 })
    render(<PersistentStorageEditor />)

    const path = input(screen.getByLabelText(/file location/i))
    expect(path.value).toBe('')
    expect(path.placeholder).toMatch(/runtime default/i)
  })

  it('flags a period the runtime would refuse at upload', () => {
    setSettings({ enabled: true, path: '/data/retain.bin', flushSeconds: RETAIN_MAX_FLUSH_SECONDS + 1 })
    render(<PersistentStorageEditor />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText(/save every/i).getAttribute('aria-invalid')).toBe('true')
  })

  it('flags a fractional period, which the upload would silently round', () => {
    // The field said valid and the emitter applied something else: it rounds, so
    // 1.5 shipped as 2. A UI that accepts a value the device will not use is
    // worse than one that refuses it.
    setSettings({ enabled: true, path: '/data/retain.bin', flushSeconds: 1.5 })
    render(<PersistentStorageEditor />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText(/save every/i).getAttribute('aria-invalid')).toBe('true')
  })

  it('does not flag a period inside the accepted range', () => {
    setSettings({ enabled: true, path: '/data/retain.bin', flushSeconds: 5 })
    render(<PersistentStorageEditor />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disables the fields while storage is off, so nothing is edited into a disabled stanza', () => {
    setSettings({ enabled: false, path: '/data/retain.bin', flushSeconds: 5 })
    render(<PersistentStorageEditor />)

    expect(input(screen.getByLabelText(/file location/i)).disabled).toBe(true)
    expect(input(screen.getByLabelText(/save every/i)).disabled).toBe(true)
  })

  it('says the settings travel with the project', () => {
    // A user needs to know an upload is what applies these, not a Save button
    // talking to a device.
    render(<PersistentStorageEditor />)

    expect(screen.getByText(/saved with the project and applied when you upload/i)).toBeTruthy()
  })
})
