/** StandardWidgets ST source: controls. Two-way controls report an operator change as Changed with NewValue. */
export const CONTROLS_ST = `(* Push button: Pressed while held, Clicked for one frame when released on the button. A wired variable follows
   Pressed. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiButton EXTENDS HmiElement
  VAR_INPUT
    Text : STRING(64) := 'Button';
    Radius : DINT := 8;
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
    {attribute 'hmi_color'}
    TextColor : UDINT := COLOR.OnAccent;
  END_VAR
  VAR_OUTPUT
    {attribute 'hmi_main'}
    Pressed : BOOL;
    Clicked : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := HMI_TextWidth(Text, 16, HMI_FONT#Bold) + 40;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 44;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    Clicked := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      Pressed := FALSE;
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      Pressed := TRUE;
      HMI_PtrConsume();
      Input := TRUE;
    ELSIF Pressed AND NOT HMI_PtrDown() THEN
      Pressed := FALSE;
      Clicked := PointerOver();
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR c : UDINT; END_VAR
    c := AccentColor;
    IF NOT Enabled THEN
      c := COLOR.Border;
    ELSIF Pressed THEN
      c := HMI_Alpha(AccentColor, 75);
    END_IF;
    HMI_FillRect(Left, Top, Width, Height, Radius, c);
    HMI_TextBox(Left, Top, Width, Height, Text, 16, HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, TextColor);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* On/off switch. Value shows the wired state; a tap asks for the opposite (Changed, NewValue) and sets Clicked. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiSwitch EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    Caption : STRING(64) := 'Switch';
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Border;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    NewValue : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := HMI_TextWidth(Caption, 16, HMI_FONT#Regular) + 80;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 44;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    Changed := FALSE;
    Clicked := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      Changed := TRUE;
      Clicked := TRUE;
      NewValue := NOT Value;
      Input := TRUE;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR tx, ty : DINT; c : UDINT; END_VAR
    tx := Left + Width - 52;
    ty := Top + (Height - 28) / 2;
    c := SEL(Value, OffColor, OnColor);
    IF NOT Enabled THEN
      c := HMI_Alpha(c, 50);
    END_IF;
    HMI_FillRect(tx, ty, 52, 28, 14, c);
    HMI_FillCircle(SEL(Value, tx + 14, tx + 38), ty + 14, 11, COLOR.White);
    HMI_TextBox(Left, Top, Width - 60, Height, Caption, 16, HMI_FONT#Regular, HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.Text);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Slider between MinValue and MaxValue; Step > 0 snaps. Changed and NewValue while dragging, Clicked on release. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiSlider EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    MinValue : REAL := 0.0;
    MaxValue : REAL := 100.0;
    Step : REAL := 0.0;
    Orientation : HMI_DIRECTION := HMI_DIRECTION#Row;
    Caption : STRING(64);
    Decimals : INT := 1;
    Unit : STRING(16);
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    NewValue : REAL;
  END_VAR
  VAR
    dragging : BOOL;
    dragPm : DINT;
    sent : REAL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 20;
    END_IF;
  END_METHOD
  METHOD INTERNAL Vertical : BOOL
    Vertical := Orientation = HMI_DIRECTION#Column OR (Orientation = HMI_DIRECTION#Auto AND Height > Width);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := SEL(Orientation = HMI_DIRECTION#Column, 200, 56);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := SEL(Orientation = HMI_DIRECTION#Column, 40, 160) + CapH();
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  (* Position of the thumb along the track for a per-mille value. *)
  METHOD INTERNAL TrackPos : DINT
    VAR_INPUT Pm : DINT; END_VAR
    IF Vertical() THEN
      TrackPos := Top + Height - 14 - (Height - CapH() - 28) * Pm / 1000;
    ELSE
      TrackPos := Left + 14 + (Width - 28) * Pm / 1000;
    END_IF;
  END_METHOD
  METHOD INTERNAL PmAtPointer : DINT
    VAR p : DINT; END_VAR
    IF Vertical() THEN
      p := (Top + Height - 14 - HMI_PtrY()) * 1000 / MAX(Height - CapH() - 28, 1);
    ELSE
      p := (HMI_PtrX() - Left - 14) * 1000 / MAX(Width - 28, 1);
    END_IF;
    PmAtPointer := LIMIT(0, p, 1000);
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    VAR v : REAL; END_VAR
    Changed := FALSE;
    Clicked := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      dragging := FALSE;
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      dragging := TRUE;
      sent := Value;
      HMI_PtrConsume();
      Input := TRUE;
    END_IF;
    IF dragging THEN
      IF HMI_PtrX() <> -1000000000 THEN
        dragPm := PmAtPointer();
      END_IF;
      v := MinValue + (MaxValue - MinValue) * DINT_TO_REAL(dragPm) / 1000.0;
      IF Step > 0.0 THEN
        v := MinValue + DINT_TO_REAL(REAL_TO_DINT((v - MinValue) / Step)) * Step;
      END_IF;
      IF v <> sent THEN
        NewValue := v;
        Changed := TRUE;
        sent := v;
      END_IF;
      IF NOT HMI_PtrDown() THEN
        dragging := FALSE;
        Clicked := TRUE;
      END_IF;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR pm, p, c0, c1, mid : DINT; END_VAR
    IF dragging THEN
      pm := dragPm;
    ELSE
      pm := HMI_PerMille(Value, MinValue, MaxValue);
    END_IF;
    IF CapH() > 0 THEN
      HMI_Text(Left, Top, Caption, 13, HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
      HMI_Text(Left + Width, Top, HMI_FormatValue(Value, Decimals, Unit), 13, HMI_FONT#Bold, HMI_ALIGN#Right, COLOR.Text);
    END_IF;
    p := TrackPos(pm);
    c0 := TrackPos(0);
    c1 := TrackPos(1000);
    IF Vertical() THEN
      mid := Left + Width / 2;
      HMI_Line(mid, c0, mid, c1, 6, COLOR.Fill);
      HMI_Line(mid, c0, mid, p, 6, AccentColor);
      HMI_FillCircle(mid, p, 11, COLOR.Surface);
      HMI_StrokeCircle(mid, p, 11, 2, AccentColor);
    ELSE
      mid := Top + CapH() + (Height - CapH()) / 2;
      HMI_Line(c0, mid, c1, mid, 6, COLOR.Fill);
      HMI_Line(c0, mid, p, mid, 6, AccentColor);
      HMI_FillCircle(p, mid, 11, COLOR.Surface);
      HMI_StrokeCircle(p, mid, 11, 2, AccentColor);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Numeric entry: a tap opens the on-screen keyboard; OK delivers NewValue with Changed for one frame. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiNumericInput EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    Decimals : INT := 1;
    Caption : STRING(64) := 'Setpoint';
    Unit : STRING(16);
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    NewValue : REAL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 160;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 60;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    Changed := FALSE;
    Clicked := FALSE;
    IF KeyboardTake() THEN
      NewValue := HMI_ParseReal(KeyboardText(), Value);
      Changed := TRUE;
    END_IF;
    IF NOT Visible OR NOT Enabled THEN
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      Clicked := TRUE;
      KeyboardOpen(HMI_FormatReal(Value, Decimals), Caption, TRUE);
      Input := TRUE;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_FillRect(Left, Top, Width, Height, 8, COLOR.Surface);
    IF KeyboardFocused() THEN
      HMI_StrokeRect(Left, Top, Width, Height, 8, 2, COLOR.Accent);
    ELSE
      HMI_StrokeRect(Left, Top, Width, Height, 8, 1, COLOR.Border);
    END_IF;
    HMI_Text(Left + 10, Top + 6, Caption, 12, HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
    HMI_TextBox(Left + 10, Top + 22, Width - 20, Height - 28, HMI_FormatValue(Value, Decimals, Unit), 18, HMI_FONT#Bold,
      HMI_ALIGN#Right, HMI_VALIGN#Middle, SEL(Enabled, COLOR.TextMuted, COLOR.Text));
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Text entry: a tap opens the on-screen keyboard in text mode; OK delivers NewValue, cut to MaxLength, with
   Changed. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiTextInput EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : STRING;
    Caption : STRING(64) := 'Text';
    Placeholder : STRING(64);
    MaxLength : INT := 64;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    NewValue : STRING;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 200;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 60;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    Changed := FALSE;
    Clicked := FALSE;
    IF KeyboardTake() THEN
      NewValue := HMI_Truncate(KeyboardText(), MaxLength);
      Changed := TRUE;
    END_IF;
    IF NOT Visible OR NOT Enabled THEN
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      Clicked := TRUE;
      KeyboardOpen(Value, Caption, FALSE);
      Input := TRUE;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_FillRect(Left, Top, Width, Height, 8, COLOR.Surface);
    IF KeyboardFocused() THEN
      HMI_StrokeRect(Left, Top, Width, Height, 8, 2, COLOR.Accent);
    ELSE
      HMI_StrokeRect(Left, Top, Width, Height, 8, 1, COLOR.Border);
    END_IF;
    HMI_Text(Left + 10, Top + 6, Caption, 12, HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
    HMI_Clip(Left + 10, Top + 22, Width - 20, Height - 26);
    IF LEN(Value) > 0 THEN
      HMI_TextBox(Left + 10, Top + 22, Width - 20, Height - 28, Value, 16, HMI_FONT#Regular, HMI_ALIGN#Left,
        HMI_VALIGN#Middle, SEL(Enabled, COLOR.TextMuted, COLOR.Text));
    ELSE
      HMI_TextBox(Left + 10, Top + 22, Width - 20, Height - 28, Placeholder, 16, HMI_FONT#Regular, HMI_ALIGN#Left,
        HMI_VALIGN#Middle, COLOR.TextMuted);
    END_IF;
    HMI_Unclip();
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`
