import type { SourceSpan } from 'strucpp'

/** Offsets of line starts, for turning 1-based inclusive spans into string offsets. */
export class SourceText {
  private readonly starts: number[] = [0]

  constructor(readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') this.starts.push(i + 1)
  }

  offset(line: number, col: number): number {
    return (this.starts[line - 1] ?? this.text.length) + col - 1
  }

  start(span: SourceSpan): number {
    return this.offset(span.startLine, span.startCol)
  }

  end(span: SourceSpan): number {
    return this.offset(span.endLine, span.endCol) + 1
  }

  slice(span: SourceSpan): string {
    return this.text.slice(this.start(span), this.end(span))
  }
}
