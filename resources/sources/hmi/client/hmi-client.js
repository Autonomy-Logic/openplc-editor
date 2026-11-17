/**
 * OpenPLC HMI browser client: signs in with the runtime's accounts, keeps the token renewed, opens a viewer on the
 * /api/hmi Socket.IO namespace and draws the display lists it receives with hmi_client.wasm. Signing out is a button
 * of the project's screens (HMI_SignOut), so the client draws nothing over them; notices dim the last frame.
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
  /** Ask again after the device was busy or a screen faulted. */
  var REOPEN_DELAY_MS = 5 * 1000
  /** Connect again after the device refused the connection while the token is still valid. */
  var RECONNECT_DELAY_MS = 2 * 1000
  var MAX_SEQUENCE = 9007199254740991

  var NOTICES = {
    stopped: 'PLC stopped',
    out_of_date: 'HMI out of date, rebuild the project',
    busy: 'Device busy, try later',
    fault: 'The screen stopped on an error; reopening',
    unavailable: 'No HMI installed',
    offline: 'Device unreachable, reconnecting',
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

  /** The code point an `in` key event carries for a keyboard event, or 0 when the key is not sent. */
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

  /** The `in` event of a viewport of width x height CSS pixels at a device pixel ratio. */
  function viewportEvent(width, height, ratio, n) {
    var w = Math.min(8192, Math.max(1, Math.round(width)))
    var h = Math.min(8192, Math.max(1, Math.round(height)))
    var d = Math.min(8, Math.max(0.25, ratio || 1))
    return { t: 'v', w: w, h: h, d: d, n: n }
  }

  /** The `in` event of a pointer at CSS pixel (x, y); kind 0 down, 1 move, 2 up. */
  function pointerEvent(kind, x, y, n) {
    var clamp = function (v) {
      return Math.max(-100000, Math.min(100000, v))
    }
    return { t: 'p', k: kind, x: clamp(x), y: clamp(y), n: n }
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
    viewportEvent: viewportEvent,
    pointerEvent: pointerEvent,
    RENEW_RETRY_MS: RENEW_RETRY_MS,
    REOPEN_DELAY_MS: REOPEN_DELAY_MS,
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
    var socket = null
    var sequencer = createSequencer()
    var wasm = null
    var pressed = false
    var pendingMove = null

    /** Shows a notice over the last frame, dimmed and not operable, or hides it when text is null. */
    function showNotice(text) {
      notice.textContent = text || ''
      notice.hidden = !text
      screen.classList.toggle('stale', !!text)
    }

    function showForm(text) {
      closeSocket()
      clearTimeout(renewTimer)
      token = null
      writeToken(null)
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

    /** Renews the token; resolves once the renewal settled, whatever its outcome. */
    function renew() {
      if (!token) return Promise.resolve()
      if (!tokenUsable(token, Date.now())) {
        showForm('Your session expired. Sign in again.')
        return Promise.resolve()
      }
      return fetch('/api/renew', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })
        .then(function (response) {
          if (response.status === 401 || response.status === 403) {
            showForm('Your session ended. Sign in again.')
            return null
          }
          if (!response.ok) throw new Error('renew ' + response.status)
          return response.json()
        })
        .then(function (body) {
          if (!body) return
          if (typeof body.access_token !== 'string') throw new Error('renew without a token')
          token = body.access_token
          writeToken(token)
          scheduleRenew(renewDelayMs(token, Date.now()))
        })
        .catch(function () {
          scheduleRenew(RENEW_RETRY_MS)
        })
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

    function sendViewport() {
      send(viewportEvent(root.innerWidth, root.innerHeight, root.devicePixelRatio, sequencer.next()))
    }

    function closeSocket() {
      clearTimeout(reopenTimer)
      if (socket) {
        socket.off()
        socket.disconnect()
        socket = null
      }
    }

    function openSocket() {
      closeSocket()
      showNotice(NOTICES.offline)
      socket = root.io('/api/hmi', {
        auth: function (callback) {
          callback({ token: token })
        },
        reconnectionDelayMax: 5000,
      })
      socket.on('connect', function () {
        sequencer.reset()
        sendViewport()
      })
      socket.on('connect_error', function () {
        if (!token || !tokenUsable(token, Date.now())) {
          showForm('Your session expired. Sign in again.')
          return
        }
        showNotice(NOTICES.offline)
        // A refusal by the server is not retried by socket.io itself; the token may have just been renewed.
        if (socket && !socket.active) {
          var refused = socket
          reopenTimer = setTimeout(function () {
            if (socket === refused) refused.connect()
          }, RECONNECT_DELAY_MS)
        }
      })
      socket.on('disconnect', function (reason) {
        if (reason === 'io server disconnect') {
          // The runtime refused the token on a re-check; it may have been renewed meanwhile.
          checkSession()
          return
        }
        showNotice(NOTICES.offline)
      })
      socket.on('hmi_status', function (status) {
        var state = status && status.state
        showNotice(noticeFor(state))
        clearTimeout(reopenTimer)
        if (state === 'busy' || state === 'fault') reopenTimer = setTimeout(sendViewport, REOPEN_DELAY_MS)
      })
      socket.on('hmi_signed_out', function () {
        showForm('Signed out.')
      })
      socket.on('dl', function (bytes, ack) {
        draw(bytes)
        if (typeof ack === 'function') ack()
      })
    }

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

    function draw(bytes) {
      if (!wasm) return
      var data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer || bytes)
      var exports = wasm.exports
      var target = exports.hmi_client_dl(data.length)
      if (!target) return
      new Uint8Array(exports.memory.buffer, target, data.length).set(data)
      var size = exports.hmi_client_dl_size(data.length)
      if (!size) return
      var ratio = Math.min(8, Math.max(0.25, root.devicePixelRatio || 1))
      var w = size & 0xffff
      var h = size >>> 16
      var pw = Math.round(w * ratio)
      var ph = Math.round(h * ratio)
      var pixels = exports.hmi_client_render(data.length, pw, ph, Math.round(ratio * 256))
      if (!pixels) return
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
        canvas.style.width = w + 'px'
        canvas.style.height = h + 'px'
      }
      var rgba = new Uint8ClampedArray(exports.memory.buffer, pixels, pw * ph * 4)
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba), pw, ph), 0, 0)
    }

    function canvasPoint(event) {
      var rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    canvas.addEventListener('pointerdown', function (event) {
      pressed = true
      canvas.setPointerCapture(event.pointerId)
      canvas.focus()
      var p = canvasPoint(event)
      send(pointerEvent(0, p.x, p.y, sequencer.next()))
    })
    canvas.addEventListener('pointermove', function (event) {
      if (!pressed) return
      var first = pendingMove === null
      pendingMove = canvasPoint(event)
      if (first)
        root.requestAnimationFrame(function () {
          if (pendingMove && pressed) send(pointerEvent(1, pendingMove.x, pendingMove.y, sequencer.next()))
          pendingMove = null
        })
    })
    var release = function (event) {
      if (!pressed) return
      pressed = false
      pendingMove = null
      var p = canvasPoint(event)
      send(pointerEvent(2, p.x, p.y, sequencer.next()))
    }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('keydown', function (event) {
      if (!notice.hidden) return
      var c = keyCode(event)
      if (!c) return
      event.preventDefault()
      send({ t: 'k', c: c, n: sequencer.next() })
    })

    var resizeTimer = 0
    root.addEventListener('resize', function () {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(sendViewport, 150)
    })

    WebAssembly.instantiateStreaming(fetch('hmi_client.wasm'), { wasi_snapshot_preview1: wasiStubs() })
      .then(function (result) {
        wasm = result.instance
        if (typeof wasm.exports._initialize === 'function') wasm.exports._initialize()
      })
      .catch(function () {
        showNotice('This browser cannot draw the HMI')
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

  /** WASI imports answered as not supported: the client module has no files, clock or environment. */
  function wasiStubs() {
    var handler = {
      get: function (_target, name) {
        return function () {
          if (name === 'proc_exit') throw new Error('hmi_client.wasm exited')
          return 52
        }
      },
    }
    return new Proxy({}, handler)
  }

  if (typeof document !== 'undefined' && root.document === document && typeof root.io === 'function') {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', function () {
        start(document)
      })
    else start(document)
  }
})(typeof window !== 'undefined' ? window : globalThis)
