/**
 * Waiting on the app without waiting on a dead app. Every wait for a build, a Play or a Console line also reads what
 * the app itself shows (the Console, the startup error page) and fails at once, quoting it, when the app reports a
 * failure. A spec that only polls for success sits on its full timeout after the build has already failed.
 *
 * Identical in openplc-editor and openplc-web.
 */
import { expect, type Page } from '@playwright/test'

/** What the Console or the startup error page says when a build, a start or a load failed. */
export const APP_FAILURE =
  /compilation failed|build failed|Failed to start simulator|could not be loaded|could not start|Something went wrong/i

/** The text the page shows, the Console included while its tab is the one open. */
export const pageText = (page: Page): Promise<string> => page.locator('body').innerText()

/** Throws with the page's last lines when it shows a failure matching `failure`. */
export async function failIfAppReportedFailure(page: Page, failure: RegExp = APP_FAILURE): Promise<void> {
  const text = await pageText(page)
  if (failure.test(text)) {
    throw new Error(`The app reported a failure:\n${text.split('\n').slice(-30).join('\n')}`)
  }
}

export interface WaitForAppOptions {
  timeout?: number
  /** What counts as a failure; defaults to `APP_FAILURE`. */
  failure?: RegExp
  /** Shown when the wait times out. */
  message?: string
}

/**
 * Polls `condition` until it holds, failing at once if the app reports a failure first. Keep timeouts in tens of
 * seconds: most specs finish in under 3 minutes.
 */
export async function waitForApp(
  page: Page,
  condition: () => Promise<boolean>,
  { timeout = 60000, failure = APP_FAILURE, message }: WaitForAppOptions = {},
): Promise<void> {
  await expect
    .poll(
      async () => {
        if (await condition().catch(() => false)) return true
        await failIfAppReportedFailure(page, failure)
        return false
      },
      { timeout, message },
    )
    .toBe(true)
}

/** Waits until the page shows `pattern`, failing at once if the app reports a failure first. */
export function waitForText(page: Page, pattern: RegExp, options: WaitForAppOptions = {}): Promise<void> {
  return waitForApp(page, async () => pattern.test(await pageText(page)), {
    message: `the page never showed ${pattern}`,
    ...options,
  })
}
