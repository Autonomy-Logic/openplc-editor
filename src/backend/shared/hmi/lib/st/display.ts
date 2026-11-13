/** StandardWidgets ST source: shapes and display widgets. */
export const DISPLAY_ST = `(* Process values are REAL; each widget turns them into a per-mille fill once per frame and draws in integers. *)

(* Position of Value between MinValue and MaxValue, in per-mille (0..1000). *)
FUNCTION HMI_PerMille : DINT
  VAR_INPUT Value, MinValue, MaxValue : REAL; END_VAR
  VAR span : REAL; END_VAR
  span := MaxValue - MinValue;
  IF ABS(span) < 0.0001 OR Value <> Value THEN
    HMI_PerMille := 0;
  ELSE
    HMI_PerMille := REAL_TO_DINT(LIMIT(0.0, (Value - MinValue) * 1000.0 / span, 1000.0));
  END_IF;
END_FUNCTION

(* Filled rectangle, optionally rounded and outlined. *)
{attribute 'hmi_palette' := 'Shapes'}
FUNCTION_BLOCK HmiRect EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_color'}
    Fill : UDINT := COLOR.Surface;
    {attribute 'hmi_color'}
    Border : UDINT := COLOR.Border;
    BorderWidth : DINT := 1;
    Radius : DINT := 8;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 160;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 96;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_FillRect(Left, Top, Width, Height, Radius, Fill);
    IF BorderWidth > 0 THEN
      HMI_StrokeRect(Left, Top, Width, Height, Radius, BorderWidth, Border);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiLabel EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Text : STRING(64) := 'Label';
    Size : DINT := 16;
    Font : HMI_FONT := HMI_FONT#Regular;
    {attribute 'hmi_color'}
    TextColor : UDINT := COLOR.Text;
    Align : HMI_ALIGN := HMI_ALIGN#Left;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := HMI_TextWidth(Text, Size, Font) + 8;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := Size * 3 / 2 + 8;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_TextBox(Left, Top, Width, Height, Text, Size, Font, Align, HMI_VALIGN#Middle, TextColor);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* A number with its caption and unit. *)
{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiValue EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    Decimals : INT := 1;
    Caption : STRING(64) := 'Value';
    Unit : STRING(16);
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Text;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 144;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 64;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_FillRect(Left, Top, Width, Height, 8, COLOR.Surface);
    HMI_StrokeRect(Left, Top, Width, Height, 8, 1, COLOR.Border);
    HMI_Text(Left + 10, Top + 6, Caption, 12, HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
    HMI_TextBox(Left + 10, Top + 22, Width - 20, Height - 28, HMI_FormatValue(Value, Decimals, Unit), 22, HMI_FONT#Bold,
      HMI_ALIGN#Right, HMI_VALIGN#Middle, AccentColor);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Indicator light with a caption. *)
{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiLamp EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    Caption : STRING(64) := 'Lamp';
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Border;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := HMI_TextWidth(Caption, 16, HMI_FONT#Regular) + 52;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 36;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  (* The light keeps its natural 36 lu when the lamp is stretched, centred vertically. *)
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR d, r, cx, cy : DINT; END_VAR
    d := MIN(Height, 36);
    r := MAX(d / 2 - 4, 2);
    cx := Left + d / 2;
    cy := Top + Height / 2;
    IF Value THEN
      HMI_FillCircle(cx, cy, r + 4, HMI_Alpha(OnColor, 13));
    END_IF;
    HMI_FillCircle(cx, cy, r, SEL(Value, OffColor, OnColor));
    HMI_TextBox(Left + d + 8, Top, Width - d - 8, Height, Caption, 16, HMI_FONT#Regular, HMI_ALIGN#Left,
      HMI_VALIGN#Middle, COLOR.Text);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* 270-degree arc gauge; the arc eases toward the value. *)
{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiGauge EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    MinValue : REAL := 0.0;
    MaxValue : REAL := 100.0;
    Decimals : INT := 1;
    Unit : STRING(16) := '%';
    Caption : STRING(64) := 'Gauge';
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
  END_VAR
  VAR
    shownPm : DINT;
    started : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 144;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 144;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR cx, cy, r, pm, th, d : DINT; END_VAR
    pm := HMI_PerMille(Value, MinValue, MaxValue);
    IF NOT started THEN
      shownPm := pm;
      started := TRUE;
    END_IF;
    d := (pm - shownPm) / 4;
    IF d = 0 THEN
      shownPm := pm;
    ELSE
      shownPm := shownPm + d;
    END_IF;
    cx := Left + Width / 2;
    cy := Top + Height / 2 + 6;
    r := MIN(Width, Height) / 2 - 14;
    (* Too small for a dial: the caption alone. *)
    IF r < 8 THEN
      HMI_Text(cx, Top + Height - 18, Caption, 14, HMI_FONT#Regular, HMI_ALIGN#Center, COLOR.TextMuted);
      Draw := TRUE;
      RETURN;
    END_IF;
    th := MAX(6, r / 6);
    HMI_Arc(cx, cy, r, th, 135, 405, COLOR.Fill);
    IF shownPm > 0 THEN
      HMI_Arc(cx, cy, r, th, 135, 135 + 270 * shownPm / 1000, AccentColor);
    END_IF;
    HMI_Text(cx, cy - r / 4, HMI_FormatReal(Value, Decimals), r * 42 / 100, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    HMI_Text(cx, cy + r * 28 / 100, Unit, r * 22 / 100, HMI_FONT#Regular, HMI_ALIGN#Center, COLOR.TextMuted);
    HMI_Text(cx, Top + Height - 18, Caption, 14, HMI_FONT#Regular, HMI_ALIGN#Center, COLOR.TextMuted);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Vertical level bar with the value and a caption. *)
{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiTank EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    MinValue : REAL := 0.0;
    MaxValue : REAL := 100.0;
    Decimals : INT := 1;
    Unit : STRING(16);
    Caption : STRING(64) := 'Tank';
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 80;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 200;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR ih, lh : DINT; END_VAR
    ih := MAX(Height - 28, 0);
    lh := ih * HMI_PerMille(Value, MinValue, MaxValue) / 1000;
    HMI_FillRect(Left, Top, Width, ih, 12, COLOR.Fill);
    HMI_Clip(Left, Top + ih - lh, Width, lh);
    HMI_FillRect(Left, Top, Width, ih, 12, AccentColor);
    HMI_Unclip();
    HMI_StrokeRect(Left, Top, Width, ih, 12, 2, COLOR.Border);
    HMI_TextBox(Left, Top, Width, ih, HMI_FormatValue(Value, Decimals, Unit), 18, HMI_FONT#Bold, HMI_ALIGN#Center,
      HMI_VALIGN#Middle, COLOR.Text);
    HMI_Text(Left + Width / 2, Top + Height - 20, Caption, 14, HMI_FONT#Regular, HMI_ALIGN#Center, COLOR.TextMuted);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Time graph of Value, and of Value2 when Pens = 2, sampled every SampleMs into 120 points. History starts with the
   screen and is not logged. *)
{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiTrend EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    {attribute 'hmi_group' := 'data'}
    Value2 : REAL;
    Pens : INT := 1;
    MinValue : REAL := 0.0;
    MaxValue : REAL := 100.0;
    AutoRange : BOOL;
    SampleMs : UDINT := 1000;
    Caption : STRING(64);
    Decimals : INT := 1;
    Unit : STRING(16);
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
    {attribute 'hmi_color'}
    Color2 : UDINT := COLOR.Success;
  END_VAR
  VAR
    s1, s2 : ARRAY[0..119] OF REAL;
    head, count : INT;
    lastMs : UDINT;
    started : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 280;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 160;
  END_METHOD
  METHOD INTERNAL Sample : BOOL
    VAR now : UDINT; END_VAR
    now := HMI_TimeMs();
    IF started AND now - lastMs < SampleMs THEN
      RETURN;
    END_IF;
    started := TRUE;
    lastMs := now;
    s1[head] := Value;
    s2[head] := Value2;
    head := (head + 1) MOD 120;
    IF count < 120 THEN
      count := count + 1;
    END_IF;
    Sample := TRUE;
  END_METHOD
  (* One pen as polylines of at most 64 points, the core's polygon limit, each starting where the last ended. *)
  METHOD INTERNAL Pen : BOOL
    VAR_INPUT Which : INT; Lo, Hi : REAL; PX, PY, PW, PH : DINT; C : UDINT; END_VAR
    VAR i, k, idx, n : INT; v : REAL; END_VAR
    IF count < 2 THEN
      RETURN;
    END_IF;
    i := 0;
    WHILE i < count - 1 DO
      HMI_PolyBegin(C);
      n := MIN(64, count - i);
      FOR k := 0 TO n - 1 DO
        idx := (head - count + i + k + 240) MOD 120;
        IF Which = 2 THEN
          v := s2[idx];
        ELSE
          v := s1[idx];
        END_IF;
        HMI_PolyPoint(PX + PW * INT_TO_DINT(i + k) / 119, PY + PH - PH * HMI_PerMille(v, Lo, Hi) / 1000);
      END_FOR;
      HMI_PolyStroke(2, FALSE);
      i := i + n - 1;
    END_WHILE;
    Pen := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR lo, hi : REAL; i, k : INT; px, py, pw, ph, capH, g : DINT; END_VAR
    Sample();
    lo := MinValue;
    hi := MaxValue;
    IF AutoRange AND count > 0 THEN
      lo := s1[(head + 119) MOD 120];
      hi := lo;
      FOR i := 0 TO count - 1 DO
        k := (head - count + i + 240) MOD 120;
        lo := MIN(lo, s1[k]);
        hi := MAX(hi, s1[k]);
        IF Pens = 2 THEN
          lo := MIN(lo, s2[k]);
          hi := MAX(hi, s2[k]);
        END_IF;
      END_FOR;
      IF hi - lo < 0.0001 THEN
        hi := lo + 1.0;
      END_IF;
    END_IF;
    HMI_FillRect(Left, Top, Width, Height, 8, COLOR.Surface);
    HMI_StrokeRect(Left, Top, Width, Height, 8, 1, COLOR.Border);
    IF LEN(Caption) > 0 THEN
      capH := 20;
      HMI_Text(Left + 10, Top + 6, Caption, 12, HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
      HMI_Text(Left + Width - 10, Top + 6, HMI_FormatValue(Value, Decimals, Unit), 12, HMI_FONT#Bold, HMI_ALIGN#Right,
        AccentColor);
    END_IF;
    px := Left + 44;
    py := Top + 10 + capH;
    pw := Width - 54;
    ph := Height - 20 - capH;
    IF pw < 8 OR ph < 8 THEN
      Draw := TRUE;
      RETURN;
    END_IF;
    FOR g := 0 TO 4 DO
      HMI_Line(px, py + ph * g / 4, px + pw, py + ph * g / 4, 1, COLOR.Fill);
    END_FOR;
    HMI_Text(px - 6, py - 6, HMI_FormatReal(hi, Decimals), 10, HMI_FONT#Regular, HMI_ALIGN#Right, COLOR.TextMuted);
    HMI_Text(px - 6, py + ph - 6, HMI_FormatReal(lo, Decimals), 10, HMI_FONT#Regular, HMI_ALIGN#Right, COLOR.TextMuted);
    HMI_Clip(px, py - 2, pw + 1, ph + 4);
    Pen(1, lo, hi, px, py, pw, ph, AccentColor);
    IF Pens = 2 THEN
      Pen(2, lo, hi, px, py, pw, ph, Color2);
    END_IF;
    HMI_Unclip();
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Framed number with a unit, the small readouts of process diagrams; Caption is drawn above when set. *)
{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiReadout EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    Decimals : INT := 1;
    Unit : STRING(16);
    Caption : STRING(64);
    Size : DINT := 12;
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
  END_VAR
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := Size + 4;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(MAX(HMI_TextWidth(HMI_FormatValue(Value, Decimals, Unit), Size, HMI_FONT#Regular),
      HMI_TextWidth(Caption, Size, HMI_FONT#Bold)) + 14, 56);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := Size + 8 + CapH();
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    IF Port = HMI_PORT#Top THEN
      PortY := Top + CapH();
    ELSIF Port = HMI_PORT#Bottom THEN
      PortY := Top + Height;
    ELSE
      PortY := Top + CapH() + (Height - CapH()) / 2;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR boxTop : DINT; END_VAR
    boxTop := Top + CapH();
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, Top, Caption, Size, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    HMI_FillRect(Left, boxTop, Width, Height - CapH(), 2, COLOR.Surface);
    HMI_StrokeRect(Left, boxTop, Width, Height - CapH(), 2, 1, COLOR.Border);
    HMI_TextBox(Left, boxTop, Width, Height - CapH(), HMI_FormatValue(Value, Decimals, Unit), Size, HMI_FONT#Regular,
      HMI_ALIGN#Center, HMI_VALIGN#Middle, AccentColor);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Cylindrical vessel with its label block (caption, level, rate) and capacity badge. *)
{attribute 'hmi_palette' := 'Display'}
FUNCTION_BLOCK HmiVessel EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    MinValue : REAL := 0.0;
    MaxValue : REAL := 100.0;
    Decimals : INT := 1;
    Unit : STRING(16);
    Caption : STRING(64) := 'Vessel';
    (* Second readout under the level, shown when RateUnit is set. *)
    {attribute 'hmi_group' := 'data'}
    Rate : REAL;
    RateUnit : STRING(16);
    Capacity : STRING(32);
    ShowLabels : BOOL := TRUE;
    {attribute 'hmi_color'}
    Fill : UDINT := COLOR.Fill;
    {attribute 'hmi_color'}
    AccentColor : UDINT := COLOR.Accent;
  END_VAR
  METHOD INTERNAL LabelH : DINT
    IF NOT ShowLabels THEN
      LabelH := 0;
    ELSIF LEN(RateUnit) > 0 THEN
      LabelH := 52;
    ELSE
      LabelH := 35;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 100;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := LabelH() + 70;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  (* Ports sit on the body, not on the label block. *)
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    VAR bt : DINT; END_VAR
    bt := Top + LabelH();
    IF Port = HMI_PORT#Top THEN
      PortY := bt;
    ELSIF Port = HMI_PORT#Bottom THEN
      PortY := Top + Height;
    ELSE
      PortY := bt + (Top + Height - bt) / 2;
    END_IF;
  END_METHOD
  METHOD INTERNAL Badge : BOOL
    VAR_INPUT BoxY : DINT; Txt : STRING; END_VAR
    VAR bw : DINT; END_VAR
    bw := MAX(HMI_TextWidth(Txt, 11, HMI_FONT#Regular) + 12, 58);
    HMI_FillRect(Left + (Width - bw) / 2, BoxY, bw, 15, 1, COLOR.Surface);
    HMI_StrokeRect(Left + (Width - bw) / 2, BoxY, bw, 15, 1, 1, COLOR.Border);
    HMI_TextBox(Left, BoxY, Width, 15, Txt, 11, HMI_FONT#Regular, HMI_ALIGN#Center, HMI_VALIGN#Middle, AccentColor);
    Badge := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR bt, bb, e, cx, pm, ly, bw, a : DINT; END_VAR
    IF ShowLabels THEN
      HMI_Text(Left + Width / 2, Top, Caption, 12, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
      Badge(Top + 17, HMI_FormatValue(Value, Decimals, Unit));
      IF LEN(RateUnit) > 0 THEN
        Badge(Top + 34, HMI_FormatValue(Rate, Decimals, RateUnit));
      END_IF;
    END_IF;
    bt := Top + LabelH();
    bb := Top + Height;
    e := MAX(MIN(Width * 13 / 100, (bb - bt) / 5), 1);
    cx := Left + Width / 2;
    pm := HMI_PerMille(Value, MinValue, MaxValue);
    (* Body, then the liquid: its column, the front half of the bottom and its surface at the level. *)
    HMI_FillRect(Left, bt + e, Width, bb - bt - 2 * e, 0, Fill);
    HMI_FillEllipse(cx, bb - e, Width / 2, e, Fill);
    IF pm > 0 THEN
      ly := bb - e - (bb - bt - 2 * e) * pm / 1000;
      HMI_FillRect(Left, ly, Width, bb - e - ly, 0, AccentColor);
      HMI_FillEllipse(cx, bb - e, Width / 2, e, AccentColor);
      HMI_FillEllipse(cx, ly, Width / 2, e, AccentColor);
      HMI_FillEllipse(cx, ly, Width / 2, e, HMI_Alpha(COLOR.White, 30));
    END_IF;
    (* Outline: the open top, the sides and the front of the bottom. *)
    HMI_FillEllipse(cx, bt + e, Width / 2, e * 92 / 100, COLOR.Border);
    HMI_StrokeEllipse(cx, bt + e, Width / 2, e, 1, COLOR.TextMuted);
    HMI_Line(Left, bt + e, Left, bb - e, 1, COLOR.TextMuted);
    HMI_Line(Left + Width, bt + e, Left + Width, bb - e, 1, COLOR.TextMuted);
    HMI_PolyBegin(COLOR.TextMuted);
    FOR a := 0 TO 12 DO
      HMI_PolyPoint(cx + HMI_Cos(a * 15, Width / 2), bb - e + HMI_Sin(a * 15, e));
    END_FOR;
    HMI_PolyStroke(1, FALSE);
    IF LEN(Capacity) > 0 THEN
      bw := HMI_TextWidth(Capacity, 9, HMI_FONT#Regular) + 8;
      HMI_FillRect(cx - bw / 2, bb - e - 15, bw, 12, 1, COLOR.Surface);
      HMI_TextBox(cx - bw / 2, bb - e - 15, bw, 12, Capacity, 9, HMI_FONT#Regular, HMI_ALIGN#Center, HMI_VALIGN#Middle,
        COLOR.Text);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`
