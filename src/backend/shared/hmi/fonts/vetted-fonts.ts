/**
 * The fonts the HMI may load (BR45): bundled with OpenPLC, pinned by SHA-256. Ids match `enum hmi_font` in the C
 * core (`resources/sources/hmi/core/hmi_core.h`); the files live in `resources/sources/hmi/fonts/`.
 *
 * Each face comes in two variants with the same outlines, advances and kerning for the characters they share:
 * - `full`: Liberation Sans 2.1.5, every glyph, for targets with room (Runtime v4, browsers);
 * - `compact`: OpenPLC Sans, Liberation Sans 2.1.5 cut to ASCII and Latin-1 without hinting, for small targets.
 *   Built by `scripts/hmi-fonts/build-openplc-sans.py`.
 */

export const HMI_FONT_REGULAR = 0
export const HMI_FONT_BOLD = 1

export type HmiFontId = typeof HMI_FONT_REGULAR | typeof HMI_FONT_BOLD

/** Number of font ids the core knows (`HMI_FONTS`). */
export const HMI_FONT_COUNT = 2

export type HmiFontVariant = 'full' | 'compact'

/** Variant a project uses unless its HMI settings choose another. */
export const DEFAULT_HMI_FONT_VARIANT: HmiFontVariant = 'compact'

export interface VettedHmiFont {
  id: HmiFontId
  variant: HmiFontVariant
  /** File name in the bundled fonts folder. */
  file: string
  /** Lowercase hex SHA-256 of the file. */
  sha256: string
}

export const VETTED_HMI_FONTS: readonly VettedHmiFont[] = [
  {
    id: HMI_FONT_REGULAR,
    variant: 'full',
    file: 'LiberationSans-Regular.ttf',
    sha256: '76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
  },
  {
    id: HMI_FONT_BOLD,
    variant: 'full',
    file: 'LiberationSans-Bold.ttf',
    sha256: '788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173',
  },
  {
    id: HMI_FONT_REGULAR,
    variant: 'compact',
    file: 'OpenPLCSans-Regular.ttf',
    sha256: 'a9eea7d90d6c7edc9ab22fc46e069cda4b7197174c5c8116fd27f5093a189fb7',
  },
  {
    id: HMI_FONT_BOLD,
    variant: 'compact',
    file: 'OpenPLCSans-Bold.ttf',
    sha256: '50603a75a1ccc1b30a39fefa73b917156fd0d9cbc1ef64fec69cbdadfe2a0e69',
  },
]

export function vettedHmiFont(id: number, variant: HmiFontVariant): VettedHmiFont | undefined {
  return VETTED_HMI_FONTS.find((font) => font.id === id && font.variant === variant)
}
