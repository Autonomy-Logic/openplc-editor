/**
 * OpenPLC HMI browser client: signs in with the runtime's accounts, keeps the token renewed and runs the project's
 * screens in this page with hmi.wasm (the HMI unit, core and fonts), drawing them locally. The device serves PLC
 * values over the /api/hmi Socket.IO namespace for the screen shown and applies or refuses its writes. Signing out is
 * a button of the project's screens (HMI_SignOut), so the client draws nothing over them; notices dim the last frame.
 *
 * The pure part (HmiClientLogic) is also loaded by the editor's unit tests; the page part starts only in a browser.
 */
;(function (root) {
  'use strict'

  var TOKEN_KEY = 'openplc-hmi-token'
  /** Renew this long before the token expires. */
  var RENEW_AHEAD_MS = 3 * 60 * 1000
  /** Never renew sooner than this after scheduling. */
  var RENEW_MIN_DELAY_MS = 10 * 1000
  /** Retry a renewal that could not reach the device. */
  var RENEW_RETRY_MS = 30 * 1000
  /** Ask again after the device was busy, or start the screens again after a screen fault. */
  var REOPEN_DELAY_MS = 5 * 1000
  /** First wait before asking again after the device refused the connection; it doubles up to the maximum. */
  var RECONNECT_DELAY_MS = 2 * 1000
  var RECONNECT_DELAY_MAX_MS = 60 * 1000
  /** How long a newly shown screen waits for its first values before it is drawn anyway. */
  var FIRST_VALUES_WAIT_MS = 1000
  var MAX_SEQUENCE = 9007199254740991

  var NOTICES = {
    stopped: 'PLC stopped',
    out_of_date: 'HMI out of date, rebuild the project',
    busy: 'Device busy, try later',
    fault: 'The screen stopped on an error; restarting',
    unavailable: 'No HMI installed',
    offline: 'Device unreachable, reconnecting',
    unsupported: 'This browser cannot run the HMI',
  }

  /** The payload of a JWT, or null when it is not one. */
  function tokenPayload(token) {
    if (typeof token !== 'string') return null
    var parts = token.split('.')
    if (parts.length !== 3) return null
    try {
      var text = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      while (text.length % 4 !== 0) text += '='
      var payload = JSON.parse(root.atob(text))
      return payload && typeof payload === 'object' ? payload : null
    } catch (e) {
      return null
    }
  }

  /** When the token expires, in ms since the epoch; 0 when it carries no expiry. */
  function tokenExpiryMs(token) {
    var payload = tokenPayload(token)
    return payload && typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  }

  /** Whether the token can still be presented at nowMs. */
  function tokenUsable(token, nowMs) {
    return tokenExpiryMs(token) > nowMs
  }

  /** Milliseconds from nowMs until the token should be renewed. */
  function renewDelayMs(token, nowMs) {
    var expiry = tokenExpiryMs(token)
    return Math.max(RENEW_MIN_DELAY_MS, expiry - RENEW_AHEAD_MS - nowMs)
  }

  /** The notice for a viewer state, or null when the screens show. */
  function noticeFor(state) {
    return Object.prototype.hasOwnProperty.call(NOTICES, state) ? NOTICES[state] : null
  }

  /** The sign-in form's message for a failed sign-in. */
  function signInMessage(status, retryAfter) {
    if (status === 401 || status === 400) return 'Wrong user name or password.'
    if (status === 429) {
      var seconds = parseInt(retryAfter, 10)
      return seconds > 0
        ? 'Too many attempts. Try again in ' + seconds + ' seconds.'
        : 'Too many attempts. Try again later.'
    }
    if (status === 0) return 'Device unreachable.'
    return 'Could not sign in (' + status + ').'
  }

  /** The code point a key event gives the screens, or 0 when the key is not passed on. */
  function keyCode(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return 0
    if (event.key === 'Enter') return 13
    if (event.key === 'Backspace') return 8
    if (event.key === 'Escape') return 27
    if (event.key === 'Tab') return 9
    if (typeof event.key === 'string' && [...event.key].length === 1) return event.key.codePointAt(0) || 0
    return 0
  }

  /** Numbers the events of one socket from 0, as the runtime orders them. */
  function createSequencer() {
    var next = 0
    return {
      next: function () {
        var n = next
        next = next >= MAX_SEQUENCE ? 0 : next + 1
        return n
      },
      reset: function () {
        next = 0
      },
    }
  }

  /** The `in` event that opens the viewer on the device. */
  function openEvent(n) {
    return { t: 'o', n: n }
  }

  /** The `in` event that asks for the values of screen `page`. */
  function showEvent(page, n) {
    return { t: 's', p: page, n: n }
  }

  /** The `in` event of a screen's write of tag `tag`; `value` is its bytes as the runtime takes them. */
  function writeEvent(tag, value, n) {
    return { t: 'w', g: tag, v: value, n: n }
  }

  /** The `in` event of a screen's assignment of one bit of tag `tag`: bit index and value 0 or 1. */
  function bitEvent(tag, bit, value, n) {
    return { t: 'b', g: tag, b: bit, v: value ? 1 : 0, n: n }
  }

  /**
   * Splits the write records hmi.wasm queued (`u16 page, u16 tag, u8 kind, u8 bit, u16 len, bytes`, little endian) into
   * { page, tag, kind, bit, value } in order, each value a copy: page is the screen shown when the write was made
   * (65535 none), kind 0 a whole value and 1 one bit. Null when the records are cut short.
   */
  function parseWrites(bytes) {
    var out = []
    var off = 0
    while (off < bytes.length) {
      if (bytes.length - off < 8) return null
      var len = bytes[off + 6] | (bytes[off + 7] << 8)
      if (bytes.length - off - 8 < len) return null
      out.push({
        page: bytes[off] | (bytes[off + 1] << 8),
        tag: bytes[off + 2] | (bytes[off + 3] << 8),
        kind: bytes[off + 4],
        bit: bytes[off + 5],
        value: bytes.slice(off + 8, off + 8 + len),
      })
      off += 8 + len
    }
    return out
  }

  /** CSS pixels to the screens' Q4 logical units (1/16 of a CSS pixel), clamped. */
  function toQ4(v) {
    var q = Math.round(v * 16)
    return Math.max(-16777216, Math.min(16777216, q))
  }

  /** The role code of a `live` status (0 admin to 3 viewer), or -1 when it carries none. */
  function roleCode(status) {
    var role = status && status.role
    return typeof role === 'number' && role >= 0 && role <= 3 && Math.floor(role) === role ? role : -1
  }

  /** The bytes of a binary Socket.IO payload as a Uint8Array view. */
  function bytesOf(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return new Uint8Array(0)
  }

  var logic = {
    TOKEN_KEY: TOKEN_KEY,
    tokenExpiryMs: tokenExpiryMs,
    tokenUsable: tokenUsable,
    renewDelayMs: renewDelayMs,
    noticeFor: noticeFor,
    signInMessage: signInMessage,
    keyCode: keyCode,
    createSequencer: createSequencer,
    openEvent: openEvent,
    showEvent: showEvent,
    writeEvent: writeEvent,
    bitEvent: bitEvent,
    parseWrites: parseWrites,
    toQ4: toQ4,
    roleCode: roleCode,
    bytesOf: bytesOf,
    RENEW_RETRY_MS: RENEW_RETRY_MS,
    REOPEN_DELAY_MS: REOPEN_DELAY_MS,
    FIRST_VALUES_WAIT_MS: FIRST_VALUES_WAIT_MS,
  }
  root.HmiClientLogic = logic

  // ---- page ---------------------------------------------------------------------------------

  function readToken() {
    try {
      return root.localStorage.getItem(TOKEN_KEY)
    } catch (e) {
      return null
    }
  }

  function writeToken(token) {
    try {
      if (token) root.localStorage.setItem(TOKEN_KEY, token)
      else root.localStorage.removeItem(TOKEN_KEY)
    } catch (e) {
      /* storage refused: the token then lives only in this page */
    }
  }

  /** WASI imports answered as not supported: the module has no files, clock or environment. */
  function wasiStubs() {
    var handler = {
      get: function (_target, name) {
        return function () {
          if (name === 'proc_exit') throw new Error('hmi.wasm exited')
          return 52
        }
      },
    }
    return new Proxy({}, handler)
  }

  function start(doc) {
    var el = function (id) {
      return doc.getElementById(id)
    }
    var screen = el('screen')
    var canvas = el('surface')
    var context = canvas.getContext('2d')
    var form = el('sign-in')
    var message = el('sign-in-message')
    var notice = el('notice')
    var token = readToken()
    var renewTimer = 0
    var reopenTimer = 0
    var frameTimer = 0
    var socket = null
    var sequencer = createSequencer()
    var retryDelay = RECONNECT_DELAY_MS
    var t0 = Date.now()

    /** The compiled module once fetched, the running instance's exports and the role it runs as. */
    var compiled = null
    var compiling = null
    var hmi = null
    var role = -1
    var live = false
    var shownPage = -1
    var awaitingPage = -1
    var awaitingSince = 0
    var pressed = false
    var lastPoint = { x: 0, y: 0 }

    /** Shows a notice over the last frame, dimmed and not operable, or hides it when text is null. */
    function showNotice(text) {
      notice.textContent = text || ''
      notice.hidden = !text
      screen.classList.toggle('stale', !!text)
      if (text && pressed) release(null)
    }

    function stopFrames() {
      clearTimeout(frameTimer)
      frameTimer = 0
    }

    function showForm(text) {
      closeSocket()
      stopFrames()
      clearTimeout(renewTimer)
      live = false
      token = null
      writeToken(null)
      compiled = null
      compiling = null
      hmi = null
      screen.hidden = true
      showNotice(null)
      message.textContent = text || ''
      form.hidden = false
      el('username').focus()
    }

    function scheduleRenew(delay) {
      clearTimeout(renewTimer)
      renewTimer = setTimeout(renew, delay)
    }

    /**
     * Renews the token; resolves once the renewal settled, whatever its outcome. A reply for a token that was
     * replaced or dropped meanwhile (sign-out, a newer renewal) is ignored.
     */
    function renew() {
      var sent = token
      if (!sent) return Promise.resolve()
      if (!tokenUsable(sent, Date.now())) {
        showForm('Your session expired. Sign in again.')
        return Promise.resolve()
      }
      return fetch('/api/renew', { method: 'POST', headers: { Authorization: 'Bearer ' + sent } })
        .then(function (response) {
          if (token !== sent) return null
          if (response.status === 401 || response.status === 403) {
            showForm('Your session ended. Sign in again.')
            return null
          }
          if (!response.ok) throw new Error('renew ' + response.status)
          return response.json()
        })
        .then(function (body) {
          if (!body || token !== sent) return
          if (typeof body.access_token !== 'string') throw new Error('renew without a token')
          token = body.access_token
          writeToken(token)
          scheduleRenew(renewDelayMs(token, Date.now()))
        })
        .catch(function () {
          if (token === sent) scheduleRenew(RENEW_RETRY_MS)
        })
    }

    /**
     * Ends the session on the device, as a screen's Sign out button asks, and returns to the form. The form shows
     * whatever the logout answers: this browser has dropped the token already.
     */
    function signOut() {
      var sent = token
      showForm('Signed out.')
      if (!sent) return
      fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + sent } }).catch(function () {
        return null
      })
    }

    /** Asks the device about the session after a refused connection, waiting longer each time. */
    function scheduleSessionCheck() {
      clearTimeout(reopenTimer)
      reopenTimer = setTimeout(checkSession, retryDelay)
      retryDelay = Math.min(retryDelay * 2, RECONNECT_DELAY_MAX_MS)
    }

    function signedIn(newToken) {
      token = newToken
      writeToken(token)
      form.hidden = true
      message.textContent = ''
      screen.hidden = false
      scheduleRenew(renewDelayMs(token, Date.now()))
      openSocket()
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var button = form.querySelector('button')
      button.disabled = true
      message.textContent = ''
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: el('username').value, password: el('password').value }),
      })
        .then(function (response) {
          if (!response.ok) {
            message.textContent = signInMessage(response.status, response.headers.get('Retry-After'))
            return null
          }
          return response.json()
        })
        .then(function (body) {
          if (!body) return
          if (typeof body.access_token !== 'string') {
            message.textContent = signInMessage(500, null)
            return
          }
          el('password').value = ''
          signedIn(body.access_token)
        })
        .catch(function () {
          message.textContent = signInMessage(0, null)
        })
        .then(function () {
          button.disabled = false
        })
    })

    function send(event) {
      if (socket && socket.connected) socket.emit('in', event)
    }

    function sendOpen() {
      send(openEvent(sequencer.next()))
    }

    function closeSocket() {
      clearTimeout(reopenTimer)
      if (socket) {
        socket.off()
        socket.disconnect()
        socket = null
      }
    }

    /** Stops the screens until the device is live again; the last frame stays, dimmed. */
    function pause(state) {
      live = false
      stopFrames()
      showNotice(noticeFor(state))
    }

    function openSocket() {
      closeSocket()
      pause('offline')
      socket = root.io('/api/hmi', {
        auth: function (callback) {
          callback({ token: token })
        },
        reconnectionDelayMax: 5000,
      })
      socket.on('connect', function () {
        retryDelay = RECONNECT_DELAY_MS
        sequencer.reset()
        sendOpen()
      })
      socket.on('connect_error', function () {
        if (!token || !tokenUsable(token, Date.now())) {
          showForm('Your session expired. Sign in again.')
          return
        }
        pause('offline')
        if (socket && !socket.active) scheduleSessionCheck()
      })
      socket.on('disconnect', function (reason) {
        pause('offline')
        if (reason === 'io server disconnect') checkSession()
      })
      socket.on('hmi_status', function (status) {
        var state = status && status.state
        clearTimeout(reopenTimer)
        if (state === 'live') {
          becomeLive(roleCode(status))
          return
        }
        pause(state)
        if (state === 'busy') reopenTimer = setTimeout(sendOpen, REOPEN_DELAY_MS)
      })
      socket.on('hmi_values', function (bytes, ack) {
        applyValues(bytesOf(bytes))
        if (typeof ack === 'function') ack()
      })
      socket.on('hmi_refused', function (refused) {
        if (root.console) root.console.warn('HMI: the device refused', refused)
      })
    }

    /** Shows the form when the device has ended the session; connects again otherwise. */
    function checkSession() {
      fetch('/api/whoami', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (response) {
          if (response.status === 401 || response.status === 403) showForm('Your session ended. Sign in again.')
          else openSocket()
        })
        .catch(function () {
          openSocket()
        })
    }

    /**
     * The compiled hmi.wasm, fetched once per session with the token: the device serves the project's screens only
     * to a signed-in account. Rejects with an error whose `refused` is true when the device refuses the token.
     */
    function hmiModule() {
      if (compiled) return Promise.resolve(compiled)
      if (!compiling) {
        var sent = token
        compiling = fetch('hmi.wasm', { headers: { Authorization: 'Bearer ' + sent }, cache: 'no-store' })
          .then(function (response) {
            if (response.status === 401 || response.status === 403) {
              var refused = new Error('hmi.wasm refused')
              refused.refused = true
              throw refused
            }
            if (!response.ok) throw new Error('hmi.wasm ' + response.status)
            return response.arrayBuffer()
          })
          .then(function (bytes) {
            return WebAssembly.compile(bytes)
          })
          .then(function (m) {
            if (token === sent) compiled = m
            return m
          })
        compiling.catch(function () {
          compiling = null
        })
      }
      return compiling
    }

    /** Starts the screens for a role in a new instance; resolves false when the browser cannot run them. */
    function startScreens(newRole) {
      hmi = null
      return hmiModule()
        .then(function (m) {
          return WebAssembly.instantiate(m, { wasi_snapshot_preview1: wasiStubs() })
        })
        .then(function (instance) {
          var x = instance.exports
          if (typeof x._initialize === 'function') x._initialize()
          if (x.hmi_bh_init(viewWidth(), viewHeight(), newRole) !== 0) throw new Error('hmi.wasm out of memory')
          hmi = x
          role = newRole
          return true
        })
        .catch(function (error) {
          if (error && error.refused) showForm('Your session ended. Sign in again.')
          else showNotice(NOTICES.unsupported)
          return false
        })
    }

    /** The device opened the viewer: the screens run with its role, and the shown screen asks for its values. */
    function becomeLive(newRole) {
      if (newRole < 0) return
      var ready = hmi && role === newRole ? Promise.resolve(true) : startScreens(newRole)
      ready.then(function (ok) {
        if (!ok || !socket || !hmi) return
        hmi.hmi_bh_reset_writes()
        hmi.hmi_bh_out_clear()
        fitCanvas()
        shownPage = -1
        live = true
        showNotice(null)
        stopFrames()
        frame()
      })
    }

    function applyValues(bytes) {
      if (!hmi || bytes.length === 0) return
      var target = hmi.hmi_bh_in(bytes.length)
      if (!target) return
      new Uint8Array(hmi.memory.buffer, target, bytes.length).set(bytes)
      var page = hmi.hmi_bh_values(bytes.length)
      if (page >= 0 && page === awaitingPage) awaitingPage = -1
    }

    /** A screen fault traps the module: the screens start again after a pause, as the same role. */
    function fault() {
      hmi = null
      pause('fault')
      reopenTimer = setTimeout(sendOpen, REOPEN_DELAY_MS)
    }

    /** Asks the device for the values of a newly shown screen; its writes are checked against it from then on. */
    function show(page, now) {
      shownPage = page
      awaitingPage = page
      awaitingSince = now
      send(showEvent(page, sequencer.next()))
    }

    /**
     * Sends the frame's writes in the order screen code made them, each after a show of the screen it was made on:
     * the old screen's writes (its OnHide included) go before the new screen's show, the new screen's (its OnShow and
     * first frame included) after it.
     */
    function sendWrites(now) {
      var len = hmi.hmi_bh_out_len()
      if (len === 0) return
      var writes = parseWrites(new Uint8Array(hmi.memory.buffer, hmi.hmi_bh_out(), len))
      hmi.hmi_bh_out_clear()
      if (!writes) return
      for (var i = 0; i < writes.length; i++) {
        var w = writes[i]
        if (w.page !== 65535 && w.page !== shownPage) show(w.page, now)
        if (w.kind === 1) send(bitEvent(w.tag, w.bit, w.value[0], sequencer.next()))
        else send(writeEvent(w.tag, w.value, sequencer.next()))
      }
    }

    function frame() {
      frameTimer = 0
      if (!live || !hmi) return
      var started = Date.now()
      try {
        hmi.hmi_bh_frame((started - t0) >>> 0)
      } catch (e) {
        fault()
        return
      }
      sendWrites(started)
      if (hmi.hmi_bh_sign_out()) {
        signOut()
        return
      }
      var page = hmi.hmi_bh_page()
      if (page >= 0 && page !== shownPage) show(page, started)
      if (awaitingPage < 0 || started - awaitingSince >= FIRST_VALUES_WAIT_MS) draw()
      var period = Math.max(10, hmi.hmi_bh_frame_ms())
      frameTimer = setTimeout(frame, Math.max(0, period - (Date.now() - started)))
    }

    function viewWidth() {
      return Math.min(8192, Math.max(1, Math.round(root.innerWidth)))
    }

    function viewHeight() {
      return Math.min(8192, Math.max(1, Math.round(root.innerHeight)))
    }

    /** Sizes the canvas to the window before anything is drawn, so no press falls outside it. */
    function fitCanvas() {
      canvas.style.width = viewWidth() + 'px'
      canvas.style.height = viewHeight() + 'px'
    }

    function draw() {
      var ratio = Math.min(8, Math.max(0.25, root.devicePixelRatio || 1))
      var w = viewWidth()
      var h = viewHeight()
      var pw = Math.round(w * ratio)
      var ph = Math.round(h * ratio)
      var pixels = hmi.hmi_bh_render(pw, ph, Math.round(ratio * 256))
      if (!pixels) return
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
        canvas.style.width = w + 'px'
        canvas.style.height = h + 'px'
      }
      var y0 = hmi.hmi_bh_dirty_y0()
      var rows = hmi.hmi_bh_dirty_rows()
      if (rows <= 0) return
      var rgba = new Uint8ClampedArray(hmi.memory.buffer, pixels + y0 * pw * 4, pw * rows * 4)
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba), pw, rows), 0, y0)
    }

    function canvasPoint(event) {
      var rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    function pointer(kind, p) {
      if (live && hmi) hmi.hmi_bh_pointer(kind, toQ4(p.x), toQ4(p.y))
    }

    canvas.addEventListener('pointerdown', function (event) {
      pressed = true
      canvas.setPointerCapture(event.pointerId)
      canvas.focus()
      lastPoint = canvasPoint(event)
      pointer(0, lastPoint)
    })
    canvas.addEventListener('pointermove', function (event) {
      if (!pressed) return
      lastPoint = canvasPoint(event)
      pointer(1, lastPoint)
    })
    /** Ends a press at the event's point, or at the last point known when a notice takes the screen away. */
    function release(event) {
      if (!pressed) return
      pressed = false
      pointer(2, event ? canvasPoint(event) : lastPoint)
    }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('keydown', function (event) {
      if (!notice.hidden || !hmi) return
      var c = keyCode(event)
      if (!c) return
      event.preventDefault()
      hmi.hmi_bh_key(c)
    })

    root.addEventListener('resize', function () {
      fitCanvas()
      if (hmi) hmi.hmi_bh_resize(viewWidth(), viewHeight())
    })

    if (token && tokenUsable(token, Date.now())) {
      form.hidden = true
      screen.hidden = false
      showNotice(NOTICES.offline)
      renew().then(function () {
        if (token) openSocket()
      })
    } else {
      showForm(null)
    }
  }

  if (typeof document !== 'undefined' && root.document === document && typeof root.io === 'function') {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', function () {
        start(document)
      })
    else start(document)
  }
})(typeof window !== 'undefined' ? window : globalThis)
