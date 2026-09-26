/**
 * macOS quit vs window close, decided in main: a quit is held and prompted on
 * screen, the red button only hides, and nothing carries over between attempts.
 */
import { createQuitCoordinator, type QuitCoordinator, type QuitWindow } from '../quit-coordinator'

const QUIT_PROMPT_CHANNEL = 'app:quit-requested'

type FakeWindow = { [K in keyof Omit<QuitWindow, 'webContents'>]: jest.Mock } & {
  webContents: { send: jest.Mock }
  visible: boolean
  minimized: boolean
  destroyed: boolean
}

function createWindow(): FakeWindow {
  const win = {
    visible: true,
    minimized: false,
    destroyed: false,
  } as FakeWindow

  win.isDestroyed = jest.fn(() => win.destroyed)
  win.isVisible = jest.fn(() => win.visible)
  win.isMinimized = jest.fn(() => win.minimized)
  win.show = jest.fn(() => {
    win.visible = true
  })
  win.restore = jest.fn(() => {
    win.minimized = false
    win.visible = true
  })
  win.focus = jest.fn()
  win.hide = jest.fn(() => {
    win.visible = false
  })
  win.destroy = jest.fn(() => {
    win.destroyed = true
    win.visible = false
  })
  win.webContents = { send: jest.fn() }
  return win
}

function createEvent() {
  return { preventDefault: jest.fn() }
}

let win: FakeWindow | null
let quitApp: jest.Mock
let stopSimulator: jest.Mock
let canPrompt: jest.Mock<boolean, [QuitWindow]>

function setup(platform: NodeJS.Platform): QuitCoordinator {
  win = createWindow()
  quitApp = jest.fn()
  stopSimulator = jest.fn()
  canPrompt = jest.fn((_window: QuitWindow) => true)
  return createQuitCoordinator({
    platform,
    getWindow: () => win,
    quitApp,
    stopSimulator,
    canPrompt,
  })
}

/** The window the current test created; fails loudly instead of a non-null assertion. */
function currentWindow(): FakeWindow {
  if (!win) throw new Error('no window in this test')
  return win
}

function promptsSent(): number {
  return currentWindow().webContents.send.mock.calls.filter(([channel]) => channel === QUIT_PROMPT_CHANNEL).length
}

describe('quit coordinator on macOS', () => {
  let coordinator: QuitCoordinator

  beforeEach(() => {
    coordinator = setup('darwin')
  })

  describe('a quit (Cmd+Q, app menu Quit, Dock Quit, logout)', () => {
    it('is held and asks the renderer for the prompt, exactly once per attempt', () => {
      const event = createEvent()

      coordinator.handleBeforeQuit(event)

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(promptsSent()).toBe(1)
      expect(quitApp).not.toHaveBeenCalled()
    })

    it('brings a hidden window forward before asking for the prompt', () => {
      const w = currentWindow()
      w.visible = false

      coordinator.handleBeforeQuit(createEvent())

      expect(w.show).toHaveBeenCalled()
      expect(w.focus).toHaveBeenCalled()
      expect(w.visible).toBe(true)
      const promptCall = w.webContents.send.mock.invocationCallOrder[0]
      expect(w.show.mock.invocationCallOrder[0]).toBeLessThan(promptCall)
    })

    it('restores a minimised window before asking for the prompt', () => {
      const w = currentWindow()
      w.minimized = true

      coordinator.handleBeforeQuit(createEvent())

      expect(w.restore).toHaveBeenCalled()
      expect(w.restore.mock.invocationCallOrder[0]).toBeLessThan(w.webContents.send.mock.invocationCallOrder[0])
    })

    it('focuses a window that is already on screen', () => {
      coordinator.handleBeforeQuit(createEvent())

      expect(currentWindow().focus).toHaveBeenCalled()
    })

    it('brings the window forward again when a second quit arrives while the prompt is open', () => {
      const w = currentWindow()
      coordinator.handleBeforeQuit(createEvent())
      w.visible = false

      const second = createEvent()
      coordinator.handleBeforeQuit(second)

      expect(second.preventDefault).toHaveBeenCalled()
      expect(w.visible).toBe(true)
      expect(quitApp).not.toHaveBeenCalled()
    })

    it('does not hide the window', () => {
      coordinator.handleBeforeQuit(createEvent())

      expect(currentWindow().hide).not.toHaveBeenCalled()
    })

    it('lets the app end, and stops the simulator, when there is no window to prompt in', () => {
      win = null
      const event = createEvent()

      coordinator.handleBeforeQuit(event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(stopSimulator).toHaveBeenCalled()
    })

    it('lets the app end, and stops the simulator, when the window is already destroyed', () => {
      currentWindow().destroyed = true
      const event = createEvent()

      coordinator.handleBeforeQuit(event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(stopSimulator).toHaveBeenCalled()
    })
  })

  describe('the red button (window close)', () => {
    it('hides the window and never asks for a prompt', () => {
      const event = createEvent()

      coordinator.handleWindowClose(event)

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(currentWindow().hide).toHaveBeenCalledTimes(1)
      expect(promptsSent()).toBe(0)
      expect(quitApp).not.toHaveBeenCalled()
      expect(currentWindow().destroy).not.toHaveBeenCalled()
    })

    it('hides on every click', () => {
      for (let i = 0; i < 3; i++) {
        currentWindow().visible = true
        const event = createEvent()
        coordinator.handleWindowClose(event)
        expect(event.preventDefault).toHaveBeenCalled()
      }

      expect(currentWindow().hide).toHaveBeenCalledTimes(3)
      expect(promptsSent()).toBe(0)
    })
  })

  describe('the start-screen Exit (request quit)', () => {
    it('asks for the prompt on screen, exactly like Cmd+Q', () => {
      const w = currentWindow()
      w.visible = false

      coordinator.requestQuit()

      expect(w.visible).toBe(true)
      expect(promptsSent()).toBe(1)
      expect(w.hide).not.toHaveBeenCalled()
    })

    it('does not end the app before the user confirms', () => {
      coordinator.requestQuit()

      expect(quitApp).not.toHaveBeenCalled()
      expect(currentWindow().destroy).not.toHaveBeenCalled()
    })

    it('prompts on every click', () => {
      coordinator.requestQuit()
      coordinator.requestQuit()

      expect(promptsSent()).toBe(2)
    })
  })

  describe('confirming the prompt', () => {
    it('ends the app in that same action', () => {
      coordinator.handleBeforeQuit(createEvent())

      coordinator.confirmQuit()

      expect(quitApp).toHaveBeenCalledTimes(1)
    })

    it('destroys the window so the renderer beforeunload cannot cancel the quit', () => {
      coordinator.confirmQuit()

      expect(currentWindow().destroy).toHaveBeenCalled()
      expect(currentWindow().destroy.mock.invocationCallOrder[0]).toBeLessThan(quitApp.mock.invocationCallOrder[0])
    })

    it('stops the simulator before the app ends', () => {
      coordinator.confirmQuit()

      expect(stopSimulator).toHaveBeenCalled()
      expect(stopSimulator.mock.invocationCallOrder[0]).toBeLessThan(quitApp.mock.invocationCallOrder[0])
    })

    it('lets the quit that follows through without a second prompt', () => {
      coordinator.confirmQuit()
      const promptsBefore = promptsSent()

      const followingQuit = createEvent()
      coordinator.handleBeforeQuit(followingQuit)

      expect(followingQuit.preventDefault).not.toHaveBeenCalled()
      expect(promptsSent()).toBe(promptsBefore)
    })

    it('lets the window close that follows through instead of hiding it', () => {
      coordinator.confirmQuit()
      const w = currentWindow()
      w.destroyed = false

      const close = createEvent()
      coordinator.handleWindowClose(close)

      expect(close.preventDefault).not.toHaveBeenCalled()
      expect(w.hide).not.toHaveBeenCalled()
    })
  })

  describe('a cancelled attempt leaves no state behind', () => {
    it('keeps the red button hiding after a cancelled quit', () => {
      coordinator.handleBeforeQuit(createEvent())
      // "No" in the prompt: the renderer sends nothing back.

      const close = createEvent()
      coordinator.handleWindowClose(close)

      expect(close.preventDefault).toHaveBeenCalled()
      expect(currentWindow().hide).toHaveBeenCalledTimes(1)
      expect(promptsSent()).toBe(1)
    })

    it('keeps Cmd+Q prompting after a cancelled quit', () => {
      coordinator.handleBeforeQuit(createEvent())

      const again = createEvent()
      coordinator.handleBeforeQuit(again)

      expect(again.preventDefault).toHaveBeenCalled()
      expect(promptsSent()).toBe(2)
      expect(quitApp).not.toHaveBeenCalled()
    })

    it('keeps Cmd+Q prompting after the red button', () => {
      coordinator.handleWindowClose(createEvent())

      const quit = createEvent()
      coordinator.handleBeforeQuit(quit)

      expect(quit.preventDefault).toHaveBeenCalled()
      expect(currentWindow().visible).toBe(true)
      expect(promptsSent()).toBe(1)
    })

    it('answers each action as on a fresh launch after any mix of cancelled attempts', () => {
      coordinator.handleBeforeQuit(createEvent())
      coordinator.requestQuit()
      coordinator.handleWindowClose(createEvent())
      coordinator.handleBeforeQuit(createEvent())
      coordinator.requestQuit()
      const w = currentWindow()
      w.visible = true
      w.hide.mockClear()
      w.webContents.send.mockClear()

      const close = createEvent()
      coordinator.handleWindowClose(close)
      expect(close.preventDefault).toHaveBeenCalledTimes(1)
      expect(w.hide).toHaveBeenCalledTimes(1)
      expect(promptsSent()).toBe(0)

      const quit = createEvent()
      coordinator.handleBeforeQuit(quit)
      expect(quit.preventDefault).toHaveBeenCalledTimes(1)
      expect(w.visible).toBe(true)
      expect(promptsSent()).toBe(1)

      expect(quitApp).not.toHaveBeenCalled()
    })
  })
})

/** A crashed renderer, or one still loading, cannot show the prompt; the quit must not be swallowed. */
describe('quit coordinator on macOS when the renderer cannot prompt', () => {
  let coordinator: QuitCoordinator

  beforeEach(() => {
    coordinator = setup('darwin')
    canPrompt.mockReturnValue(false)
  })

  it('asks canPrompt about the live window', () => {
    coordinator.handleBeforeQuit(createEvent())

    expect(canPrompt).toHaveBeenCalledWith(currentWindow())
  })

  it('lets the quit through instead of holding it', () => {
    const event = createEvent()

    coordinator.handleBeforeQuit(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(promptsSent()).toBe(0)
  })

  it('stops the simulator and destroys the window so nothing else can cancel the quit', () => {
    coordinator.handleBeforeQuit(createEvent())

    expect(stopSimulator).toHaveBeenCalled()
    expect(currentWindow().destroy).toHaveBeenCalled()
  })

  it('does not bring a hidden or still-loading window forward', () => {
    const w = currentWindow()
    w.visible = false

    coordinator.handleBeforeQuit(createEvent())

    expect(w.show).not.toHaveBeenCalled()
    expect(w.focus).not.toHaveBeenCalled()
  })

  it('prompts again once the renderer can, with nothing carried over', () => {
    const w = currentWindow()
    w.destroy.mockImplementation(() => undefined)
    coordinator.handleBeforeQuit(createEvent())
    canPrompt.mockReturnValue(true)

    const next = createEvent()
    coordinator.handleBeforeQuit(next)

    expect(next.preventDefault).toHaveBeenCalledTimes(1)
    expect(promptsSent()).toBe(1)
  })

  it('still hides on the red button', () => {
    const close = createEvent()

    coordinator.handleWindowClose(close)

    expect(close.preventDefault).toHaveBeenCalled()
    expect(currentWindow().hide).toHaveBeenCalled()
  })
})

describe('quit coordinator on Windows and Linux', () => {
  it.each(['win32', 'linux'] as const)('%s: before-quit does not depend on canPrompt', (platform) => {
    const coordinator = setup(platform)

    coordinator.handleBeforeQuit(createEvent())

    expect(canPrompt).not.toHaveBeenCalled()
  })

  it.each(['win32', 'linux'] as const)('%s: before-quit ends the app without a prompt, as today', (platform) => {
    const coordinator = setup(platform)
    const event = createEvent()

    coordinator.handleBeforeQuit(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(promptsSent()).toBe(0)
    expect(stopSimulator).toHaveBeenCalled()
  })

  it.each(['win32', 'linux'] as const)('%s: a window close is left to the renderer, not hidden by main', (platform) => {
    const coordinator = setup(platform)
    const event = createEvent()

    coordinator.handleWindowClose(event)

    expect(currentWindow().hide).not.toHaveBeenCalled()
    expect(promptsSent()).toBe(0)
  })

  it.each(['win32', 'linux'] as const)('%s: the start-screen Exit still prompts', (platform) => {
    const coordinator = setup(platform)

    coordinator.requestQuit()

    expect(promptsSent()).toBe(1)
    expect(quitApp).not.toHaveBeenCalled()
  })

  it.each(['win32', 'linux'] as const)('%s: confirming still stops the simulator and ends the app', (platform) => {
    const coordinator = setup(platform)

    coordinator.confirmQuit()

    expect(stopSimulator).toHaveBeenCalled()
    expect(quitApp).toHaveBeenCalledTimes(1)
  })
})
