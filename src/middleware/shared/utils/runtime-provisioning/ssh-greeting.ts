const SSH_GREETING_PREFIXES = ['SSH-2.0-', 'SSH-1.99-']

function withoutTrailingCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

export function isSshGreeting(text: string): boolean {
  return text
    .split('\n')
    .map(withoutTrailingCarriageReturn)
    .some((line) => SSH_GREETING_PREFIXES.some((prefix) => line.startsWith(prefix)))
}
