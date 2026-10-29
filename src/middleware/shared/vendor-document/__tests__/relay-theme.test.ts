import { afterEach, describe, expect, it } from '@jest/globals'

import { RELAY_CHANNEL } from '../protocol'
import { installThemeOverrides, installWindowRelay, THEME_ATTRIBUTE, THEME_OVERRIDES_STYLESHEET } from '../relay'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

const isGuestWindow = (value: Window | null): value is Window & typeof globalThis =>
  value !== null && 'Element' in value

function mountGuest() {
  const iframe = document.createElement('iframe')
  document.body.append(iframe)
  cleanups.push(() => iframe.remove())
  const guest = iframe.contentWindow
  if (!isGuestWindow(guest)) throw new Error('the iframe has no window')
  return guest
}

const overrideLinks = (root: Document | ShadowRoot) =>
  Array.from(root.querySelectorAll<HTMLLinkElement>(`link[href="${THEME_OVERRIDES_STYLESHEET}"]`))

function vendorComponent(guest: Window & typeof globalThis, mode: ShadowRootMode = 'open') {
  const host = guest.document.createElement('div')
  guest.document.body.append(host)
  return host.attachShadow({ mode })
}

describe('theme overrides', () => {
  it('links the overrides into the document head and every shadow root, including later ones', () => {
    const guest = mountGuest()
    const overrides = installThemeOverrides(guest)
    cleanups.push(overrides.uninstall)

    const atBoot = vendorComponent(guest)
    overrides.apply('dark')
    const later = vendorComponent(guest)
    const closed = vendorComponent(guest, 'closed')

    for (const root of [guest.document.head, atBoot, later, closed]) {
      const links = root instanceof guest.HTMLHeadElement ? overrideLinks(guest.document) : overrideLinks(root)
      expect(links).toHaveLength(1)
      expect(links[0]?.rel).toBe('stylesheet')
      expect(links[0]?.media).toBe('all')
    }
  })

  it('enables the overrides only in dark and marks the root element with the theme', () => {
    const guest = mountGuest()
    const overrides = installThemeOverrides(guest)
    cleanups.push(overrides.uninstall)
    const root = vendorComponent(guest)
    const media = () => [...overrideLinks(guest.document), ...overrideLinks(root)].map((link) => link.media)

    expect(media()).toEqual(['not all', 'not all'])
    expect(guest.document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)

    overrides.apply('dark')
    expect(media()).toEqual(['all', 'all'])
    expect(guest.document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')

    overrides.apply('light')
    expect(media()).toEqual(['not all', 'not all'])
    expect(guest.document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light')
  })

  it('restores attachShadow and removes its links on uninstall', () => {
    const guest = mountGuest()
    const original = guest.Element.prototype.attachShadow
    const overrides = installThemeOverrides(guest)
    expect(guest.Element.prototype.attachShadow).not.toBe(original)

    overrides.uninstall()

    expect(guest.Element.prototype.attachShadow).toBe(original)
    expect(overrideLinks(guest.document)).toHaveLength(0)
    expect(overrideLinks(vendorComponent(guest))).toHaveLength(0)
  })
})

describe('window relay theme messages', () => {
  function installed() {
    const guest = mountGuest()
    cleanups.push(installWindowRelay(guest, { bootTimeoutMs: 60_000 }))
    const send = (source: Window, data: unknown) =>
      guest.dispatchEvent(new guest.MessageEvent('message', { source, data }))
    const theme = () => guest.document.documentElement.getAttribute(THEME_ATTRIBUTE)
    return { guest, send, theme }
  }

  it('applies a theme sent by its parent', () => {
    const { send, theme, guest } = installed()

    send(guest.parent, { channel: RELAY_CHANNEL, kind: 'theme', theme: 'dark' })

    expect(theme()).toBe('dark')
    expect(overrideLinks(guest.document).map((link) => link.media)).toEqual(['all'])
  })

  it('ignores a theme from any other source', () => {
    const { send, theme, guest } = installed()
    const other = mountGuest()

    send(guest, { channel: RELAY_CHANNEL, kind: 'theme', theme: 'dark' })
    send(other, { channel: RELAY_CHANNEL, kind: 'theme', theme: 'dark' })

    expect(theme()).toBeNull()
  })

  it.each([
    ['an unknown theme', { channel: RELAY_CHANNEL, kind: 'theme', theme: 'nineties' }],
    ['a differently cased theme', { channel: RELAY_CHANNEL, kind: 'theme', theme: 'Dark' }],
    ['no theme', { channel: RELAY_CHANNEL, kind: 'theme' }],
    ['another channel', { channel: 'other', kind: 'theme', theme: 'dark' }],
  ])('ignores %s', (_case, data) => {
    const { send, theme, guest } = installed()
    send(guest.parent, { channel: RELAY_CHANNEL, kind: 'theme', theme: 'light' })

    send(guest.parent, data)

    expect(theme()).toBe('light')
  })
})
