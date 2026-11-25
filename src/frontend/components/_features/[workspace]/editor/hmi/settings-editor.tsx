/**
 * HMI Settings: the start screen, frame period, default theme and font; where browsers open the HMI; which roles open
 * each screen; the local panel's PIN, relock and touch calibration, on a board that has one; and the project themes, edited token by
 * token beside a live preview drawn by the core.
 */
import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { Label } from '@root/frontend/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@root/frontend/components/_atoms/table'
import { ToggleSwitch } from '@root/frontend/components/_atoms/toggle-switch'
import { useTargetCapabilities } from '@root/frontend/hooks/use-target-capabilities'
import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import { isOpenPLCRuntimeV4Target } from '@root/frontend/utils/device'
import { toast } from '@root/frontend/utils/toast'
import { useCapabilities } from '@root/middleware/shared/providers/platform-context'
import { HMI_ADDRESS_PLACEHOLDER, hmiAddress } from '@root/middleware/shared/utils/hmi/address'
import { screensUsingTheme } from '@root/middleware/shared/utils/hmi/references'
import {
  HMI_BUILTIN_THEMES,
  HMI_FONT_VARIANTS,
  HMI_ROLES,
  HMI_THEME_TOKENS,
  HMI_THEMES_MAX,
  HMI_TOUCH_CALIBRATION_MODES,
  type HmiProjectTheme,
  type HmiSettings,
  hmiThemeColors,
  parseHmiSettings,
  screenGrant,
} from '@root/middleware/shared/utils/hmi/settings'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { useProjectRequest } from './designer/hmi-designer'
import { PreviewLoading } from './designer/parts'
import { previewProgress } from './designer/preview-progress'
import { usePreviewSession } from './designer/use-preview-session'

const PREVIEW_DEVICE = { id: 'theme', label: 'Theme', width: 640, height: 360, density: 2 }
const PREVIEW_DELAY_MS = 300
const FONT_LABELS: Record<(typeof HMI_FONT_VARIANTS)[number], string> = { compact: 'Compact', full: 'Full' }
const ROLE_LABELS: Record<(typeof HMI_ROLES)[number], string> = {
  engineer: 'Engineer',
  operator: 'Operator',
  viewer: 'Viewer',
}

const INPUT_CLASS =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
const SELECT_TRIGGER_CLASS =
  'flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
const BUTTON_CLASS =
  'h-[30px] rounded-md bg-brand px-4 py-1 font-caption text-cp-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
const LABEL_CLASS = 'w-32 shrink-0 whitespace-nowrap text-xs text-neutral-950 dark:text-white'

/** A card of settings, as the server editors draw them. */
function Panel(props: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div
      className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'
      data-testid={props.testId}
    >
      <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>{props.title}</h3>
      {props.children}
    </div>
  )
}

function Field(props: { label: string; children: ReactNode; error?: string; width?: string }) {
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-2'>
        <Label className={LABEL_CLASS}>{props.label}</Label>
        <div className={cn('flex items-center gap-2', props.width ?? 'w-64')}>{props.children}</div>
      </div>
      {props.error && <p className='pl-[136px] text-xs text-red-600 dark:text-red-400'>{props.error}</p>}
    </div>
  )
}

/**
 * Where a browser opens the HMI of the project's Runtime v4 device, or null for other targets. The address is the
 * device's IP where the editor reaches it directly; elsewhere it is not known here, so the row shows its pattern.
 */
function useHmiAddress(): string | null {
  const capabilities = useCapabilities()
  const board = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const boardInfo = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards.get(board))
  const ip = useOpenPLCStore((s) => s.deviceDefinitions.configuration.runtimeIpAddress)
  if (!isOpenPLCRuntimeV4Target(board, boardInfo)) return null
  return (capabilities.hasOrchestratorDevices ? null : hmiAddress(ip)) ?? HMI_ADDRESS_PLACEHOLDER
}

function SettingSelect(props: {
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
  label: string
  testId?: string
}) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger
        withIndicator
        aria-label={props.label}
        data-testid={props.testId}
        placeholder={props.options.find((o) => o.value === props.value)?.label}
        className={SELECT_TRIGGER_CLASS}
      />
      <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
        {props.options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900'
          >
            <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              {o.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A text field that commits on Enter or when it loses focus. */
function CommitInput(props: {
  value: string
  onCommit: (text: string) => void
  label: string
  testId?: string
  className?: string
  inputMode?: 'numeric' | 'text'
  placeholder?: string
}) {
  const [text, setText] = useState(props.value)
  useEffect(() => setText(props.value), [props.value])
  const commit = () => text !== props.value && props.onCommit(text)
  return (
    <input
      aria-label={props.label}
      className={cn(INPUT_CLASS, props.className)}
      value={text}
      placeholder={props.placeholder}
      inputMode={props.inputMode}
      data-testid={props.testId}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setText(props.value)
      }}
    />
  )
}

/** A sample screen drawn by the core in `theme`, rebuilt a moment after the settings change. */
function ThemePreview(props: { theme: string }) {
  const { request, ready } = useProjectRequest()
  const themed = useMemo(() => ({ ...request, screens: [], themePreview: props.theme }), [request, props.theme])
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = usePreviewSession({
    request: ready ? themed : null,
    screen: '',
    device: PREVIEW_DEVICE,
    design: false,
    framePeriodMs: request.settings.framePeriodMs,
    canvas,
  })
  const progress = previewProgress(preview)
  const { rebuild } = preview
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const timer = setTimeout(rebuild, PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [props.theme, request.settings.themes, rebuild])
  return (
    <div data-testid='hmi-theme-preview' data-preview={preview.status} className='relative w-fit'>
      <canvas
        ref={canvas}
        className='rounded-lg border border-neutral-200 dark:border-neutral-850'
        style={{ width: PREVIEW_DEVICE.width * 0.75, height: PREVIEW_DEVICE.height * 0.75 }}
      />
      {progress && <PreviewLoading step={progress.step} dimmed={progress.dimmed} />}
    </div>
  )
}

function ThemeColors(props: {
  theme: HmiProjectTheme
  settings: HmiSettings
  onChange: (theme: HmiProjectTheme) => void
}) {
  const { theme } = props
  const colors = hmiThemeColors(props.settings, theme.name)
  return (
    <div className='flex flex-col gap-2' data-testid={`hmi-theme-${theme.name}`}>
      {HMI_THEME_TOKENS.map((token) => {
        const own = theme.colors[token]
        const value = colors?.[token] ?? '#000000'
        return (
          <div key={token} className='flex items-center gap-2'>
            <Label className={LABEL_CLASS}>{token}</Label>
            <input
              type='color'
              aria-label={`${token} color`}
              data-testid={`hmi-theme-color-${token}`}
              value={value.toLowerCase()}
              onChange={(e) =>
                props.onChange({ ...theme, colors: { ...theme.colors, [token]: e.target.value.toUpperCase() } })
              }
              className='h-[30px] w-[30px] shrink-0 cursor-pointer rounded-md border border-neutral-300 bg-white p-0.5 dark:border-neutral-850 dark:bg-neutral-950'
            />
            <CommitInput
              label={`${token} hex`}
              value={value}
              testId={`hmi-theme-hex-${token}`}
              className={cn('w-28', own === undefined && 'text-neutral-500')}
              onCommit={(text) => props.onChange({ ...theme, colors: { ...theme.colors, [token]: text.trim() } })}
            />
            {own !== undefined && (
              <button
                type='button'
                aria-label={`Reset ${token} to ${theme.base}`}
                title={`Back to ${theme.base}`}
                onClick={() => {
                  const rest = Object.fromEntries(Object.entries(theme.colors).filter(([k]) => k !== token))
                  props.onChange({ ...theme, colors: rest })
                }}
                className='text-xs font-medium text-brand-medium hover:text-brand-medium-dark'
              >
                Reset
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function HmiSettingsEditor() {
  const hmi = useOpenPLCStore((s) => s.project.data.hmi)
  const applySettings = useOpenPLCStore((s) => s.hmiDesignerActions.applySettings)
  const settings = hmi?.settings
  const address = useHmiAddress()
  const panel = useTargetCapabilities().hmi ?? null
  const screens = useMemo(() => (hmi?.screens ?? []).map((s) => s.name), [hmi?.screens])
  const [themeName, setThemeName] = useState<string | null>(null)
  const [newTheme, setNewTheme] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pinOpen, setPinOpen] = useState(false)

  if (!hmi || !settings) return null
  const selectedTheme = settings.themes.find((t) => t.name === themeName) ?? settings.themes[0] ?? null
  const previewTheme = selectedTheme?.name ?? settings.defaultTheme
  const themeNames = [...HMI_BUILTIN_THEMES, ...settings.themes.map((t) => t.name)]
  const full = HMI_BUILTIN_THEMES.length + settings.themes.length >= HMI_THEMES_MAX

  const apply = (next: HmiSettings, field: string): boolean => {
    const parsed = parseHmiSettings(next)
    if (!parsed.ok) {
      setErrors({ ...errors, [field]: parsed.errors[0] ?? 'not valid' })
      return false
    }
    setErrors(Object.fromEntries(Object.entries(errors).filter(([k]) => k !== field)))
    applySettings(parsed.settings)
    return true
  }
  const updateTheme = (theme: HmiProjectTheme) =>
    apply({ ...settings, themes: settings.themes.map((t) => (t.name === theme.name ? theme : t)) }, 'themes')
  const addTheme = () => {
    const name = newTheme.trim()
    if (apply({ ...settings, themes: [...settings.themes, { name, base: 'Autonomy', colors: {} }] }, 'themes')) {
      setThemeName(name)
      setNewTheme('')
    }
  }
  const deleteTheme = (theme: HmiProjectTheme) => {
    const users = screensUsingTheme(hmi, theme.name)
    const reason =
      users.length > 0
        ? `${users.join(', ')} ${users.length > 1 ? 'use' : 'uses'} it`
        : settings.defaultTheme.toUpperCase() === theme.name.toUpperCase()
          ? 'it is the default theme'
          : null
    if (reason) {
      toast({ title: `${theme.name} not deleted`, description: reason, variant: 'fail' })
      return
    }
    if (apply({ ...settings, themes: settings.themes.filter((t) => t.name !== theme.name) }, 'themes'))
      setThemeName(null)
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden p-4' data-testid='hmi-settings'>
      <div className='mb-4'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>HMI Settings</h2>
      </div>
      <div className='flex flex-1 flex-col gap-6 overflow-auto'>
        <div className='grid items-start gap-6 xl:grid-cols-2'>
          <Panel title='General'>
            <Field label='Start screen'>
              <SettingSelect
                label='Start screen'
                testId='hmi-start-screen'
                value={screens.find((s) => s.toUpperCase() === settings.startScreen.toUpperCase()) ?? screens[0] ?? ''}
                options={screens.map((s) => ({ value: s, label: s }))}
                onChange={(startScreen) => apply({ ...settings, startScreen }, 'startScreen')}
              />
            </Field>
            <Field label='Frame period (ms)' error={errors.framePeriodMs}>
              <CommitInput
                label='Frame period'
                className='w-24'
                inputMode='numeric'
                testId='hmi-frame-period'
                value={String(settings.framePeriodMs)}
                onCommit={(text) => apply({ ...settings, framePeriodMs: Number(text) }, 'framePeriodMs')}
              />
            </Field>
            <Field label='Default theme'>
              <SettingSelect
                label='Default theme'
                testId='hmi-default-theme'
                value={themeNames.find((t) => t.toUpperCase() === settings.defaultTheme.toUpperCase()) ?? 'Autonomy'}
                options={themeNames.map((t) => ({ value: t, label: t }))}
                onChange={(defaultTheme) => apply({ ...settings, defaultTheme }, 'defaultTheme')}
              />
            </Field>
            <Field label='Font'>
              <SettingSelect
                label='Font'
                testId='hmi-font'
                value={settings.fontVariant}
                options={HMI_FONT_VARIANTS.map((f) => ({ value: f, label: FONT_LABELS[f] }))}
                onChange={(font) => {
                  const fontVariant = HMI_FONT_VARIANTS.find((f) => f === font)
                  if (fontVariant) apply({ ...settings, fontVariant }, 'fontVariant')
                }}
              />
            </Field>
            {address !== null && (
              <Field label='HMI address' width='w-auto'>
                <span
                  data-testid='hmi-address'
                  className='select-text whitespace-nowrap font-caption text-xs font-medium text-neutral-850 dark:text-neutral-300'
                >
                  {address}
                </span>
              </Field>
            )}
          </Panel>

          <Panel title='Local panel' testId='hmi-local-panel'>
            {panel === null ? (
              <p data-testid='hmi-local-panel-none' className='text-xs text-neutral-700 dark:text-neutral-300'>
                The selected board has no local panel.
              </p>
            ) : (
              <>
                <Field label='Require a PIN' error={errors.pin}>
                  <ToggleSwitch
                    aria-label='Require a PIN'
                    checked={settings.pin.enabled || pinOpen}
                    onCheckedChange={(on) => {
                      setPinOpen(on)
                      if (!on) apply({ ...settings, pin: { enabled: false, value: '' } }, 'pin')
                    }}
                  />
                </Field>
                {(settings.pin.enabled || pinOpen) && (
                  <Field label='PIN' error={errors.pinValue}>
                    <CommitInput
                      label='PIN'
                      className='w-32'
                      inputMode='numeric'
                      placeholder='4 to 8 digits'
                      testId='hmi-pin'
                      value={settings.pin.value}
                      onCommit={(value) =>
                        apply({ ...settings, pin: { enabled: true, value: value.trim() } }, 'pinValue')
                      }
                    />
                  </Field>
                )}
                <Field label='Lock again'>
                  <SettingSelect
                    label='Lock again'
                    testId='hmi-relock'
                    value={settings.relock.mode}
                    options={[
                      { value: 'never', label: 'Only at startup' },
                      { value: 'idle', label: 'After idle minutes' },
                    ]}
                    onChange={(mode) =>
                      apply(
                        { ...settings, relock: mode === 'idle' ? { mode: 'idle', minutes: 10 } : { mode: 'never' } },
                        'relock',
                      )
                    }
                  />
                </Field>
                {settings.relock.mode === 'idle' && (
                  <Field label='Idle minutes' error={errors.relock}>
                    <CommitInput
                      label='Idle minutes'
                      className='w-24'
                      inputMode='numeric'
                      testId='hmi-relock-minutes'
                      value={String(settings.relock.minutes)}
                      onCommit={(text) =>
                        apply({ ...settings, relock: { mode: 'idle', minutes: Number(text) } }, 'relock')
                      }
                    />
                  </Field>
                )}
                {panel.touch && panel.touchCalibration && (
                  <Field label='Touch calibration'>
                    <SettingSelect
                      label='Touch calibration'
                      testId='hmi-touch-calibration'
                      value={settings.touchCalibration.mode}
                      options={[
                        { value: 'once', label: 'Once' },
                        { value: 'upload', label: 'After every program upload' },
                        { value: 'boot', label: 'On every boot' },
                      ]}
                      onChange={(mode) => {
                        const picked = HMI_TOUCH_CALIBRATION_MODES.find((m) => m === mode)
                        if (picked) apply({ ...settings, touchCalibration: { mode: picked } }, 'touchCalibration')
                      }}
                    />
                  </Field>
                )}
              </>
            )}
          </Panel>
        </div>

        <Panel title='Screens by role' testId='hmi-role-grid'>
          <Table className='w-full'>
            <TableHeader>
              <TableRow>
                <TableHead className='w-auto text-left lg:w-auto 2xl:w-auto'>
                  <span className='px-3'>Screen</span>
                </TableHead>
                {['Admin', ...HMI_ROLES.map((r) => ROLE_LABELS[r])].map((role) => (
                  <TableHead key={role} className='w-28 lg:w-28 2xl:w-28'>
                    {role}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {screens.map((screen) => {
                const grant = screenGrant(settings, screen)
                return (
                  <TableRow key={screen}>
                    <TableCell className='px-3 text-left text-neutral-850 dark:text-neutral-300'>{screen}</TableCell>
                    <TableCell>
                      <div className='flex justify-center'>
                        <Checkbox checked disabled aria-label={`Admin opens ${screen}`} />
                      </div>
                    </TableCell>
                    {HMI_ROLES.map((role) => (
                      <TableCell key={role}>
                        <div className='flex justify-center'>
                          <Checkbox
                            checked={grant[role]}
                            aria-label={`${ROLE_LABELS[role]} opens ${screen}`}
                            data-testid={`hmi-role-${screen}-${role}`}
                            onCheckedChange={(checked) =>
                              apply(
                                {
                                  ...settings,
                                  roles: { ...settings.roles, [screen]: { ...grant, [role]: checked === true } },
                                },
                                'roles',
                              )
                            }
                          />
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Panel>

        <Panel title='Project themes' testId='hmi-themes'>
          <div className='flex flex-wrap items-center gap-2'>
            {settings.themes.length > 0 && (
              <div className='w-48'>
                <SettingSelect
                  label='Theme'
                  testId='hmi-theme-select'
                  value={selectedTheme?.name ?? ''}
                  options={settings.themes.map((t) => ({ value: t.name, label: t.name }))}
                  onChange={setThemeName}
                />
              </div>
            )}
            <CommitInput
              label='New theme name'
              className='w-48'
              placeholder='New theme name'
              testId='hmi-theme-new-name'
              value={newTheme}
              onCommit={setNewTheme}
            />
            <button
              type='button'
              data-testid='hmi-theme-add'
              disabled={newTheme.trim() === '' || full}
              title={full ? `At most ${HMI_THEMES_MAX} themes, the predefined ones included` : undefined}
              onClick={addTheme}
              className={BUTTON_CLASS}
            >
              Add theme
            </button>
          </div>
          {errors.themes && <p className='text-xs text-red-600 dark:text-red-400'>{errors.themes}</p>}
          {selectedTheme && (
            <div className='flex flex-wrap items-start gap-6 border-t border-neutral-100 pt-4 dark:border-neutral-800'>
              <div className='flex w-[400px] shrink-0 flex-col gap-3'>
                <Field label='Based on'>
                  <SettingSelect
                    label='Based on'
                    testId='hmi-theme-base'
                    value={selectedTheme.base}
                    options={HMI_BUILTIN_THEMES.map((t) => ({ value: t, label: t }))}
                    onChange={(base) => {
                      const known = HMI_BUILTIN_THEMES.find((t) => t === base)
                      if (known) updateTheme({ ...selectedTheme, base: known })
                    }}
                  />
                </Field>
                <ThemeColors theme={selectedTheme} settings={settings} onChange={updateTheme} />
                <div>
                  <button
                    type='button'
                    data-testid='hmi-theme-delete'
                    onClick={() => deleteTheme(selectedTheme)}
                    className='text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400'
                  >
                    Delete {selectedTheme.name}
                  </button>
                </div>
              </div>
              <ThemePreview theme={previewTheme} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
