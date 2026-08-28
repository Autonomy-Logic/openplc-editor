// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * The Python side of the shared-memory boundary — FIXED text, identical in
 * every build.
 *
 * This is the whole point of the layout-table design. Everything
 * project-specific is DATA (the tables `shm-layout-table.ts` emits); the code
 * that consumes it never changes. Before, the decode, the container
 * reconstruction and the encode were all generated per project, and every bug
 * this effort chased lived there: format arity, repeat counts, index
 * bookkeeping, a constructor naming a temporary the decode never produced, a
 * class emitted under one spelling and constructed under another. Generated data
 * can be wrong; it cannot be *inconsistently* wrong across three emitters,
 * because there is one consumer and it is this.
 *
 * `python-shm-runtime.fixture.py` pins this text byte-for-byte, so "identical
 * every build" is enforced rather than hoped for, and the same fixture is what
 * the Python-level tests execute.
 *
 * Deliberately dependency-free and 3.7-compatible: it runs under whatever
 * interpreter the runtime venv provides, and a Python block's own imports are
 * the user's business, not ours.
 *
 * One hard constraint on this text: **it must not contain a literal percent
 * sign**. `python_block_loader` writes the generated script with
 * `fprintf(fp, script_content, pid, shm_name, shm_name)` — the script IS the
 * format string — so any percent here is parsed as a conversion directive.
 * glibc happens to emit a malformed one verbatim, but it is undefined
 * behaviour, and this text ships in every block rather than on some rare path.
 * Where Python would want `%`, use `//` and multiplication instead.
 */

/**
 * Characters carried for STRING / WSTRING, mirroring `SHM_STRING_CHARS`.
 *
 * Emitted into the runtime as `_STR_CHARS` rather than read from the layout,
 * because it is a property of the transport rather than of any one field. The
 * generator interpolates it so the two cannot drift.
 */
export const SHM_RUNTIME_STRING_CHARS_TOKEN = '__STR_CHARS__'

/**
 * The fixed runtime, with `__STR_CHARS__` still to be substituted.
 *
 * A layout row is `(path, objectPath, kind, offset, size, enumClass)`:
 *
 *   - `path`        tuple of attribute names and integer indices — `('m', 'trims', 0)`
 *   - `objectPath`  class name per path node, or None where the node is a list
 *                   or the leaf itself; same length as `path`
 *   - `kind`        a `struct` format character for a scalar, or `'str'` / `'wstr'`
 *   - `offset`      byte offset into the packed segment
 *   - `size`        packed width, used only by the startup consistency check
 *   - `enumClass`   name of the IntEnum to present the value as, or None
 */
const RUNTIME = `
# ===================================================================
# OpenPLC shared-memory runtime — fixed, identical in every build.
# The layout tables above are the only project-specific part; this
# code reads them. Do not edit: it is emitted verbatim by the editor.
# ===================================================================
_STR_CHARS = ${SHM_RUNTIME_STRING_CHARS_TOKEN}


def _shm_total(layout):
    """Packed width the layout describes, for the startup size check."""
    return max((off + size for _p, _o, _k, off, size, _e in layout), default=0)


def _shm_get(buf, kind, off):
    """One field out of the segment."""
    if kind == 'str':
        n = buf[off]
        n = max(0, min(n, _STR_CHARS))
        return bytes(buf[off + 1:off + 1 + n]).decode('utf-8', errors='ignore')
    if kind == 'wstr':
        # The prefix counts UTF-16 code units, so the byte slice is twice it.
        n = buf[off]
        n = max(0, min(n, _STR_CHARS))
        return bytes(buf[off + 1:off + 1 + n * 2]).decode('utf-16-le', errors='ignore')
    return struct.unpack_from('=' + kind, buf, off)[0]


def _shm_put(buf, kind, off, value):
    """One field into the segment."""
    if kind == 'str':
        body = str(value).encode('utf-8')[:_STR_CHARS]
        buf[off] = len(body)
        buf[off + 1:off + 1 + _STR_CHARS] = body.ljust(_STR_CHARS, b'\\0')
        return
    if kind == 'wstr':
        # Truncate on a code-unit boundary, never mid-unit. Integer division
        # rather than the modulo operator, deliberately: see the note above.
        body = str(value).encode('utf-16-le')[:_STR_CHARS * 2]
        body = body[:(len(body) // 2) * 2]
        buf[off] = len(body) // 2
        buf[off + 1:off + 1 + _STR_CHARS * 2] = body.ljust(_STR_CHARS * 2, b'\\0')
        return
    struct.pack_into('=' + kind, buf, off, value)


def _node_get(holder, key):
    if isinstance(holder, dict):
        return holder.get(key)
    if isinstance(key, int):
        return holder[key] if key < len(holder) else None
    return getattr(holder, key, None)


def _node_put(holder, key, value):
    if isinstance(holder, dict):
        holder[key] = value
    elif isinstance(key, int):
        # Lists grow to fit, so no length table is needed: the indices in the
        # layout are exactly the elements that exist.
        while len(holder) <= key:
            holder.append(None)
        holder[key] = value
    else:
        setattr(holder, key, value)


def _shm_unpack(buf, layout, scope):
    """Read every field and rebuild the containers into 'scope'."""
    for path, objpath, kind, off, _size, enum in layout:
        value = _shm_get(buf, kind, off)
        if enum is not None and enum in scope:
            value = scope[enum](value)
        holder = scope
        for i in range(len(path) - 1):
            child = _node_get(holder, path[i])
            if child is None:
                if isinstance(path[i + 1], int):
                    child = []
                else:
                    cls = objpath[i]
                    child = scope[cls]() if cls in scope else None
                _node_put(holder, path[i], child)
            holder = child
        _node_put(holder, path[-1], value)


def _shm_pack(buf, layout, scope):
    """Write every field back out of 'scope'."""
    for path, _objpath, kind, off, _size, enum in layout:
        value = scope.get(path[0]) if isinstance(scope, dict) else None
        for key in path[1:]:
            value = _node_get(value, key)
        if enum is not None:
            value = int(value)
        _shm_put(buf, kind, off, value)
`

/** The fixed runtime, ready to emit. */
export const pythonShmRuntime = (stringChars: number): string =>
  RUNTIME.split(SHM_RUNTIME_STRING_CHARS_TOKEN).join(String(stringChars))
