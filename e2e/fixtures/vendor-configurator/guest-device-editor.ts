/**
 * Fake bundle entry plus sandbox probes. Each probe tries something the sandbox must forbid and
 * records whether it was blocked on `<html data-sandbox-probes>`; `own-scope` is the control.
 * `remote-fetch` counts as blocked only when the browser reports a CSP violation, so an offline run
 * cannot pass for a blocked one. Then the guest tries to leave through a form, a child frame and,
 * in Electron only, its own frame; whether a request got out is judged by the host, and
 * `<html data-navigation-probe="stayed">` marks that the guest document survived.
 */

import './guest-scope'

import { installFakeDeviceEditor } from '../../../src/__fixtures__/fake-device-editor/fake-device-editor'

export interface SandboxProbeResult {
  name: string
  blocked: boolean
  detail: string
}

const REMOTE = 'https://example.com/'
// Navigation violations report only the origin of the blocked URL.
const REMOTE_ORIGIN = new URL(REMOTE).origin
const VIOLATION_WAIT_MS = 1000

const violations: SecurityPolicyViolationEvent[] = []
document.addEventListener('securitypolicyviolation', (event) => violations.push(event))

async function probe(name: string, attempt: () => unknown): Promise<SandboxProbeResult> {
  try {
    const value: unknown = await attempt()
    return { name, blocked: false, detail: String(value) }
  } catch (error) {
    return { name, blocked: true, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

/** Runs `attempt`, then resolves once the browser reported a violation of `directive` for the remote URL. */
async function cspProbe(name: string, directive: string, attempt: () => unknown): Promise<SandboxProbeResult> {
  try {
    await attempt()
  } catch {
    /* only the violation report counts */
  }
  const deadline = Date.now() + VIOLATION_WAIT_MS
  while (Date.now() < deadline) {
    const hit = violations.find((v) => v.effectiveDirective === directive && v.blockedURI.startsWith(REMOTE_ORIGIN))
    if (hit) return { name, blocked: true, detail: `CSP ${hit.effectiveDirective}` }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const seen = violations.map((v) => `${v.effectiveDirective} ${v.blockedURI}`).join(', ') || 'none'
  return { name, blocked: false, detail: `no ${directive} violation reported; seen: ${seen}` }
}

function submitForm(): void {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = REMOTE
  form.target = '_self'
  document.body.append(form)
  form.submit()
}

function addChildFrame(): void {
  const child = document.createElement('iframe')
  child.src = REMOTE
  document.body.append(child)
}

installFakeDeviceEditor(window, { document })

async function runProbes(): Promise<void> {
  const results = await Promise.all([
    probe('own-scope', () => typeof window.DeviceEditorProvider),
    probe('parent-document', () => window.parent.document.title),
    probe('top-location', () => window.top?.location.href),
    probe('local-storage', () => window.localStorage.length),
    probe('parent-bridge', () => Reflect.get(window.parent, 'bridge')),
    probe('own-bridge', () => {
      if (Reflect.get(window, 'bridge') === undefined) throw new Error('no bridge in the guest')
      return 'present'
    }),
    probe('popup', () => {
      if (!window.open('about:blank')) throw new Error('window.open returned null')
      return 'opened'
    }),
    cspProbe('remote-fetch', 'connect-src', () => fetch(REMOTE)),
  ])
  document.documentElement.setAttribute('data-sandbox-probes', JSON.stringify(results))

  submitForm()
  addChildFrame()

  // A browser host cannot cancel this navigation, so it would take the page away mid-test.
  if (!navigator.userAgent.includes('Electron/')) return
  window.location.href = `${REMOTE}?probe=navigation`
  await new Promise((resolve) => setTimeout(resolve, VIOLATION_WAIT_MS))
  document.documentElement.setAttribute('data-navigation-probe', 'stayed')
}

runProbes().catch((error: unknown) => {
  document.documentElement.setAttribute('data-sandbox-probes-error', String(error))
})
