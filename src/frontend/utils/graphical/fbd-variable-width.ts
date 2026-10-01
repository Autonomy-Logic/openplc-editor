// Narrowest an FBD variable box may be: below this the text area has no room
// left. Lives here, not with the component constants, so the PLCopen parser can
// clamp imported widths without importing from the component layer.
export const VARIABLE_ELEMENT_MIN_WIDTH = 64

/**
 * Width to store for an imported variable box. Other tools size these boxes to
 * their text, so a PLCopen file can carry a width too narrow for ours. A
 * missing width (0) is left alone so the renderer's default still applies.
 */
export const clampImportedVariableWidth = (width: number): number =>
  width > 0 ? Math.max(VARIABLE_ELEMENT_MIN_WIDTH, width) : width
