
# ===================================================================
# OpenPLC shared-memory runtime — fixed, identical in every build.
# The layout tables above are the only project-specific part; this
# code reads them. Do not edit: it is emitted verbatim by the editor.
# ===================================================================
_STR_CHARS = 126


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
        buf[off + 1:off + 1 + _STR_CHARS] = body.ljust(_STR_CHARS, b'\0')
        return
    if kind == 'wstr':
        # Truncate on a code-unit boundary, never mid-unit. Integer division
        # rather than the modulo operator, deliberately: see the note above.
        body = str(value).encode('utf-16-le')[:_STR_CHARS * 2]
        body = body[:(len(body) // 2) * 2]
        buf[off] = len(body) // 2
        buf[off + 1:off + 1 + _STR_CHARS * 2] = body.ljust(_STR_CHARS * 2, b'\0')
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
