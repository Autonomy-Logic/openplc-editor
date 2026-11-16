import { DEMO_MODE_NOTICE, demoModeConsoleLines } from '../demo-mode-notice'

describe('demoModeConsoleLines', () => {
  it('frames the notice between two 72-column rules of asterisks', () => {
    const lines = demoModeConsoleLines()

    expect(lines[0]).toBe('*'.repeat(72))
    expect(lines[lines.length - 1]).toBe('*'.repeat(72))
  })

  it('wraps the notice without losing or reordering a word, each line within the rules', () => {
    const body = demoModeConsoleLines().slice(1, -1)

    expect(body.join(' ')).toBe(DEMO_MODE_NOTICE)
    for (const line of body) expect(line.length).toBeLessThanOrEqual(72)
    expect(body).toEqual([
      'This device requires a license and no license was found. The application',
      'will run in DEMO mode.',
    ])
  })
})
