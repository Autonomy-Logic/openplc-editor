/**
 * HMI Settings (`hmi/settings.json`): start screen, frame period, role grid, local-panel PIN, relock and touch
 * calibration, project themes, the default theme and the font variant. The HMI address is not stored: it is shown from the target.
 */
import { z } from 'zod'

/** Roles the grid grants screens to; admin always has every screen. */
export const HMI_ROLES = ['engineer', 'operator', 'viewer'] as const
export type HmiRole = (typeof HMI_ROLES)[number]

/** Predefined themes, in the order of their ids in the C core. */
export const HMI_BUILTIN_THEMES = ['Autonomy', 'Light', 'Dark', 'Classic', 'Ocean'] as const
/** Theme tokens, in the order of their ids in the C core (from 1). */
export const HMI_THEME_TOKENS = [
  'Background',
  'Surface',
  'Text',
  'TextMuted',
  'Border',
  'Fill',
  'Accent',
  'OnAccent',
  'Success',
  'Warning',
  'Danger',
  'Bar',
  'OnBar',
] as const
export type HmiThemeToken = (typeof HMI_THEME_TOKENS)[number]
/** Colors of the predefined themes by token, as the C core defines them (`hmi_theme.c`). */
export const HMI_BUILTIN_THEME_COLORS: Record<(typeof HMI_BUILTIN_THEMES)[number], Record<HmiThemeToken, string>> = {
  Autonomy: {
    Background: '#F7F8FA',
    Surface: '#FFFFFF',
    Text: '#121316',
    TextMuted: '#5E6275',
    Border: '#C8D0D9',
    Fill: '#DDE2E8',
    Accent: '#0464FB',
    OnAccent: '#FFFFFF',
    Success: '#16A34A',
    Warning: '#F59E0B',
    Danger: '#DC2626',
    Bar: '#011E4B',
    OnBar: '#B4D0FE',
  },
  Light: {
    Background: '#FFFFFF',
    Surface: '#FFFFFF',
    Text: '#141414',
    TextMuted: '#5A5A5A',
    Border: '#969696',
    Fill: '#EEEEEE',
    Accent: '#FF8C00',
    OnAccent: '#FFFFFF',
    Success: '#008200',
    Warning: '#C86400',
    Danger: '#C80000',
    Bar: '#282828',
    OnBar: '#EBEBEB',
  },
  Dark: {
    Background: '#14161A',
    Surface: '#282C32',
    Text: '#DCDCDC',
    TextMuted: '#A5AAB4',
    Border: '#6E737D',
    Fill: '#282C32',
    Accent: '#FFAA28',
    OnAccent: '#14161A',
    Success: '#78D278',
    Warning: '#FFB45A',
    Danger: '#FF5A5A',
    Bar: '#08090B',
    OnBar: '#C8CDD7',
  },
  Classic: {
    Background: '#C6D2A8',
    Surface: '#C6D2A8',
    Text: '#000000',
    TextMuted: '#404040',
    Border: '#848484',
    Fill: '#B4BF98',
    Accent: '#FFA400',
    OnAccent: '#FFFFFF',
    Success: '#008C00',
    Warning: '#E67800',
    Danger: '#FF0000',
    Bar: '#212421',
    OnBar: '#C6C6C6',
  },
  Ocean: {
    Background: '#122634',
    Surface: '#203C4E',
    Text: '#D7E6F0',
    TextMuted: '#A0BECD',
    Border: '#64828C',
    Fill: '#203C4E',
    Accent: '#00C8C8',
    OnAccent: '#0A1E28',
    Success: '#78D7A0',
    Warning: '#FFBE6E',
    Danger: '#FF6E6E',
    Bar: '#081620',
    OnBar: '#C8E1EB',
  },
}

/** Most themes, predefined ones included. */
export const HMI_THEMES_MAX = 16
export const HMI_DEFAULT_THEME = 'Autonomy'
export const HMI_FONT_VARIANTS = ['compact', 'full'] as const
/**
 * When a local panel whose touch needs calibrating shows the calibration screen: once (until it is erased or asked
 * for), after every program upload, or on every boot. Order is the id the unit gives the C host.
 */
export const HMI_TOUCH_CALIBRATION_MODES = ['once', 'upload', 'boot'] as const

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const COLOR_RGB = /^#[0-9A-Fa-f]{6}$/
const PIN = /^[0-9]{4,8}$/

const roleGrantSchema = z.object({ engineer: z.boolean(), operator: z.boolean(), viewer: z.boolean() })
export type HmiRoleGrant = z.infer<typeof roleGrantSchema>

const colorsSchema = z
  .record(z.string(), z.string().regex(COLOR_RGB, 'a color must be #RRGGBB'))
  .superRefine((colors, ctx) => {
    for (const token of Object.keys(colors))
      if (!HMI_THEME_TOKENS.some((t) => t === token))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [token], message: `'${token}' is not a theme color` })
  })

export const hmiProjectThemeSchema = z.object({
  name: z.string().regex(IDENTIFIER, 'a theme name must be an identifier'),
  base: z.enum(HMI_BUILTIN_THEMES),
  /** Colors that differ from the base theme, by token. */
  colors: colorsSchema.default({}),
})
export type HmiProjectTheme = z.infer<typeof hmiProjectThemeSchema>

export const hmiSettingsSchema = z
  .object({
    /** Screen viewers start on; empty means the first screen in project order. */
    startScreen: z.string().default(''),
    framePeriodMs: z.number().int().min(20).max(1000).default(100),
    /** Roles granted each screen, by screen name; a screen without an entry is granted to engineer only. */
    roles: z.record(z.string(), roleGrantSchema).default({}),
    pin: z
      .object({ enabled: z.boolean().default(false), value: z.string().default('') })
      .default({ enabled: false, value: '' }),
    relock: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('never') }),
        z.object({ mode: z.literal('idle'), minutes: z.number().int().min(1).max(1440) }),
      ])
      .default({ mode: 'never' }),
    themes: z
      .array(hmiProjectThemeSchema)
      .max(HMI_THEMES_MAX - HMI_BUILTIN_THEMES.length)
      .default([]),
    defaultTheme: z.string().default(HMI_DEFAULT_THEME),
    fontVariant: z.enum(HMI_FONT_VARIANTS).default('compact'),
    touchCalibration: z.object({ mode: z.enum(HMI_TOUCH_CALIBRATION_MODES).default('once') }).default({ mode: 'once' }),
  })
  .superRefine((s, ctx) => {
    if (s.pin.enabled ? !PIN.test(s.pin.value) : s.pin.value !== '' && !PIN.test(s.pin.value))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pin', 'value'], message: 'the PIN must be 4 to 8 digits' })
    const seen = new Set<string>(HMI_BUILTIN_THEMES.map((t) => t.toUpperCase()))
    s.themes.forEach((theme, i) => {
      const key = theme.name.toUpperCase()
      if (seen.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['themes', i, 'name'],
          message: `a theme named '${theme.name}' already exists`,
        })
      seen.add(key)
    })
    if (!seen.has(s.defaultTheme.toUpperCase()))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultTheme'],
        message: `'${s.defaultTheme}' is not a theme`,
      })
  })
export type HmiSettings = z.infer<typeof hmiSettingsSchema>

export type HmiSettingsParse = { ok: true; settings: HmiSettings } | { ok: false; errors: string[] }

/** Validates settings read from a project, filling defaults for what is missing. */
export function parseHmiSettings(value: unknown): HmiSettingsParse {
  const result = hmiSettingsSchema.safeParse(value)
  if (result.success) return { ok: true, settings: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)),
  }
}

/** Settings of a project's first screen. */
export function defaultHmiSettings(): HmiSettings {
  return hmiSettingsSchema.parse({})
}

/** Roles a screen is granted; a screen without an entry is granted to engineer only. */
export function screenGrant(settings: HmiSettings, screen: string): HmiRoleGrant {
  const key = Object.keys(settings.roles).find((k) => k.toUpperCase() === screen.toUpperCase())
  return key !== undefined ? settings.roles[key] : { engineer: true, operator: false, viewer: false }
}

/** Theme id the C core knows a theme by: predefined themes first, then project themes in order; -1 when unknown. */
export function hmiThemeId(settings: HmiSettings, name: string): number {
  const builtin = HMI_BUILTIN_THEMES.findIndex((t) => t.toUpperCase() === name.toUpperCase())
  if (builtin >= 0) return builtin
  const project = settings.themes.findIndex((t) => t.name.toUpperCase() === name.toUpperCase())
  return project >= 0 ? HMI_BUILTIN_THEMES.length + project : -1
}

/** A theme's color for each token: a project theme's overrides over its base, a predefined theme's own colors. */
export function hmiThemeColors(settings: HmiSettings, name: string): Record<HmiThemeToken, string> | null {
  const builtin = HMI_BUILTIN_THEMES.find((t) => t.toUpperCase() === name.toUpperCase())
  if (builtin) return HMI_BUILTIN_THEME_COLORS[builtin]
  const project = settings.themes.find((t) => t.name.toUpperCase() === name.toUpperCase())
  if (!project) return null
  const colors = { ...HMI_BUILTIN_THEME_COLORS[project.base] }
  for (const token of HMI_THEME_TOKENS) {
    const own = project.colors[token]
    if (own !== undefined) colors[token] = own.toUpperCase()
  }
  return colors
}
