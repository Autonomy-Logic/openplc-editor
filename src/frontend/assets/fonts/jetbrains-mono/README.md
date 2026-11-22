# JetBrains Mono

Static faces of JetBrains Mono, bundled unmodified so the ladder editor and its PDF export draw text without any
network request.

- Release: v2.304 (published 2023-01-14)
- Source: https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304
- Archive: `JetBrainsMono-2.304.zip`, SHA-256 `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf`
- Licence: SIL Open Font License 1.1, see [OFL.txt](OFL.txt) (the release's `OFL.txt`)

| File                         | Taken from the archive                 | SHA-256                                                            |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `JetBrainsMono-Regular.ttf`  | `fonts/ttf/JetBrainsMono-Regular.ttf`  | `a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f` |
| `JetBrainsMono-SemiBold.ttf` | `fonts/ttf/JetBrainsMono-SemiBold.ttf` | `1b3bfa1ed5665a4ce3f9feb68d2d4e40e70bf8b4b7d9a3edd418f321b4e166a0` |

The same bytes are embedded in PDF export as base64 by `src/backend/shared/print/fonts/jetbrains-mono-regular.ts` and
`jetbrains-mono-semibold.ts`. When the faces are updated, regenerate both modules from these files and update the
hashes above.
