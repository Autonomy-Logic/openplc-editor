# stb_truetype

- Upstream: https://github.com/nothings/stb, `stb_truetype.h` v1.27 at commit
  `68b75304a3c6e5b18472ced74d096fef571c2e33` (SHA-256 of the unmodified file
  `29ef6577bf124902f8c060eb9e6c9133293ea9f2cd19ab3d6c781d3b601e391f`).
- Licence: public domain or MIT, at the user's choice (end of the file).

## Local changes

1. In `stbtt__hheap_alloc`: when `STBTT_HHEAP_CHUNK` is defined, edges are allocated in blocks of that many instead
   of up to 2000 (about 56 KB in one `malloc`), which microcontroller heaps cannot provide. `hmi_text.c` sets it to 64.
2. In `stbtt__rasterize_sorted_edges`: the scanline buffer of glyphs wider than 64 pixels was used without checking
   its allocation; the function now returns when it fails. `hmi_text.c` routes `STBTT_malloc` through a wrapper that
   records any failed allocation, so such a glyph is neither drawn nor cached.

Diff against upstream:

```diff
+#ifdef STBTT_HHEAP_CHUNK
+         int count = STBTT_HHEAP_CHUNK;
+#else
          int count = (size < 32 ? 2000 : size < 128 ? 800 : 100);
+#endif
@@
    else
       scanline = scanline_data;
+   if (scanline == NULL)
+      return;
```

## Build notes

- `hmi_text.c` includes the implementation with `STBTT_STATIC` and silences `-Wunused-function` and
  `-Wunused-variable` for this header only (upstream leaves `total_len` unused in its UTF-16 name decoder, which the
  HMI does not call).
- stb_truetype is not hardened against malformed fonts, so only the vetted fonts in `../../fonts` reach it.
