/**
 * Fake bundle entry plus sandbox probes. Each probe tries something the sandbox must forbid and
 * records whether it was blocked on `<html data-sandbox-probes>`; `own-scope` is the control.
 */

import './guest-scope'

import { installFakeDeviceEditor } from '../../../src/__fixtures__/fake-device-editor/fake-device-editor'

export interface SandboxProbeResult {
  name: string
  blocked: boolean
  detail: string
}

async function probe(name: string, attempt: () => unknown): Promise<SandboxProbeResult> {
  try {
    const value: unknown = await attempt()
    return { name, blocked: false, detail: String(value) }
  } catch (error) {
    return { name, blocked: true, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

installFakeDeviceEditor(window, { document })

void Promise.all([
  probe('own-scope', () => typeof window.DeviceEditorProvider),
  probe('parent-document', () => window.parent.document.title),
  probe('top-location', () => window.top?.location.href),
  probe('local-storage', () => window.localStorage.length),
  probe('parent-bridge', () => Reflect.get(window.parent, 'bridge')),
  probe('remote-fetch', () => fetch('https://example.com/')),
  probe('popup', () => {
    if (!window.open('about:blank')) throw new Error('window.open returned null')
    return 'opened'
  }),
]).then((results) => document.documentElement.setAttribute('data-sandbox-probes', JSON.stringify(results)))
