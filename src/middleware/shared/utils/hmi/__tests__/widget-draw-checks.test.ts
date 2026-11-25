import { hmiFixedDrawCalls } from '../widget-draw-checks'

const widget = (draw: string, extra = '') => `FUNCTION_BLOCK Badge EXTENDS HmiElement
${extra}  METHOD PROTECTED OVERRIDE Draw : BOOL
${draw}
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`

describe('fixed coordinates in widget drawing', () => {
  it('flags positions and lengths that are numbers or constants, positional or named, on the first fixed one', () => {
    const source = widget(
      [
        '    HMI_FILLRECT(20, 20, 100, 100, 23, COLOR.RED);',
        '    HMI_Line(X1 := Left, Y1 := Top, X2 := Left + Width, Y2 := (2 * Edge));',
      ].join('\n'),
      '  VAR CONSTANT\n    Edge : DINT := 8;\n  END_VAR\n',
    )
    const found = hmiFixedDrawCalls(source)
    expect(found.map((f) => f.message.split('.')[0])).toEqual([
      'HMI_FILLRECT: X, Y, W, H are fixed',
      'HMI_Line: Y2 is fixed',
    ])
    expect(found[0].line).toBe(6)
    expect(source.slice(found[0].span.start, found[0].span.end)).toBe('20')
  })

  it('accepts drawing from the box, Sc() lengths, and fixed values outside positions and lengths', () => {
    const source = widget(
      [
        '    HMI_FillRect(Left, Top, Width, Height, 23, COLOR.RED);',
        "    HMI_Text(Left + Sc(4), Top + Height / 2, 'On', Sc(14), HMI_FONT#Bold, HMI_ALIGN#Left, COLOR.Text);",
        '    HMI_FillCircle(Left + Width / 2, Top + Height / 2, Sc(6), COLOR.Danger);',
      ].join('\n'),
    )
    expect(hmiFixedDrawCalls(source)).toEqual([])
  })
})
