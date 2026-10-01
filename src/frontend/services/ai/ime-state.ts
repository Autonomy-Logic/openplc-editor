// While an IME composition is active, inline completions must ignore intermediate characters.
let composing = false

export function setImeComposing(value: boolean): void {
  composing = value
}

export function isImeComposing(): boolean {
  return composing
}
