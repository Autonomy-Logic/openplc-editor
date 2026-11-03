import { frameConsoleNotice } from './console-notice'

/** Shown when a licensable device holds no license: in the license dialogs and, after each upload, on the console. */
export const DEMO_MODE_NOTICE =
  'This device requires a license and no license was found. The application will run in DEMO mode.'

/** The demo-mode notice framed for the console, one entry per line, each no wider than the rules. */
export function demoModeConsoleLines(): string[] {
  return frameConsoleNotice(DEMO_MODE_NOTICE)
}
