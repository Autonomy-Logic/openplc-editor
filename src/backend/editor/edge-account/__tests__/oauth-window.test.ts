/**
 * Only the URL matcher is exercised here. Running an actual flow needs a real
 * `BrowserWindow` and a real provider, which is an end-to-end concern.
 *
 * The matcher earns its own tests because it decides between two very different fates
 * for a link: intercepted into a window this process owns, or handed to the system
 * browser. Wrong in one direction and provider tokens land in a jar we cannot read —
 * which is exactly the bug this replaced, where the click merely opened Edge in a
 * browser and nothing came back. Wrong in the other and ordinary links (the docs, the
 * licence buy page) get swallowed into a login window.
 */

/**
 * `oauth-window` imports `electron` at module scope, and CI installs with
 * `--ignore-scripts` — so Electron's postinstall never runs, the binary path
 * file is absent, and `require('electron')` throws before a single test can
 * start. Stubbing what the module reaches for keeps the matcher testable
 * without a real Electron. Same shape as `utils/__tests__/path-picker.test.ts`.
 */
jest.mock('electron', () => ({
  BrowserWindow: class {},
  session: { fromPartition: () => ({}) },
}))

import { edgeOAuthProviderFromUrl } from '../oauth-window'

describe('edgeOAuthProviderFromUrl', () => {
  it.each([
    ['https://api.autonomylogic.com/auth/google?state=editor', 'google'],
    ['https://api.autonomylogic.com/auth/microsoft', 'microsoft'],
    ['https://api.autonomylogic.com/auth/apple', 'apple'],
  ])('recognises %s', (url, expected) => {
    expect(edgeOAuthProviderFromUrl(url)).toBe(expected)
  })

  it('matches on path regardless of origin', () => {
    // Load-bearing: the shared dialog builds its links from the Edge WEB origin, because
    // that is the only Edge URL a renderer bundle knows, while the real endpoint is on
    // the API origin that only the main process is configured with. Matching on origin
    // would force the two to agree about something only one of them can know.
    expect(edgeOAuthProviderFromUrl('https://edge.autonomylogic.com/auth/google?state=x')).toBe('google')
    expect(edgeOAuthProviderFromUrl('http://localhost:5173/auth/apple')).toBe('apple')
  })

  it('tolerates a trailing slash', () => {
    expect(edgeOAuthProviderFromUrl('https://api.autonomylogic.com/auth/google/')).toBe('google')
  })

  it.each([
    // Edge's own sign-in page, not a provider endpoint.
    'https://edge.autonomylogic.com/signin',
    // A provider name in the wrong position.
    'https://edge.autonomylogic.com/projects/auth/google/extra',
    // These must keep going to the system browser.
    'https://autonomylogic.com/docs',
    'https://edge.autonomylogic.com/buy',
    // A provider Edge does not offer must not be intercepted on the strength of the
    // prefix.
    'https://api.autonomylogic.com/auth/facebook',
    // Casing is not normalised: the value would go into a route path verbatim.
    'https://api.autonomylogic.com/auth/Google',
    'not a url',
    '',
  ])('leaves %s to the system browser', (url) => {
    expect(edgeOAuthProviderFromUrl(url)).toBeNull()
  })
})
