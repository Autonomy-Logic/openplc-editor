/**
 * Provider sign-in runs in the user's default browser, where their provider accounts
 * already live, and comes back over the loopback interface (RFC 8252 §7.3): this
 * process listens on 127.0.0.1, sends that address to the Edge API as the flow's
 * `state`, and the API redirects the browser there with the token pair once the
 * provider is done. Nothing here renders a page of its own, so no user agent is
 * spoofed and no third-party navigation has to be fenced.
 */

import { randomBytes } from 'crypto'
import { shell } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'

import type { EdgeOAuthProviderId } from '../../../middleware/shared/ports/edge-account-port'
import { assertTransportIsConfidential, getEdgeApiBaseUrl } from './edge-http'

/** Long enough for a password, an account picker and a two-factor prompt. */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000

/**
 * How long the listener stays up after the outcome is known. The callback answers with
 * a redirect to the page that says what happened, and closing on the callback itself
 * would show the browser a connection error instead.
 */
const LINGER_MS = 5_000

export type OAuthFlowResult =
  | { status: 'tokens'; accessToken: string; refreshToken: string }
  | { status: 'cancelled' }
  | { status: 'failed'; reason?: string }

const PROVIDER_IDS: readonly EdgeOAuthProviderId[] = ['google', 'microsoft', 'apple']

/** Where the API sends the browser back to. */
export const CALLBACK_PATH = '/callback'

/** Where the callback redirects the browser once the tokens are out of the address bar. */
export const DONE_PATH = '/done'

/**
 * Matches by path only, not origin: the renderer knows only the Edge WEB origin, while
 * the real endpoint lives on the API origin (a main-process env var).
 */
export function edgeOAuthProviderFromUrl(url: string): EdgeOAuthProviderId | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')

    return PROVIDER_IDS.find((provider) => path === `/auth/${provider}`) ?? null
  } catch {
    return null
  }
}

/**
 * The address this flow asks the API to come back to. `attempt` is a per-flow secret:
 * the API echoes it back inside the URL, and a callback without it is not this flow's.
 * The IP literal, not `localhost`, so a hosts-file entry cannot point it elsewhere.
 */
export function loopbackReturnUrl(port: number, attempt: string): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}?attempt=${attempt}`
}

/**
 * `state` carries the return address, which is the API's contract for every app that
 * starts a provider flow. It is checked on return there: the API honours it only when
 * it points at the loopback interface or at the web editor's own origin.
 */
export function providerStartUrl(provider: EdgeOAuthProviderId, returnUrl: string): string {
  const url = new URL(`${getEdgeApiBaseUrl()}/auth/${provider}`)

  // The callback issues session tokens on this origin; over cleartext to a remote host
  // they would be readable on the path, exactly like a password.
  assertTransportIsConfidential(url)
  url.searchParams.set('state', returnUrl)

  return url.toString()
}

export type CallbackRead =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  /** The API reported the provider flow failed. */
  | { kind: 'declined' }
  /** This flow's callback, but without a usable token pair. */
  | { kind: 'malformed' }
  /** Another path, or another attempt's secret: not this flow's callback at all. */
  | { kind: 'foreign' }

/** What a request to the listener means for the flow that owns `attempt`. */
export function readCallback(requestUrl: string, attempt: string): CallbackRead {
  let url: URL

  try {
    url = new URL(requestUrl, 'http://127.0.0.1')
  } catch {
    return { kind: 'foreign' }
  }

  if (url.pathname !== CALLBACK_PATH || url.searchParams.get('attempt') !== attempt) {
    return { kind: 'foreign' }
  }

  if (url.searchParams.has('error')) {
    return { kind: 'declined' }
  }

  const accessToken = url.searchParams.get('access_token')
  const refreshToken = url.searchParams.get('refresh_token')

  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken }
  }

  return { kind: 'malformed' }
}

type PageOutcome = 'ok' | 'failed'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Self-contained: the CSP below forbids every external resource, so nothing here may need one. */
/**
 * The Autonomy `<>` mark, path for path the one the sign-in dialog shows (see
 * `frontend/components/_atoms/autonomy-logo`), so the tab reads as the same product the
 * user just left. Inline: the CSP forbids fetching it.
 */
const AUTONOMY_MARK =
  '<svg viewBox="0 0 124 86" width="62" height="43" aria-hidden="true"><path fill="currentColor" ' +
  'd="M41.892 0 0 43l41.892 43 9.216-9.653-25.56-25.985c-1.877-1.907-4.389-2.974-7.003-2.974H11.73v-8.776h6.815' +
  'c2.614 0 5.126-1.067 7.002-2.974L51.108 9.653zM82.108 0 124 43 82.108 86l-9.216-9.653 25.56-25.985c1.877-1.907 ' +
  '4.389-2.974 7.003-2.974h6.815v-8.776h-6.815c-2.614 0-5.126-1.067-7.002-2.974L72.892 9.653z"/></svg>'

export function renderDonePage(outcome: PageOutcome): string {
  const ok = outcome === 'ok'
  const title = ok ? 'You are signed in' : 'That sign-in did not finish'
  const body = ok
    ? 'Your Autonomy Edge account is now connected to OpenPLC Editor. You can close this tab and go back to the editor.'
    : 'Go back to OpenPLC Editor and try again, or sign in there with your email and password.'
  const eyebrow = ok ? 'Signed in' : 'Not signed in'

  // Brand blue and its dark shade are the editor's `--primary-default` / `--primary-dark`;
  // the two status colours are the editor's own green and amber.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} - OpenPLC Editor</title>
<style>
  :root {
    --brand: #0464fb;
    --brand-dark: #011e4b;
    --ok: #16a34a;
    --warn: #d97706;
    --bg: #eef3fb;
    --card: #ffffff;
    --border: #dbe4f3;
    --text: #0b1220;
    --muted: #5b6b85;
    --shadow: 0 24px 60px rgba(1, 30, 75, 0.12), 0 2px 6px rgba(1, 30, 75, 0.06);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #070b14;
      --card: #0e1626;
      --border: #1e2a40;
      --text: #f2f5fa;
      --muted: #97a4bb;
      --shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4);
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center; padding: 24px;
    background: var(--bg);
    background-image:
      radial-gradient(60rem 30rem at 50% -10rem, rgba(4, 100, 251, 0.16), transparent 70%),
      radial-gradient(40rem 24rem at 100% 100%, rgba(4, 100, 251, 0.08), transparent 70%);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    width: 100%; max-width: 26rem; padding: 40px 36px 32px; text-align: center;
    background: var(--card); border: 1px solid var(--border); border-radius: 20px; box-shadow: var(--shadow);
  }
  .logo { color: var(--brand); display: flex; justify-content: center; margin-bottom: 24px; }
  .eyebrow {
    display: inline-block; margin-bottom: 10px; padding: 4px 12px; border-radius: 9999px;
    font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--status); background: color-mix(in srgb, var(--status) 12%, transparent);
  }
  h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 10px; }
  p { font-size: 0.95rem; line-height: 1.55; color: var(--muted); margin: 0; }
  footer {
    margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border);
    font-size: 12px; color: var(--muted); letter-spacing: 0.02em;
  }
  footer strong { color: var(--text); font-weight: 600; }
</style>
</head>
<body>
<main style="--status: ${ok ? 'var(--ok)' : 'var(--warn)'}">
  <div class="logo">${AUTONOMY_MARK}</div>
  <span class="eyebrow">${eyebrow}</span>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
  <footer><strong>OpenPLC Editor</strong> &middot; Autonomy Edge</footer>
</main>
</body>
</html>
`
}

/** Every answer the listener gives; nothing it serves may be cached, framed, or carry a referrer. */
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Connection: 'close',
} as const

function respond(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    ...RESPONSE_HEADERS,
    ...extra,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function pageOutcomeOf(requestUrl: string): PageOutcome | null {
  try {
    const url = new URL(requestUrl, 'http://127.0.0.1')

    if (url.pathname !== DONE_PATH) {
      return null
    }

    return url.searchParams.get('outcome') === 'ok' ? 'ok' : 'failed'
  } catch {
    return null
  }
}

interface RunOptions {
  /** Test seam; the default is the real flow's budget. */
  timeoutMs?: number
}

let activeFlow: { cancel: () => void } | null = null

/**
 * Never rejects: resolves once the browser comes back with the tokens, when the API
 * reports the provider declined, on timeout, or when a newer flow replaces this one.
 * One flow at a time: a second provider click starts over rather than leaving two
 * listeners waiting.
 */
export function runOAuthFlow(provider: EdgeOAuthProviderId, options: RunOptions = {}): Promise<OAuthFlowResult> {
  activeFlow?.cancel()

  return new Promise((resolve) => {
    const attempt = randomBytes(16).toString('hex')
    const server = createServer(handleRequest)

    let settled = false
    let lingerTimer: NodeJS.Timeout | undefined

    const close = () => {
      clearTimeout(lingerTimer)
      server.close()
      // `close` alone waits for open keep-alive sockets, which a browser holds for a while.
      server.closeAllConnections()
    }

    const finish = (result: OAuthFlowResult, { linger }: { linger: boolean }) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)

      if (activeFlow === flow) {
        activeFlow = null
      }

      if (linger) {
        lingerTimer = setTimeout(close, LINGER_MS)
      } else {
        close()
      }

      resolve(result)
    }

    const flow = {
      cancel: () => {
        finish({ status: 'cancelled' }, { linger: false })
      },
    }

    activeFlow = flow

    const timer = setTimeout(() => {
      finish({ status: 'failed', reason: 'timed-out' }, { linger: false })
    }, options.timeoutMs ?? FLOW_TIMEOUT_MS)

    function handleRequest(req: IncomingMessage, res: ServerResponse): void {
      const requestUrl = req.url ?? '/'
      const pageOutcome = pageOutcomeOf(requestUrl)

      if (pageOutcome) {
        respond(res, 200, renderDonePage(pageOutcome))

        // The page was the only reason to stay up.
        if (settled) {
          close()
        }

        return
      }

      const read = settled ? { kind: 'foreign' as const } : readCallback(requestUrl, attempt)

      if (read.kind === 'foreign') {
        respond(res, 404, renderDonePage('failed'))

        return
      }

      // A redirect, not the page itself, so the address bar and history keep the
      // token-free `/done` and not the URL the tokens arrived on.
      const outcome: PageOutcome = read.kind === 'tokens' ? 'ok' : 'failed'
      respond(res, 303, '', { Location: `${DONE_PATH}?outcome=${outcome}` })

      switch (read.kind) {
        case 'tokens':
          finish({ status: 'tokens', accessToken: read.accessToken, refreshToken: read.refreshToken }, { linger: true })

          return
        case 'declined':
          finish({ status: 'failed', reason: 'provider-declined' }, { linger: true })

          return
        case 'malformed':
          finish({ status: 'failed', reason: 'malformed-callback' }, { linger: true })

          return
        default: {
          const exhaustive: never = read

          return exhaustive
        }
      }
    }

    server.once('error', () => {
      finish({ status: 'failed', reason: 'loopback-unavailable' }, { linger: false })
    })

    // Port 0: the OS picks a free one, so two editors, or an editor and anything else,
    // never fight over a fixed number.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        finish({ status: 'failed', reason: 'loopback-unavailable' }, { linger: false })

        return
      }

      let startUrl: string

      try {
        startUrl = providerStartUrl(provider, loopbackReturnUrl(address.port, attempt))
      } catch (error) {
        finish(
          { status: 'failed', reason: error instanceof Error ? error.message : 'invalid-api-url' },
          { linger: false },
        )

        return
      }

      shell.openExternal(startUrl).catch(() => {
        finish({ status: 'failed', reason: 'could-not-open-browser' }, { linger: false })
      })
    })
  })
}
