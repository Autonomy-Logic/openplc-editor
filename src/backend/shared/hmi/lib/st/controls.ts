/** StandardWidgets ST source: controls. Two-way controls report an operator change as Changed with NewValue. */
export const CONTROLS_ST = `(* Push button: Pressed while held, Clicked for one frame when released on the button, Changed for one frame when
   Pressed changes, so a wired variable is written on press and release only. *)
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
    Changed : BOOL;
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
  METHOD PROTECTED OVERRIDE Input : BOOL
    Clicked := FALSE;
    Changed := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      Changed := Pressed;
      Pressed := FALSE;
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      Changed := NOT Pressed;
      Pressed := TRUE;
      HMI_PtrConsume();
      Input := TRUE;
    ELSIF Pressed AND NOT HMI_PtrDown() THEN
      Pressed := FALSE;
      Changed := TRUE;
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
    {attribute 'hmi_range' := 'MinValue..MaxValue'}
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
      v := LIMIT(MIN(MinValue, MaxValue), v, MAX(MinValue, MaxValue));
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

(* Numeric entry: a tap opens the on-screen keyboard; OK delivers NewValue with Changed for one frame, unless the
   entry is not a finite number. *)
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
  METHOD PROTECTED OVERRIDE Input : BOOL
    VAR_TEMP entry : STRING; END_VAR
    Changed := FALSE;
    Clicked := FALSE;
    IF KeyboardTake() THEN
      entry := KeyboardText();
      NewValue := HMI_ParseReal(entry, 0.0);
      Changed := NewValue = HMI_ParseReal(entry, 1.0);
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
    {attribute 'hmi_max_length' := 'MaxLength'}
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

(* Latching button: shows Value as on or off; a tap asks for the opposite (Changed, NewValue) and sets Clicked. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiToggleButton EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    OnText : STRING(64) := 'ON';
    OffText : STRING(64) := 'OFF';
    Radius : DINT := 8;
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
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
    NaturalWidth := MAX(HMI_TextWidth(OnText, 15, HMI_FONT#Bold), HMI_TextWidth(OffText, 15, HMI_FONT#Bold)) + 64;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 44;
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
    VAR fill, dot, tc : UDINT; END_VAR
    IF Value THEN
      fill := OnColor;
      dot := COLOR.OnAccent;
      tc := COLOR.OnAccent;
    ELSE
      fill := COLOR.Surface;
      dot := COLOR.Border;
      tc := COLOR.TextMuted;
    END_IF;
    IF NOT Enabled THEN
      fill := HMI_Alpha(fill, 50);
    END_IF;
    HMI_FillRect(Left, Top, Width, Height, Radius, fill);
    IF NOT Value THEN
      HMI_StrokeRect(Left, Top, Width, Height, Radius, 1, COLOR.Border);
    END_IF;
    HMI_FillCircle(Left + 20, Top + Height / 2, 5, dot);
    HMI_TextBox(Left + 30, Top, Width - 40, Height, SEL(Value, OffText, OnText), 15, HMI_FONT#Bold, HMI_ALIGN#Center,
      HMI_VALIGN#Middle, tc);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Round push button with a light: Pressed while held, Clicked when released on it; Lamp, usually the machine's
   feedback, lights it. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiLampButton EXTENDS HmiElement
  VAR_INPUT
    Lamp : BOOL;
    Text : STRING(16) := 'START';
    {attribute 'hmi_color'}
    LampColor : UDINT := COLOR.Success;
  END_VAR
  VAR_OUTPUT
    {attribute 'hmi_main'}
    Pressed : BOOL;
    Clicked : BOOL;
    Changed : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 64;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 64;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    Clicked := FALSE;
    Changed := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      Changed := Pressed;
      Pressed := FALSE;
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      Changed := NOT Pressed;
      Pressed := TRUE;
      HMI_PtrConsume();
      Input := TRUE;
    ELSIF Pressed AND NOT HMI_PtrDown() THEN
      Pressed := FALSE;
      Changed := TRUE;
      Clicked := PointerOver();
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR cx, cy, r, ri : DINT; face, tc : UDINT; END_VAR
    cx := Left + Width / 2;
    cy := Top + Height / 2;
    r := MAX(MIN(Width, Height) / 2 - 1, 6);
    ri := r * 4 / 5;
    IF Lamp THEN
      HMI_FillCircle(cx, cy, r, HMI_Alpha(LampColor, 25));
      face := SEL(Pressed, LampColor, HMI_Alpha(LampColor, 75));
      tc := COLOR.OnAccent;
    ELSE
      HMI_FillCircle(cx, cy, r, COLOR.Fill);
      face := SEL(Pressed, COLOR.Surface, COLOR.Fill);
      tc := COLOR.Text;
    END_IF;
    IF NOT Enabled THEN
      face := HMI_Alpha(face, 50);
    END_IF;
    HMI_FillCircle(cx, cy, ri, face);
    IF NOT Lamp THEN
      HMI_StrokeCircle(cx, cy, ri, 1, COLOR.Border);
    END_IF;
    HMI_TextBox(cx - ri, cy - ri, ri * 2, ri * 2, Text, MAX(r * 3 / 8, 9), HMI_FONT#Bold, HMI_ALIGN#Center,
      HMI_VALIGN#Middle, tc);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Rotary selector of two or three positions named in Positions; a tap on a side turns it one step that way, and with
   two positions any tap turns it. Changed and NewValue carry the position asked for. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiSelector EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    {attribute 'hmi_preview' := '1'}
    Value : INT;
    Positions : STRING(64) := 'HAND;OFF;AUTO';
    {attribute 'hmi_color'}
    KnobColor : UDINT := COLOR.Text;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    {attribute 'hmi_range' := '0..2'}
    NewValue : INT;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD INTERNAL Count : INT
    Count := LIMIT(2, HMI_ListCount(Positions), 3);
  END_METHOD
  (* Angle of position I, in degrees clockwise from twelve. *)
  METHOD INTERNAL Angle : DINT
    VAR_INPUT I : INT; END_VAR
    IF Count() = 2 THEN
      Angle := SEL(I > 0, -45, 45);
    ELSE
      Angle := (INT_TO_DINT(LIMIT(0, I, 2)) - 1) * 45;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 112;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 84;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    VAR v : INT; END_VAR
    Changed := FALSE;
    Clicked := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      Clicked := TRUE;
      IF Count() = 2 THEN
        v := SEL(Value = 0, 0, 1);
      ELSIF HMI_PtrX() < Left + Width / 2 THEN
        v := MAX(Value - 1, 0);
      ELSE
        v := MIN(Value + 1, 2);
      END_IF;
      IF v <> Value THEN
        NewValue := v;
        Changed := TRUE;
      END_IF;
      Input := TRUE;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR cx, cy, kr, lr, a, dx, dy : DINT; i : INT; align : HMI_ALIGN; on : BOOL; END_VAR
    kr := MAX(MIN(Width / 5, (Height - 34) / 2), 8);
    cx := Left + Width / 2;
    cy := Top + Height - kr - 2;
    lr := kr + 14;
    FOR i := 0 TO Count() - 1 DO
      a := Angle(i);
      on := i = Value;
      align := HMI_ALIGN#Center;
      IF a < 0 THEN
        align := HMI_ALIGN#Right;
      ELSIF a > 0 THEN
        align := HMI_ALIGN#Left;
      END_IF;
      HMI_Text(cx + HMI_Sin(a, lr), cy - HMI_Cos(a, lr) - 12, HMI_ListItem(Positions, i), 11,
        SEL(on, HMI_FONT#Regular, HMI_FONT#Bold), align, SEL(on, COLOR.TextMuted, COLOR.Accent));
    END_FOR;
    HMI_FillCircle(cx, cy, kr, COLOR.Surface);
    HMI_StrokeCircle(cx, cy, kr, 1, COLOR.Border);
    a := Angle(Value);
    dx := HMI_Sin(a, kr - 3);
    dy := HMI_Cos(a, kr - 3);
    HMI_Line(cx - dx, cy + dy, cx + dx, cy - dy, MAX(kr / 2, 4), SEL(Enabled, HMI_Alpha(KnobColor, 50), KnobColor));
    HMI_Line(cx + HMI_Sin(a, kr / 4), cy - HMI_Cos(a, kr / 4), cx + HMI_Sin(a, kr * 3 / 4), cy - HMI_Cos(a, kr * 3 / 4),
      MAX(kr / 7, 2), COLOR.Surface);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Row of buttons naming the values in Options, the one for Value selected; a tap asks for that one (Changed,
   NewValue). *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiOptionButtons EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    {attribute 'hmi_preview' := '1'}
    Value : INT;
    Options : STRING(160) := 'Manual;Auto;Off';
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    {attribute 'hmi_range' := '0..last(Options)'}
    NewValue : INT;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD INTERNAL Count : INT
    Count := MAX(HMI_ListCount(Options), 1);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    VAR i : INT; w : DINT; END_VAR
    FOR i := 0 TO Count() - 1 DO
      w := MAX(w, HMI_TextWidth(HMI_ListItem(Options, i), 14, HMI_FONT#Bold));
    END_FOR;
    NaturalWidth := (w + 28) * Count();
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 40;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    VAR v : INT; END_VAR
    Changed := FALSE;
    Clicked := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      Clicked := TRUE;
      v := DINT_TO_INT(LIMIT(0, (HMI_PtrX() - Left) * Count() / MAX(Width, 1), Count() - 1));
      IF v <> Value THEN
        NewValue := v;
        Changed := TRUE;
      END_IF;
      Input := TRUE;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR i, n : INT; x, w : DINT; sel : BOOL; c : UDINT; END_VAR
    n := Count();
    c := SEL(Enabled, HMI_Alpha(AccentColor, 50), AccentColor);
    HMI_FillRect(Left, Top, Width, Height, 8, COLOR.Surface);
    HMI_StrokeRect(Left, Top, Width, Height, 8, 1, COLOR.Border);
    FOR i := 0 TO n - 1 DO
      x := Left + Width * i / n;
      w := Left + Width * (i + 1) / n - x;
      sel := i = Value;
      IF sel THEN
        HMI_FillRect(x + 3, Top + 3, w - 6, Height - 6, 6, c);
      ELSIF i > 0 AND i - 1 <> Value THEN
        HMI_FillRect(x, Top + 8, 1, Height - 16, 0, COLOR.Border);
      END_IF;
      HMI_TextBox(x, Top, w, Height, HMI_ListItem(Options, i), 14, SEL(sel, HMI_FONT#Regular, HMI_FONT#Bold),
        HMI_ALIGN#Center, HMI_VALIGN#Middle, SEL(sel, COLOR.Text, COLOR.OnAccent));
    END_FOR;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Drop-down list of Options showing the one for Value; a tap opens the list over the screen, a tap on an item asks
   for it (Changed, NewValue) and a tap elsewhere closes it. A long list scrolls by dragging. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiDropDown EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    {attribute 'hmi_preview' := '0'}
    Value : INT;
    Options : STRING(160) := 'Option 1;Option 2;Option 3';
    Caption : STRING(64) := 'Select';
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    {attribute 'hmi_range' := '0..last(Options)'}
    NewValue : INT;
  END_VAR
  VAR
    (* Item picked in the list, delivered by the next Input; -1 for none. *)
    picked : INT := -1;
    first : INT;
    pressY, pressFirst : DINT;
    pressing, dragged : BOOL;
    lx, ly, lw, lh, rows : DINT;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 180;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 60;
  END_METHOD
  METHOD INTERNAL RowH : DINT
    RowH := 32;
  END_METHOD
  (* Where the list goes: under the field, or over it when there is more room there. *)
  METHOD INTERNAL Arrange : BOOL
    VAR n, below, above, room : DINT; END_VAR
    n := INT_TO_DINT(HMI_ListCount(Options));
    below := HMI_ScreenH() - (Top + Height + 4) - 4;
    above := Top - 8;
    room := SEL(n * RowH() + 8 <= below OR below >= above, above, below);
    rows := LIMIT(1, (room - 8) / RowH(), MAX(n, 1));
    lw := Width;
    lx := Left;
    lh := rows * RowH() + 8;
    IF room = below THEN
      ly := Top + Height + 4;
    ELSE
      ly := Top - 4 - lh;
    END_IF;
    first := DINT_TO_INT(LIMIT(0, INT_TO_DINT(first), MAX(n - rows, 0)));
    Arrange := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    Changed := FALSE;
    Clicked := FALSE;
    IF picked >= 0 THEN
      NewValue := picked;
      Changed := picked <> Value;
      picked := -1;
    END_IF;
    IF NOT Visible OR NOT Enabled THEN
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      Clicked := TRUE;
      first := MAX(Value - 2, 0);
      pressing := FALSE;
      SetPopup(TRUE);
      Input := TRUE;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PopupInput : BOOL
    VAR inside : BOOL; row : DINT; END_VAR
    Arrange();
    IF HMI_PtrPressed() THEN
      HMI_PtrConsume();
      inside := HMI_Hit(lx, ly, lw, lh);
      IF NOT inside THEN
        SetPopup(FALSE);
      ELSE
        pressing := TRUE;
        dragged := FALSE;
        pressY := HMI_PtrY();
        pressFirst := INT_TO_DINT(first);
      END_IF;
      PopupInput := TRUE;
      RETURN;
    END_IF;
    IF NOT pressing THEN
      RETURN;
    END_IF;
    IF HMI_PtrDown() THEN
      IF HMI_PtrY() <> -1000000000 AND ABS(HMI_PtrY() - pressY) > RowH() / 2 THEN
        dragged := TRUE;
      END_IF;
      IF dragged THEN
        first := DINT_TO_INT(pressFirst - (HMI_PtrY() - pressY) / RowH());
        Arrange();
      END_IF;
    ELSE
      pressing := FALSE;
      IF NOT dragged THEN
        row := (pressY - ly - 4) / RowH();
        IF row >= 0 AND row < rows THEN
          picked := DINT_TO_INT(INT_TO_DINT(first) + row);
          SetPopup(FALSE);
        END_IF;
      END_IF;
    END_IF;
    PopupInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR cx, cy : DINT; END_VAR
    HMI_FillRect(Left, Top, Width, Height, 8, COLOR.Surface);
    IF PopupOpen() THEN
      HMI_StrokeRect(Left, Top, Width, Height, 8, 2, COLOR.Accent);
    ELSE
      HMI_StrokeRect(Left, Top, Width, Height, 8, 1, COLOR.Border);
    END_IF;
    HMI_Text(Left + 10, Top + 6, Caption, 12, HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
    HMI_TextBox(Left + 10, Top + 22, Width - 40, Height - 28, HMI_ListItem(Options, Value), 16, HMI_FONT#Regular,
      HMI_ALIGN#Left, HMI_VALIGN#Middle, SEL(Enabled, COLOR.TextMuted, COLOR.Text));
    cx := Left + Width - 18;
    cy := Top + 22 + (Height - 28) / 2;
    IF PopupOpen() THEN
      HMI_Line(cx - 6, cy + 3, cx, cy - 3, 2, COLOR.TextMuted);
      HMI_Line(cx, cy - 3, cx + 6, cy + 3, 2, COLOR.TextMuted);
    ELSE
      HMI_Line(cx - 6, cy - 3, cx, cy + 3, 2, COLOR.TextMuted);
      HMI_Line(cx, cy + 3, cx + 6, cy - 3, 2, COLOR.TextMuted);
    END_IF;
    Draw := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE DrawPopup : BOOL
    VAR r, item, n, ry : DINT; on : BOOL; END_VAR
    Arrange();
    n := INT_TO_DINT(HMI_ListCount(Options));
    HMI_FillRect(lx, ly, lw, lh, 8, COLOR.Surface);
    HMI_StrokeRect(lx, ly, lw, lh, 8, 1, COLOR.Border);
    FOR r := 0 TO rows - 1 DO
      item := INT_TO_DINT(first) + r;
      ry := ly + 4 + r * RowH();
      on := item = INT_TO_DINT(Value);
      IF on THEN
        HMI_FillRect(lx + 4, ry, lw - 8, RowH(), 6, HMI_Alpha(COLOR.Accent, 12));
      END_IF;
      HMI_TextBox(lx + 12, ry, lw - 24, RowH(), HMI_ListItem(Options, DINT_TO_INT(item)), 15,
        SEL(on, HMI_FONT#Regular, HMI_FONT#Bold), HMI_ALIGN#Left, HMI_VALIGN#Middle, SEL(on, COLOR.Text, COLOR.Accent));
    END_FOR;
    IF n > rows THEN
      HMI_FillRect(lx + lw - 6, ly + 4 + (lh - 8) * INT_TO_DINT(first) / n, 3, MAX((lh - 8) * rows / n, 6), 1,
        COLOR.Border);
    END_IF;
    DrawPopup := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Minus and plus buttons around Value: a tap steps it by Step within MinValue and MaxValue, holding repeats.
   Changed and NewValue carry each step. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiStepper EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    Step : REAL := 1.0;
    MinValue : REAL := 0.0;
    MaxValue : REAL := 100.0;
    Decimals : INT := 0;
    Unit : STRING(16);
    Caption : STRING(64);
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    {attribute 'hmi_range' := 'MinValue..MaxValue'}
    NewValue : REAL;
  END_VAR
  VAR
    (* Button held: -1 minus, 1 plus, 0 none. *)
    held : INT;
    heldAt : UDINT;
    repeats : UDINT;
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
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 200;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 44 + CapH();
  END_METHOD
  METHOD INTERNAL Side : DINT
    Side := MIN(Height - CapH(), Width / 3);
  END_METHOD
  METHOD INTERNAL StepOnce : BOOL
    VAR v : REAL; END_VAR
    v := LIMIT(MinValue, sent + INT_TO_REAL(held) * Step, MaxValue);
    IF v <> sent THEN
      sent := v;
      NewValue := v;
      Changed := TRUE;
    END_IF;
    StepOnce := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    Changed := FALSE;
    Clicked := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      held := 0;
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      Clicked := TRUE;
      IF HMI_PtrX() < Left + Side() THEN
        held := -1;
      ELSIF HMI_PtrX() >= Left + Width - Side() THEN
        held := 1;
      END_IF;
      IF held <> 0 THEN
        sent := Value;
        heldAt := HMI_TimeMs();
        repeats := 0;
        StepOnce();
      END_IF;
      Input := TRUE;
    ELSIF held <> 0 THEN
      IF NOT HMI_PtrDown() THEN
        held := 0;
      ELSIF HMI_TimeMs() - heldAt >= 500 + repeats * 150 THEN
        repeats := repeats + 1;
        StepOnce();
      END_IF;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR s, y, cx, cy, t : DINT; shown : REAL; minus, plus : UDINT; END_VAR
    s := Side();
    y := Top + CapH();
    t := MAX(s / 14, 2);
    IF CapH() > 0 THEN
      HMI_Text(Left, Top, Caption, 13, HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
    END_IF;
    shown := Value;
    IF held <> 0 THEN
      shown := sent;
    END_IF;
    minus := SEL(held = -1, COLOR.Fill, COLOR.Border);
    plus := SEL(held = 1, AccentColor, HMI_Alpha(AccentColor, 75));
    IF NOT Enabled OR shown <= MinValue THEN
      minus := HMI_Alpha(COLOR.Fill, 50);
    END_IF;
    IF NOT Enabled OR shown >= MaxValue THEN
      plus := HMI_Alpha(AccentColor, 40);
    END_IF;
    HMI_FillRect(Left, y, s, s, 8, minus);
    cx := Left + s / 2;
    cy := y + s / 2;
    HMI_FillRect(cx - s / 5, cy - t / 2, s * 2 / 5, t, 1, COLOR.Text);
    HMI_FillRect(Left + Width - s, y, s, s, 8, plus);
    cx := Left + Width - s / 2;
    HMI_FillRect(cx - s / 5, cy - t / 2, s * 2 / 5, t, 1, COLOR.OnAccent);
    HMI_FillRect(cx - t / 2, cy - s / 5, t, s * 2 / 5, 1, COLOR.OnAccent);
    HMI_FillRect(Left + s + 4, y, Width - s * 2 - 8, s, 6, COLOR.Surface);
    HMI_StrokeRect(Left + s + 4, y, Width - s * 2 - 8, s, 6, 1, COLOR.Border);
    HMI_TextBox(Left + s + 4, y, Width - s * 2 - 8, s, HMI_FormatValue(shown, Decimals, Unit), 16, HMI_FONT#Bold,
      HMI_ALIGN#Center, HMI_VALIGN#Middle, SEL(Enabled, COLOR.TextMuted, COLOR.Text));
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Knob between MinValue and MaxValue over a 270-degree arc; dragging round it sets the value, Step > 0 snaps.
   Changed and NewValue while dragging, Clicked on release. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiKnob EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    MinValue : REAL := 0.0;
    MaxValue : REAL := 100.0;
    Step : REAL := 0.0;
    Decimals : INT := 0;
    Unit : STRING(16) := '%';
    Caption : STRING(64) := 'Speed';
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    {attribute 'hmi_range' := 'MinValue..MaxValue'}
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
      CapH := 18;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 100;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 100 + CapH();
  END_METHOD
  METHOD INTERNAL Radius : DINT
    Radius := MAX(MIN(Width, Height - CapH()) / 2 - 4, 10);
  END_METHOD
  METHOD INTERNAL Cy : DINT
    Cy := Top + (Height - CapH()) / 2;
  END_METHOD
  (* Per mille along the arc of the pointer's direction from the centre; the gap at the bottom goes to the nearer end. *)
  METHOD INTERNAL PmAtPointer : DINT
    VAR dx, dy, deg : REAL; rel : DINT; END_VAR
    dx := DINT_TO_REAL(HMI_PtrX() - (Left + Width / 2));
    dy := DINT_TO_REAL(HMI_PtrY() - Cy());
    IF dx = 0.0 AND dy = 0.0 THEN
      PmAtPointer := dragPm;
      RETURN;
    END_IF;
    IF dx = 0.0 THEN
      deg := SEL(dy > 0.0, 270.0, 90.0);
    ELSE
      deg := ATAN(dy / dx) * 57.29578;
      IF dx < 0.0 THEN
        deg := deg + 180.0;
      END_IF;
    END_IF;
    rel := REAL_TO_DINT(deg) - 135;
    WHILE rel < 0 DO
      rel := rel + 360;
    END_WHILE;
    rel := rel MOD 360;
    IF rel > 270 THEN
      rel := SEL(rel < 315, 0, 270);
    END_IF;
    PmAtPointer := rel * 1000 / 270;
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
      dragPm := HMI_PerMille(Value, MinValue, MaxValue);
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
      v := LIMIT(MIN(MinValue, MaxValue), v, MAX(MinValue, MaxValue));
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
    VAR pm, cx, cy, r, th, ri, a, rm : DINT; shown : REAL; c : UDINT; END_VAR
    shown := Value;
    IF dragging THEN
      pm := dragPm;
      shown := sent;
    ELSE
      pm := HMI_PerMille(Value, MinValue, MaxValue);
    END_IF;
    cx := Left + Width / 2;
    cy := Cy();
    r := Radius();
    th := MAX(r / 7, 4);
    ri := r * 7 / 10;
    c := SEL(Enabled, HMI_Alpha(AccentColor, 50), AccentColor);
    HMI_Arc(cx, cy, r - th / 2, th, 135, 405, COLOR.Fill);
    IF pm > 0 THEN
      HMI_Arc(cx, cy, r - th / 2, th, 135, 135 + 270 * pm / 1000, c);
    END_IF;
    HMI_FillCircle(cx, cy, ri, COLOR.Surface);
    HMI_StrokeCircle(cx, cy, ri, 1, COLOR.Border);
    a := 135 + 270 * pm / 1000;
    rm := ri - MAX(r / 6, 5);
    HMI_FillCircle(cx + HMI_Cos(a, rm), cy + HMI_Sin(a, rm), MAX(r / 10, 3), c);
    HMI_TextBox(cx - ri, cy - ri / 2, ri * 2, ri, HMI_FormatValue(shown, Decimals, Unit), MAX(r * 2 / 5, 10),
      HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, COLOR.Text);
    IF CapH() > 0 THEN
      HMI_TextBox(Left, Top + Height - CapH(), Width, CapH(), Caption, 12, HMI_FONT#Regular, HMI_ALIGN#Center,
        HMI_VALIGN#Middle, COLOR.TextMuted);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Check box with a caption. Value shows the wired state; a tap asks for the opposite (Changed, NewValue). *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiCheckBox EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    Caption : STRING(64) := 'Check box';
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
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
    NaturalWidth := HMI_TextWidth(Caption, 15, HMI_FONT#Regular) + 36;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 32;
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
    VAR x, y : DINT; c : UDINT; END_VAR
    x := Left + 1;
    y := Top + Height / 2 - 11;
    c := SEL(Enabled, HMI_Alpha(AccentColor, 50), AccentColor);
    IF Value THEN
      HMI_FillRect(x, y, 22, 22, 5, c);
      HMI_Line(x + 5, y + 11, x + 9, y + 15, 3, COLOR.OnAccent);
      HMI_Line(x + 9, y + 15, x + 17, y + 6, 3, COLOR.OnAccent);
    ELSE
      HMI_FillRect(x, y, 22, 22, 5, COLOR.Surface);
      HMI_StrokeRect(x, y, 22, 22, 5, 1, COLOR.Border);
    END_IF;
    HMI_TextBox(Left + 32, Top, Width - 32, Height, Caption, 15, HMI_FONT#Regular, HMI_ALIGN#Left, HMI_VALIGN#Middle,
      SEL(Enabled, COLOR.TextMuted, COLOR.Text));
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`
