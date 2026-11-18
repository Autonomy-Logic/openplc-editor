/** StandardWidgets ST source: process symbols for diagrams. */
export const PROCESS_ST = `(* Centrifugal pump with its motor on a base: OnColor running, OffColor stopped, FaultColor on fault. The suction is at
   the casing's end and the discharge on top; the motor is on the right unless MotorLeft. A tap asks for the opposite
   state. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiPump EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    {attribute 'hmi_group' := 'data'}
    Fault : BOOL;
    Caption : STRING(64);
    MotorLeft : BOOL;
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
    {attribute 'hmi_color'}
    FaultColor : UDINT := COLOR.Danger;
    (* Turns the rotor while running. *)
    Animate : BOOL := TRUE;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    NewValue : BOOL;
  END_VAR
  VAR
    spin : HmiAnimator;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 15;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(72, HMI_TextWidth(Caption, 11, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 48 + CapH();
  END_METHOD
  (* Fits the drawing, 120 x 80 reference units with the motor on the left, under the caption. *)
  METHOD INTERNAL Layout : BOOL
    Fit(1200, 800, Left, Top + CapH(), Width, Height - CapH(), NOT MotorLeft, FALSE);
    Layout := TRUE;
  END_METHOD
  (* Discharge flange on top, suction flange at the casing's end, the motor's end opposite, the base below. *)
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    IF Port = HMI_PORT#Top OR Port = HMI_PORT#Bottom THEN
      PortX := PX(880, 440);
    ELSIF (Port = HMI_PORT#Left) = MotorLeft THEN
      PortX := PX(60, 440);
    ELSE
      PortX := PX(1190, 440);
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    IF Port = HMI_PORT#Top THEN
      PortY := PY(880, 170);
    ELSIF Port = HMI_PORT#Bottom THEN
      PortY := PY(880, 730);
    ELSE
      PortY := PY(880, 440);
    END_IF;
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
    VAR c : UDINT; x : DINT; END_VAR
    c := OffColor;
    IF Fault THEN
      c := FaultColor;
    ELSIF Value THEN
      c := OnColor;
    END_IF;
    Layout();
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, PY(0, 160) - CapH(), Caption, 11, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    spin(Run := Value AND NOT Fault AND Animate, Rate := -360);
    Part(60, 660, 1080, 70, 20, COLOR.Gray, TRUE);
    Part(100, 260, 540, 360, 60, c, FALSE);
    ShadeBelow(100, 260, 540, 360, 60, 500);
    FOR x := 180 TO 560 BY 60 DO
      Seg(x, 290, x, 590, 20, Shade());
    END_FOR;
    Edge(100, 260, 540, 360, 60);
    Part(60, 300, 60, 280, 20, c, TRUE);
    Part(260, 200, 180, 70, 20, c, TRUE);
    Part(640, 380, 80, 120, 10, COLOR.Border, TRUE);
    Disc(880, 440, 180, c, TRUE);
    Disc(880, 440, 110, c, TRUE);
    Spokes(880, 440, 90, 3, spin.Phase);
    Part(820, 200, 120, 70, 10, c, TRUE);
    Part(790, 170, 180, 50, 20, COLOR.Border, TRUE);
    Part(1060, 380, 100, 120, 20, c, TRUE);
    Part(1140, 350, 50, 180, 20, COLOR.Border, TRUE);
    Part(760, 620, 240, 60, 10, COLOR.Gray, TRUE);
    Part(200, 620, 360, 60, 10, COLOR.Gray, TRUE);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Axial fan in a square housing: the blades turn at Speed degrees per second while Value is on; FaultColor on fault. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiFan EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    {attribute 'hmi_group' := 'data'}
    Fault : BOOL;
    Caption : STRING(64);
    Blades : DINT := 4;
    Speed : DINT := 540;
    Animate : BOOL := TRUE;
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
    {attribute 'hmi_color'}
    FaultColor : UDINT := COLOR.Danger;
  END_VAR
  VAR
    spin : HmiAnimator;
  END_VAR
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 15;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(56, HMI_TextWidth(Caption, 11, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 56 + CapH();
  END_METHOD
  (* One blade at A degrees: a triangle from the hub to the rim, filled with C or, with Outline, edged in C. *)
  METHOD INTERNAL Blade : BOOL
    VAR_INPUT A : DINT; C : UDINT; Outline : BOOL; END_VAR
    HMI_PolyBegin(C);
    HMI_PolyPoint(PX(400 + HMI_Cos(A, 60), 400 + HMI_Sin(A, 60)), PY(400 + HMI_Cos(A, 60), 400 + HMI_Sin(A, 60)));
    HMI_PolyPoint(PX(400 + HMI_Cos(A, 290), 400 + HMI_Sin(A, 290)), PY(400 + HMI_Cos(A, 290), 400 + HMI_Sin(A, 290)));
    HMI_PolyPoint(PX(400 + HMI_Cos(A + 32, 290), 400 + HMI_Sin(A + 32, 290)),
      PY(400 + HMI_Cos(A + 32, 290), 400 + HMI_Sin(A + 32, 290)));
    IF Outline THEN
      HMI_PolyStroke(MAX(1, PL(12)), TRUE);
    ELSE
      HMI_PolyFill();
    END_IF;
    Blade := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR n, i, a : DINT; c : UDINT; END_VAR
    c := OffColor;
    IF Fault THEN
      c := FaultColor;
    ELSIF Value THEN
      c := OnColor;
    END_IF;
    Fit(800, 800, Left, Top + CapH(), Width, Height - CapH(), FALSE, FALSE);
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, PY(0, 0) - CapH(), Caption, 11, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    spin(Run := Value AND NOT Fault AND Animate, Rate := Speed);
    Part(40, 40, 720, 720, 100, COLOR.Border, TRUE);
    Disc(400, 400, 320, COLOR.Surface, TRUE);
    n := LIMIT(2, Blades, 8);
    FOR i := 0 TO n - 1 DO
      a := spin.Phase + i * 360 / n;
      Blade(a, c, FALSE);
      Blade(a, COLOR.Text, TRUE);
    END_FOR;
    Disc(400, 400, 70, COLOR.Gray, TRUE);
    Disc(120, 120, 25, COLOR.Gray, TRUE);
    Disc(680, 120, 25, COLOR.Gray, TRUE);
    Disc(120, 680, 25, COLOR.Gray, TRUE);
    Disc(680, 680, 25, COLOR.Gray, TRUE);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Belt conveyor on two pulleys: while Value is on the pulleys turn and the cleats move along the top at Speed units per
   second, right to left when Reverse. It stretches along its length. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiConveyor EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    Reverse : BOOL;
    Caption : STRING(64);
    Speed : DINT := 40;
    Animate : BOOL := TRUE;
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
  END_VAR
  VAR
    belt : HmiAnimator := (Period := 160);
    spin : HmiAnimator;
  END_VAR
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 15;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(140, HMI_TextWidth(Caption, 11, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 30 + CapH();
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR bh, dw, x, ph : DINT; c : UDINT; run : BOOL; END_VAR
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, Top, Caption, 11, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    bh := MAX(Height - CapH(), 4);
    dw := MAX(600, Width * 360 / bh);
    Fit(dw, 360, Left, Top + CapH(), Width, bh, FALSE, FALSE);
    run := Value AND Animate;
    c := SEL(Value, OffColor, OnColor);
    belt(Run := run, Rate := SEL(Reverse, Speed * 10, -Speed * 10));
    spin(Run := run, Rate := SEL(Reverse, Speed * 9, -Speed * 9));
    Part(60, 40, dw - 120, 300, 150, 16#374151, TRUE);
    Part(120, 90, dw - 240, 200, 100, COLOR.Border, TRUE);
    Disc(220, 190, 90, c, TRUE);
    Spokes(220, 190, 70, 3, spin.Phase);
    Disc(dw - 220, 190, 90, c, TRUE);
    Spokes(dw - 220, 190, 70, 3, spin.Phase);
    ph := belt.Phase;
    x := 360 + ph;
    WHILE x < dw - 420 DO
      Part(x, 10, 60, 40, 10, c, FALSE);
      x := x + 160;
    END_WHILE;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Gate valve with a handwheel: OnColor open, OffColor closed; the wheel sits higher when open. A tap asks for the
   opposite state. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiValve EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    (* Row for a horizontal pipe run, Column for a vertical one. *)
    Orientation : HMI_DIRECTION := HMI_DIRECTION#Row;
    Caption : STRING(64);
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Danger;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    NewValue : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD INTERNAL Vertical : BOOL
    Vertical := Orientation = HMI_DIRECTION#Column;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(SEL(Vertical(), 60, 40), HMI_TextWidth(Caption, 10, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := SEL(Vertical(), 40, 60);
    IF LEN(Caption) > 0 THEN
      NaturalHeight := NaturalHeight + 13;
    END_IF;
  END_METHOD
  METHOD INTERNAL BodyH : DINT
    BodyH := Height;
    IF LEN(Caption) > 0 THEN
      BodyH := MAX(Height - 13, 0);
    END_IF;
  END_METHOD
  (* Fits the drawing, 120 x 80 reference units along a horizontal pipe, turned for a vertical one. *)
  METHOD INTERNAL Layout : BOOL
    Fit(1200, 800, Left, Top, Width, BodyH(), FALSE, Vertical());
    Layout := TRUE;
  END_METHOD
  (* Design point a port is at: the pipe ends along the run, the handwheel and the body's underside across it. *)
  METHOD INTERNAL PortAt : DINT
    VAR_INPUT Port : HMI_PORT; Y : BOOL; END_VAR
    VAR side : HMI_PORT; END_VAR
    side := Port;
    IF Vertical() THEN
      IF Port = HMI_PORT#Top THEN
        side := HMI_PORT#Left;
      ELSIF Port = HMI_PORT#Bottom THEN
        side := HMI_PORT#Right;
      ELSIF Port = HMI_PORT#Right THEN
        side := HMI_PORT#Top;
      ELSE
        side := HMI_PORT#Bottom;
      END_IF;
    END_IF;
    IF side = HMI_PORT#Left THEN
      PortAt := SEL(Y, 40, 580);
    ELSIF side = HMI_PORT#Right THEN
      PortAt := SEL(Y, 1160, 580);
    ELSIF side = HMI_PORT#Top THEN
      PortAt := SEL(Y, 600, 80);
    ELSE
      PortAt := SEL(Y, 600, 740);
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    PortX := PX(PortAt(Port, FALSE), PortAt(Port, TRUE));
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    PortY := PY(PortAt(Port, FALSE), PortAt(Port, TRUE));
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
    VAR c : UDINT; y : DINT; END_VAR
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, Top + BodyH() + 1, Caption, 10, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    c := SEL(Value, OffColor, OnColor);
    Layout();
    Part(40, 500, 300, 160, 20, COLOR.Border, TRUE);
    Part(860, 500, 300, 160, 20, COLOR.Border, TRUE);
    Part(300, 440, 70, 280, 20, COLOR.Gray, TRUE);
    Part(830, 440, 70, 280, 20, COLOR.Gray, TRUE);
    Part(370, 420, 460, 320, 100, c, FALSE);
    ShadeBelow(370, 420, 460, 320, 100, 620);
    Edge(370, 420, 460, 320, 100);
    Part(500, 260, 200, 180, 30, c, TRUE);
    Part(580, 120, 40, 160, 10, COLOR.Gray, TRUE);
    y := SEL(Value, 140, 80);
    Part(360, y, 480, 60, 30, COLOR.Border, TRUE);
    Disc(600, y + 30, 40, COLOR.Gray, TRUE);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Electric motor: OnColor running, OffColor stopped, FaultColor on fault; the shaft points right unless ShaftLeft. A tap
   asks for the opposite state. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiMotor EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    {attribute 'hmi_group' := 'data'}
    Fault : BOOL;
    Caption : STRING(64);
    ShaftLeft : BOOL;
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
    {attribute 'hmi_color'}
    FaultColor : UDINT := COLOR.Danger;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    NewValue : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortCount : INT
    PortCount := 0;
  END_METHOD
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 15;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(72, HMI_TextWidth(Caption, 11, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 46 + CapH();
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
    VAR c : UDINT; x : DINT; END_VAR
    c := OffColor;
    IF Fault THEN
      c := FaultColor;
    ELSIF Value THEN
      c := OnColor;
    END_IF;
    Fit(1100, 700, Left, Top + CapH(), Width, Height - CapH(), ShaftLeft, FALSE);
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, PY(0, 40) - CapH(), Caption, 11, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    Part(180, 580, 160, 80, 10, COLOR.Gray, TRUE);
    Part(580, 580, 160, 80, 10, COLOR.Gray, TRUE);
    Part(40, 180, 80, 340, 30, c, TRUE);
    Part(120, 120, 660, 460, 70, c, FALSE);
    ShadeBelow(120, 120, 660, 460, 70, 440);
    FOR x := 220 TO 700 BY 80 DO
      Seg(x, 150, x, 550, 20, Shade());
    END_FOR;
    Edge(120, 120, 660, 460, 70);
    Part(340, 40, 220, 90, 20, c, TRUE);
    Part(780, 300, 220, 100, 20, COLOR.Border, TRUE);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Agitator for the top of a vessel: gear motor, shaft and two pitched blades that turn while Value is on. OnColor running,
   OffColor stopped, FaultColor on fault. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiAgitator EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    {attribute 'hmi_group' := 'data'}
    Fault : BOOL;
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
    {attribute 'hmi_color'}
    FaultColor : UDINT := COLOR.Danger;
    (* Turns the blades while running. *)
    Animate : BOOL := TRUE;
  END_VAR
  VAR
    spin : HmiAnimator;
  END_VAR
  METHOD PROTECTED OVERRIDE PortCount : INT
    PortCount := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 48;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 72;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR c : UDINT; w, y : DINT; END_VAR
    c := OffColor;
    IF Fault THEN
      c := FaultColor;
    ELSIF Value THEN
      c := OnColor;
    END_IF;
    spin(Run := Value AND NOT Fault AND Animate, Rate := 360);
    Fit(800, 1200, Left, Top, Width, Height, FALSE, FALSE);
    Part(370, 380, 60, 640, 10, COLOR.Border, TRUE);
    w := HMI_Cos(spin.Phase, 220);
    FOR y := 660 TO 960 BY 300 DO
      Quad(400 - w, y, 400 + w, y + 80, 400 + w, y + 140, 400 - w, y + 60, c, TRUE);
    END_FOR;
    Part(240, 40, 320, 260, 50, c, FALSE);
    ShadeBelow(240, 40, 320, 260, 50, 200);
    Edge(240, 40, 320, 260, 50);
    Part(180, 300, 440, 80, 20, COLOR.Gray, TRUE);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Control valve: globe body with a diaphragm actuator showing the opening Value in percent. OnColor while open,
   OffColor closed; Row for a horizontal pipe run, Column for a vertical one. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiControlValve EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    Orientation : HMI_DIRECTION := HMI_DIRECTION#Row;
    Caption : STRING(64);
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
  END_VAR
  METHOD INTERNAL Vertical : BOOL
    Vertical := Orientation = HMI_DIRECTION#Column;
  END_METHOD
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 13;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(60, HMI_TextWidth(Caption, 10, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 60 + CapH();
  END_METHOD
  METHOD INTERNAL Layout : BOOL
    Fit(1000, 1000, Left, Top, Width, Height - CapH(), FALSE, Vertical());
    Layout := TRUE;
  END_METHOD
  (* Pipe ends along the run, the actuator across it. *)
  METHOD INTERNAL PortAt : DINT
    VAR_INPUT Port : HMI_PORT; Y : BOOL; END_VAR
    VAR side : HMI_PORT; END_VAR
    side := Port;
    IF Vertical() THEN
      IF Port = HMI_PORT#Top THEN
        side := HMI_PORT#Left;
      ELSIF Port = HMI_PORT#Bottom THEN
        side := HMI_PORT#Right;
      ELSIF Port = HMI_PORT#Right THEN
        side := HMI_PORT#Top;
      ELSE
        side := HMI_PORT#Bottom;
      END_IF;
    END_IF;
    IF side = HMI_PORT#Left THEN
      PortAt := SEL(Y, 20, 780);
    ELSIF side = HMI_PORT#Right THEN
      PortAt := SEL(Y, 980, 780);
    ELSIF side = HMI_PORT#Top THEN
      PortAt := SEL(Y, 500, 80);
    ELSE
      PortAt := SEL(Y, 500, 920);
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    PortX := PX(PortAt(Port, FALSE), PortAt(Port, TRUE));
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    PortY := PY(PortAt(Port, FALSE), PortAt(Port, TRUE));
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR c : UDINT; x0, y0, x1, y1 : DINT; END_VAR
    c := SEL(Value > 0.0, OffColor, OnColor);
    Layout();
    IF CapH() > 0 THEN
      HMI_Text(Left + Width / 2, Top + Height - CapH() + 1, Caption, 10, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    Part(20, 700, 140, 160, 20, COLOR.Border, TRUE);
    Part(840, 700, 140, 160, 20, COLOR.Border, TRUE);
    Part(140, 640, 60, 280, 20, COLOR.Gray, TRUE);
    Part(800, 640, 60, 280, 20, COLOR.Gray, TRUE);
    Quad(200, 640, 500, 780, 200, 920, 200, 920, c, TRUE);
    Quad(800, 640, 500, 780, 800, 920, 800, 920, c, TRUE);
    Disc(500, 780, 50, c, TRUE);
    Part(470, 380, 60, 360, 10, COLOR.Border, TRUE);
    Part(360, 400, 280, 50, 20, COLOR.Gray, TRUE);
    Part(220, 80, 560, 300, 150, c, TRUE);
    Part(200, 320, 600, 60, 20, COLOR.Gray, TRUE);
    x0 := PX(240, 120);
    y0 := PY(240, 120);
    x1 := PX(760, 320);
    y1 := PY(760, 320);
    HMI_TextBox(MIN(x0, x1), MIN(y0, y1), ABS(x1 - x0), ABS(y1 - y0),
      CONCAT(HMI_FormatInt(REAL_TO_DINT(LIMIT(0.0, Value, 100.0))), '%'), MAX(PL(110), 8), HMI_FONT#Bold,
      HMI_ALIGN#Center, HMI_VALIGN#Middle, COLOR.OnAccent);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Check valve: the arrow shows the flow it lets through, left to right unless Reverse. OnColor while Value, else
   OffColor; Row for a horizontal pipe run, Column for a vertical one. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiCheckValve EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL := TRUE;
    Reverse : BOOL;
    Orientation : HMI_DIRECTION := HMI_DIRECTION#Row;
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
  END_VAR
  METHOD INTERNAL Vertical : BOOL
    Vertical := Orientation = HMI_DIRECTION#Column;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := SEL(Vertical(), 60, 30);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := SEL(Vertical(), 30, 60);
  END_METHOD
  METHOD INTERNAL Layout : BOOL
    Fit(1000, 500, Left, Top, Width, Height, Reverse, Vertical());
    Layout := TRUE;
  END_METHOD
  (* The two pipe ends along the run; across it, the middle of the body. *)
  METHOD INTERNAL PortAt : DINT
    VAR_INPUT Port : HMI_PORT; Y : BOOL; END_VAR
    VAR first : BOOL; END_VAR
    IF Vertical() THEN
      first := Port = HMI_PORT#Top;
      IF Port = HMI_PORT#Left OR Port = HMI_PORT#Right THEN
        PortAt := SEL(Y, 500, SEL(Port = HMI_PORT#Left, 400, 100));
        RETURN;
      END_IF;
    ELSE
      first := Port = HMI_PORT#Left;
      IF Port = HMI_PORT#Top OR Port = HMI_PORT#Bottom THEN
        PortAt := SEL(Y, 500, SEL(Port = HMI_PORT#Top, 400, 100));
        RETURN;
      END_IF;
    END_IF;
    PortAt := SEL(Y, SEL(first <> Reverse, 980, 20), 250);
  END_METHOD
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    PortX := PX(PortAt(Port, FALSE), PortAt(Port, TRUE));
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    PortY := PY(PortAt(Port, FALSE), PortAt(Port, TRUE));
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR c : UDINT; END_VAR
    c := SEL(Value, OffColor, OnColor);
    Layout();
    Part(20, 170, 160, 160, 20, COLOR.Border, TRUE);
    Part(820, 170, 160, 160, 20, COLOR.Border, TRUE);
    Part(160, 110, 60, 280, 20, COLOR.Gray, TRUE);
    Part(780, 110, 60, 280, 20, COLOR.Gray, TRUE);
    Part(220, 100, 560, 300, 120, c, FALSE);
    ShadeBelow(220, 100, 560, 300, 120, 280);
    Edge(220, 100, 560, 300, 120);
    Quad(360, 190, 600, 250, 360, 310, 360, 310, COLOR.Surface, TRUE);
    Seg(600, 150, 600, 350, 30, COLOR.Text);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Three-way valve: the common port at the bottom joins the left port, or the right one while Value. The open path is
   OnColor and the closed port OffColor. A tap asks for the other path. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiThreeWayValve EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    Caption : STRING(64);
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
  END_VAR
  VAR_OUTPUT
    Clicked : BOOL;
    Changed : BOOL;
    NewValue : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 13;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(60, HMI_TextWidth(Caption, 10, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 54 + CapH();
  END_METHOD
  METHOD INTERNAL Layout : BOOL
    Fit(1000, 900, Left, Top + CapH(), Width, Height - CapH(), FALSE, FALSE);
    Layout := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    IF Port = HMI_PORT#Left THEN
      PortX := PX(20, 300);
    ELSIF Port = HMI_PORT#Right THEN
      PortX := PX(980, 300);
    ELSE
      PortX := PX(500, 300);
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    IF Port = HMI_PORT#Top THEN
      PortY := PY(500, 160);
    ELSIF Port = HMI_PORT#Bottom THEN
      PortY := PY(500, 880);
    ELSE
      PortY := PY(20, 300);
    END_IF;
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
    Layout();
    IF CapH() > 0 THEN
      HMI_Text(Left + Width / 2, PY(0, 160) - CapH(), Caption, 10, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    Part(20, 220, 140, 160, 20, COLOR.Border, TRUE);
    Part(840, 220, 140, 160, 20, COLOR.Border, TRUE);
    Part(420, 740, 160, 140, 20, COLOR.Border, TRUE);
    Part(140, 160, 60, 280, 20, COLOR.Gray, TRUE);
    Part(800, 160, 60, 280, 20, COLOR.Gray, TRUE);
    Part(360, 680, 280, 60, 20, COLOR.Gray, TRUE);
    Quad(200, 160, 500, 300, 200, 440, 200, 440, SEL(Value, OnColor, OffColor), TRUE);
    Quad(800, 160, 500, 300, 800, 440, 800, 440, SEL(Value, OffColor, OnColor), TRUE);
    Quad(360, 680, 500, 300, 640, 680, 640, 680, OnColor, TRUE);
    Disc(500, 300, 50, OnColor, TRUE);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Shell-and-tube heat exchanger. Ports: Left and Right are the tube-side nozzles on the channel heads, Top and Bottom
   the shell-side nozzles. The heads are OnColor in service, else OffColor; the tubes are TubeColor. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiHeatExchanger EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL := TRUE;
    Caption : STRING(64);
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Gray;
    {attribute 'hmi_color'}
    TubeColor : UDINT := COLOR.Orange;
  END_VAR
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 15;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(84, HMI_TextWidth(Caption, 11, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 42 + CapH();
  END_METHOD
  METHOD INTERNAL Layout : BOOL
    Fit(1400, 700, Left, Top + CapH(), Width, Height - CapH(), FALSE, FALSE);
    Layout := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    IF Port = HMI_PORT#Left THEN
      PortX := PX(120, 40);
    ELSIF Port = HMI_PORT#Right THEN
      PortX := PX(1280, 660);
    ELSIF Port = HMI_PORT#Top THEN
      PortX := PX(360, 40);
    ELSE
      PortX := PX(1040, 660);
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    PortY := PY(0, SEL(Port = HMI_PORT#Left OR Port = HMI_PORT#Top, 660, 40));
  END_METHOD
  (* The tube-side nozzles leave upward and downward, like the shell-side ones. *)
  METHOD PROTECTED OVERRIDE PortDir : HMI_PORT
    VAR_INPUT Port : HMI_PORT; END_VAR
    IF Port = HMI_PORT#Left OR Port = HMI_PORT#Top THEN
      PortDir := HMI_PORT#Top;
    ELSE
      PortDir := HMI_PORT#Bottom;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR c : UDINT; y : DINT; END_VAR
    c := SEL(Value, OffColor, OnColor);
    Layout();
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, PY(0, 40) - CapH(), Caption, 11, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    Part(300, 40, 120, 160, 10, COLOR.Border, TRUE);
    Part(980, 500, 120, 160, 10, COLOR.Border, TRUE);
    Part(360, 520, 80, 140, 10, COLOR.Gray, TRUE);
    Part(860, 520, 80, 140, 10, COLOR.Gray, TRUE);
    Part(160, 160, 1080, 380, 190, COLOR.Border, TRUE);
    FOR y := 250 TO 450 BY 50 DO
      Seg(260, y, 1140, y, 20, TubeColor);
    END_FOR;
    Part(60, 40, 120, 160, 10, c, TRUE);
    Part(1220, 500, 120, 160, 10, c, TRUE);
    Part(40, 180, 160, 340, 60, c, TRUE);
    Part(1200, 180, 160, 340, 60, c, TRUE);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Silo with a cone hopper, filled to Value between MinValue and MaxValue in FillColor, with the value on its shell.
   Ports: the fill nozzle on top and the outlet at the bottom. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiSilo EXTENDS HmiSymbol
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    MinValue : REAL := 0.0;
    MaxValue : REAL := 100.0;
    Decimals : INT := 0;
    Unit : STRING(16) := '%';
    Caption : STRING(64);
    {attribute 'hmi_color'}
    FillColor : UDINT := COLOR.Warning;
  END_VAR
  METHOD INTERNAL CapH : DINT
    IF LEN(Caption) > 0 THEN
      CapH := 15;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(52, HMI_TextWidth(Caption, 11, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 96 + CapH();
  END_METHOD
  METHOD INTERNAL Layout : BOOL
    Fit(800, 1500, Left, Top + CapH(), Width, Height - CapH(), FALSE, FALSE);
    Layout := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    IF Port = HMI_PORT#Left THEN
      PortX := PX(120, 500);
    ELSIF Port = HMI_PORT#Right THEN
      PortX := PX(680, 500);
    ELSE
      PortX := PX(400, 500);
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    Layout();
    IF Port = HMI_PORT#Top THEN
      PortY := PY(400, 80);
    ELSIF Port = HMI_PORT#Bottom THEN
      PortY := PY(400, 1300);
    ELSE
      PortY := PY(400, 500);
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR ly : DINT; END_VAR
    Layout();
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, PY(0, 80) - CapH(), Caption, 11, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    Seg(180, 900, 140, 1460, 30, COLOR.Text);
    Seg(620, 900, 660, 1460, 30, COLOR.Text);
    Seg(160, 1280, 640, 1280, 20, COLOR.Text);
    Part(340, 1200, 120, 100, 10, COLOR.Gray, TRUE);
    Part(120, 80, 560, 900, 160, COLOR.Border, TRUE);
    Quad(120, 920, 680, 920, 460, 1220, 340, 1220, COLOR.Border, TRUE);
    ly := PY(0, 1200 - 1100 * HMI_PerMille(Value, MinValue, MaxValue) / 1000);
    HMI_Clip(Left, ly, Width, MAX(PY(0, 1220) - ly, 0));
    Part(150, 110, 500, 870, 140, FillColor, FALSE);
    Quad(150, 920, 650, 920, 446, 1192, 354, 1192, FillColor, FALSE);
    HMI_Unclip();
    HMI_TextBox(PX(120, 0), PY(0, 300), PX(680, 0) - PX(120, 0), PY(0, 500) - PY(0, 300),
      HMI_FormatValue(Value, Decimals, Unit), MAX(PL(130), 8), HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle,
      COLOR.Text);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Instrument tag in ISA style: the function letters over the loop number in a bubble, the measured Value under it.
   AlarmColor rings the bubble while Alarm. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiInstrument EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : REAL;
    Tag : STRING(8) := 'FT';
    Loop : STRING(16) := '101';
    Decimals : INT := 1;
    Unit : STRING(16);
    ShowValue : BOOL := TRUE;
    {attribute 'hmi_group' := 'data'}
    Alarm : BOOL;
    {attribute 'hmi_color'}
    ValueColor : UDINT := COLOR.Accent;
    {attribute 'hmi_color'}
    AlarmColor : UDINT := COLOR.Danger;
  END_VAR
  METHOD PROTECTED OVERRIDE PortCount : INT
    PortCount := 0;
  END_METHOD
  METHOD INTERNAL ValH : DINT
    IF ShowValue THEN
      ValH := 26;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(56, HMI_TextWidth(HMI_FormatValue(Value, Decimals, Unit), 12, HMI_FONT#Bold) + 12);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 56 + ValH();
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR cx, cy, r, w : DINT; ring : UDINT; END_VAR
    r := MAX(MIN(Width, Height - ValH()) / 2 - 1, 8);
    cx := Left + Width / 2;
    cy := Top + r + 1;
    w := MAX(r / 18, 1);
    ring := SEL(Alarm, COLOR.Text, AlarmColor);
    HMI_FillCircle(cx, cy, r, ring);
    HMI_FillCircle(cx, cy, r - w - SEL(Alarm, 0, w), COLOR.Surface);
    HMI_FillRect(cx - r + w, cy, (r - w) * 2, w, 0, COLOR.Text);
    HMI_TextBox(cx - r, cy - r * 3 / 4, r * 2, r * 3 / 4, Tag, MAX(r * 7 / 15, 8), HMI_FONT#Bold, HMI_ALIGN#Center,
      HMI_VALIGN#Middle, COLOR.Text);
    HMI_TextBox(cx - r, cy + w, r * 2, r * 3 / 4, Loop, MAX(r * 2 / 5, 8), HMI_FONT#Regular, HMI_ALIGN#Center,
      HMI_VALIGN#Middle, COLOR.Text);
    IF ShowValue THEN
      HMI_FillRect(Left, Top + Height - 22, Width, 22, 4, COLOR.Surface);
      HMI_StrokeRect(Left, Top + Height - 22, Width, 22, 4, 1, COLOR.Border);
      HMI_TextBox(Left, Top + Height - 22, Width, 22, HMI_FormatValue(Value, Decimals, Unit), 12, HMI_FONT#Bold,
        HMI_ALIGN#Center, HMI_VALIGN#Middle, ValueColor);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Pipe between two elements' ports, routed with right angles, also through the bends in Path. Source and Target name
   elements of the same diagram; the HMI build connects them. Value TRUE means flowing. A pipe that crosses one
   declared before it in the same container hops over it. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiPipe EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    {attribute 'hmi_group' := 'layout'}
    {attribute 'hmi_element_ref'}
    Source : STRING(64);
    {attribute 'hmi_group' := 'layout'}
    SourcePort : HMI_PORT := HMI_PORT#Bottom;
    {attribute 'hmi_group' := 'layout'}
    {attribute 'hmi_element_ref'}
    Target : STRING(64);
    {attribute 'hmi_group' := 'layout'}
    TargetPort : HMI_PORT := HMI_PORT#Top;
    (* Bends between the ports, in the container's units: 'x,y;x,y', at most 8. Empty: routed automatically. *)
    {attribute 'hmi_group' := 'layout'}
    Path : STRING(160);
    Thickness : DINT := 3;
    (* Moving dashes while flowing. *)
    Animate : BOOL;
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Accent;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Border;
  END_VAR
  VAR
    EndA, EndB : POINTER TO HmiElement;
    Before : POINTER TO HmiPipe;
    px, py : ARRAY[0..19] OF DINT;
    n : INT;
    wx, wy : ARRAY[0..7] OF DINT;
    nw : INT;
    parsedPath : STRING(160);
    parsed : BOOL;
  END_VAR
  METHOD INTERNAL Connect : BOOL
    VAR_INPUT A, B : POINTER TO HmiElement; Prior : POINTER TO HmiPipe; END_VAR
    EndA := A;
    EndB := B;
    Before := Prior;
    Connect := TRUE;
  END_METHOD
  METHOD INTERNAL PointCount : INT
    PointCount := n;
  END_METHOD
  METHOD INTERNAL PointX : DINT
    VAR_INPUT I : INT; END_VAR
    PointX := px[LIMIT(0, I, 19)];
  END_METHOD
  METHOD INTERNAL PointY : DINT
    VAR_INPUT I : INT; END_VAR
    PointY := py[LIMIT(0, I, 19)];
  END_METHOD
  METHOD INTERNAL Prior : POINTER TO HmiPipe
    Prior := Before;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortCount : INT
    PortCount := 0;
  END_METHOD
  METHOD INTERNAL OVERRIDE Underlay : BOOL
    Underlay := TRUE;
  END_METHOD
  (* Reads Path into the bends; a part that is not two numbers is skipped. *)
  METHOD PRIVATE ReadPath : BOOL
    VAR rest, part : STRING(160); k : INT; x, y : REAL; END_VAR
    nw := 0;
    rest := Path;
    WHILE LEN(rest) > 0 AND nw < 8 DO
      k := FIND(rest, ';');
      IF k = 0 THEN
        part := rest;
        rest := '';
      ELSE
        part := MID(rest, k - 1, 1);
        rest := MID(rest, LEN(rest) - k, k + 1);
      END_IF;
      k := FIND(part, ',');
      IF k > 0 THEN
        x := HMI_ParseReal(MID(part, k - 1, 1), -1.0E9);
        y := HMI_ParseReal(MID(part, LEN(part) - k, k + 1), -1.0E9);
        IF x > -1.0E8 AND y > -1.0E8 THEN
          wx[nw] := REAL_TO_DINT(x);
          wy[nw] := REAL_TO_DINT(y);
          nw := nw + 1;
        END_IF;
      END_IF;
    END_WHILE;
    parsedPath := Path;
    parsed := TRUE;
    ReadPath := TRUE;
  END_METHOD
  (* Adds a point, after an elbow when it is on neither axis of the last one: vertical first when Vertical. A bend
     (Snap) closer to an axis of the last point than the pipe is thick moves onto it, so it makes no jog too short to
     curve. *)
  METHOD PRIVATE AddPoint : BOOL
    VAR_INPUT X, Y : DINT; Vertical, Snap : BOOL; END_VAR
    IF Snap AND n > 0 THEN
      IF ABS(X - px[n - 1]) < Thickness THEN
        X := px[n - 1];
      END_IF;
      IF ABS(Y - py[n - 1]) < Thickness THEN
        Y := py[n - 1];
      END_IF;
    END_IF;
    IF n > 0 AND px[n - 1] <> X AND py[n - 1] <> Y THEN
      px[n] := SEL(Vertical, X, px[n - 1]);
      py[n] := SEL(Vertical, py[n - 1], Y);
      n := n + 1;
    END_IF;
    px[n] := X;
    py[n] := Y;
    n := n + 1;
    AddPoint := TRUE;
  END_METHOD
  (* Drops repeated points and points in the middle of a straight run. *)
  METHOD PRIVATE Simplify : BOOL
    VAR i, k : INT; keep : BOOL; END_VAR
    k := 0;
    FOR i := 0 TO n - 1 DO
      keep := TRUE;
      IF k > 0 THEN
        keep := px[i] <> px[k - 1] OR py[i] <> py[k - 1];
      END_IF;
      IF keep THEN
        IF k > 1 THEN
          IF (px[k - 2] = px[k - 1] AND px[k - 1] = px[i]) OR (py[k - 2] = py[k - 1] AND py[k - 1] = py[i]) THEN
            k := k - 1;
          END_IF;
        END_IF;
        px[k] := px[i];
        py[k] := py[i];
        k := k + 1;
      END_IF;
    END_FOR;
    n := k;
    Simplify := TRUE;
  END_METHOD
  (* Step along a port's outward direction: -1, 0 or 1 on the X axis, or on the Y axis when Y. *)
  METHOD PRIVATE PortStep : DINT
    VAR_INPUT D : HMI_PORT; Y : BOOL; END_VAR
    IF Y THEN
      PortStep := SEL(D = HMI_PORT#Bottom, SEL(D = HMI_PORT#Top, 0, -1), 1);
    ELSE
      PortStep := SEL(D = HMI_PORT#Right, SEL(D = HMI_PORT#Left, 0, -1), 1);
    END_IF;
  END_METHOD
  (* Whether moving from (X0, Y0) to (X1, Y1) goes against step (Sx, Sy): back into the element a stub left. *)
  METHOD PRIVATE Backwards : BOOL
    VAR_INPUT X0, Y0, X1, Y1, Sx, Sy : DINT; END_VAR
    Backwards := (X1 - X0) * Sx < 0 OR (Y1 - Y0) * Sy < 0;
  END_METHOD
  (* Route: through the bends when Path has any, leaving and reaching each port along its axis. Otherwise each end
     leaves its port by a stub along the port's direction, and the stubs are joined by a Z when both ends leave along
     the same axis, an L otherwise, turned the other way when the first way would double back on a stub. *)
  METHOD PROTECTED OVERRIDE Prepare : BOOL
    VAR x0, y0, x1, y1, m, x2, y2, st, sx0, sy0, sx1, sy1, qx0, qy0, qx1, qy1 : DINT; d0, d1 : HMI_PORT; v0, v1 : BOOL;
      i : INT; END_VAR
    n := 0;
    IF EndA = 0 OR EndB = 0 THEN
      RETURN;
    END_IF;
    IF NOT parsed OR Path <> parsedPath THEN
      ReadPath();
    END_IF;
    x0 := EndA^.PortXOf(SourcePort);
    y0 := EndA^.PortYOf(SourcePort);
    d0 := EndA^.PortDirOf(SourcePort);
    x1 := EndB^.PortXOf(TargetPort);
    y1 := EndB^.PortYOf(TargetPort);
    d1 := EndB^.PortDirOf(TargetPort);
    v0 := d0 = HMI_PORT#Top OR d0 = HMI_PORT#Bottom;
    v1 := d1 = HMI_PORT#Top OR d1 = HMI_PORT#Bottom;
    px[0] := x0;
    py[0] := y0;
    IF nw > 0 THEN
      n := 1;
      FOR i := 0 TO nw - 1 DO
        AddPoint(wx[i], wy[i], i = 0 AND v0, TRUE);
      END_FOR;
      AddPoint(x1, y1, NOT v1, FALSE);
    ELSE
      st := Thickness * 4;
      sx0 := PortStep(d0, FALSE);
      sy0 := PortStep(d0, TRUE);
      sx1 := PortStep(d1, FALSE);
      sy1 := PortStep(d1, TRUE);
      qx0 := x0 + sx0 * st;
      qy0 := y0 + sy0 * st;
      qx1 := x1 + sx1 * st;
      qy1 := y1 + sy1 * st;
      n := 1;
      AddPoint(qx0, qy0, FALSE, FALSE);
      IF v0 AND v1 THEN
        m := (qy0 + qy1) / 2;
        IF Backwards(qx0, qy0, qx0, m, sx0, sy0) OR Backwards(qx1, m, qx1, qy1, -sx1, -sy1) THEN
          m := (qx0 + qx1) / 2;
          AddPoint(m, qy0, FALSE, FALSE);
          AddPoint(m, qy1, FALSE, FALSE);
        ELSE
          AddPoint(qx0, m, FALSE, FALSE);
          AddPoint(qx1, m, FALSE, FALSE);
        END_IF;
      ELSIF NOT v0 AND NOT v1 THEN
        m := (qx0 + qx1) / 2;
        IF Backwards(qx0, qy0, m, qy0, sx0, sy0) OR Backwards(m, qy1, qx1, qy1, -sx1, -sy1) THEN
          m := (qy0 + qy1) / 2;
          AddPoint(qx0, m, FALSE, FALSE);
          AddPoint(qx1, m, FALSE, FALSE);
        ELSE
          AddPoint(m, qy0, FALSE, FALSE);
          AddPoint(m, qy1, FALSE, FALSE);
        END_IF;
      ELSIF v0 THEN
        IF Backwards(qx0, qy0, qx0, qy1, sx0, sy0) OR Backwards(qx0, qy1, qx1, qy1, -sx1, -sy1) THEN
          AddPoint(qx1, qy0, FALSE, FALSE);
        ELSE
          AddPoint(qx0, qy1, FALSE, FALSE);
        END_IF;
      ELSE
        IF Backwards(qx0, qy0, qx1, qy0, sx0, sy0) OR Backwards(qx1, qy0, qx1, qy1, -sx1, -sy1) THEN
          AddPoint(qx0, qy1, FALSE, FALSE);
        ELSE
          AddPoint(qx1, qy0, FALSE, FALSE);
        END_IF;
      END_IF;
      AddPoint(qx1, qy1, FALSE, FALSE);
      AddPoint(x1, y1, FALSE, FALSE);
      Simplify();
    END_IF;
    Left := px[0];
    Top := py[0];
    x2 := px[0];
    y2 := py[0];
    FOR i := 1 TO n - 1 DO
      Left := MIN(Left, px[i]);
      Top := MIN(Top, py[i]);
      x2 := MAX(x2, px[i]);
      y2 := MAX(y2, py[i]);
    END_FOR;
    Width := x2 - Left + Thickness;
    Height := y2 - Top + Thickness;
    Left := Left - Thickness / 2;
    Top := Top - Thickness / 2;
    Prepare := TRUE;
  END_METHOD
  (* Radius of a hop over a crossing pipe. *)
  METHOD PRIVATE HopRadius : DINT
    HopRadius := Thickness * 2 + 2;
  END_METHOD
  (* Radius of the bend at point I: twice the thickness, at most half of either segment meeting there; 0 at an end or
     where the pipe goes straight on. *)
  METHOD PRIVATE BendRadius : DINT
    VAR_INPUT I : INT; END_VAR
    VAR lin, lout : DINT; END_VAR
    BendRadius := 0;
    IF I <= 0 OR I >= n - 1 THEN
      RETURN;
    END_IF;
    IF (px[I - 1] = px[I] AND px[I] = px[I + 1]) OR (py[I - 1] = py[I] AND py[I] = py[I + 1]) THEN
      RETURN;
    END_IF;
    lin := ABS(px[I] - px[I - 1]) + ABS(py[I] - py[I - 1]);
    lout := ABS(px[I + 1] - px[I]) + ABS(py[I + 1] - py[I]);
    BendRadius := MAX(0, MIN(Thickness * 2, MIN(lin / 2, lout / 2)));
  END_METHOD
  (* Direction of travel from point I to point I + 1, in the arc angles of HMI_Arc: 0 right, 90 down, 180 left, 270 up. *)
  METHOD PRIVATE Heading : DINT
    VAR_INPUT I : INT; END_VAR
    IF px[I + 1] > px[I] THEN
      Heading := 0;
    ELSIF py[I + 1] > py[I] THEN
      Heading := 90;
    ELSIF px[I + 1] < px[I] THEN
      Heading := 180;
    ELSE
      Heading := 270;
    END_IF;
  END_METHOD
  (* Draws the bend at point I as a quarter arc of radius R joining the two shortened segments. *)
  METHOD PRIVATE DrawBend : BOOL
    VAR_INPUT I : INT; R : DINT; C : UDINT; END_VAR
    VAR hin, hout, din, dout, cx, cy, a : DINT; END_VAR
    hin := Heading(I - 1);
    hout := Heading(I);
    din := SEL(hin = 0, SEL(hin = 180, 0, -1), 1);
    dout := SEL(hout = 0, SEL(hout = 180, 0, -1), 1);
    cx := px[I] - din * R + dout * R;
    din := SEL(hin = 90, SEL(hin = 270, 0, -1), 1);
    dout := SEL(hout = 90, SEL(hout = 270, 0, -1), 1);
    cy := py[I] - din * R + dout * R;
    IF (hout - hin + 360) MOD 360 = 90 THEN
      a := (hout + 180) MOD 360;
    ELSE
      a := hin;
    END_IF;
    HMI_Arc(cx, cy, R, Thickness, a, a + 90, C);
    DrawBend := TRUE;
  END_METHOD
  (* Draws segment I, shortened by T0 at its start and T1 at its end for the bends, leaving a hop wherever it crosses a
     segment of a pipe declared before this one. *)
  METHOD PRIVATE DrawSegment : BOOL
    VAR_INPUT I : INT; C : UDINT; T0, T1 : DINT; END_VAR
    VAR q : POINTER TO HmiPipe; j, k, hn : INT; r, a, b, lane, cx, cy, qa, qb, t, sx, sy, ex, ey, dx, dy : DINT;
      horizontal : BOOL; hops : ARRAY[0..7] OF DINT; END_VAR
    horizontal := py[I] = py[I + 1];
    dx := SEL(px[I + 1] > px[I], SEL(px[I + 1] < px[I], 0, -1), 1);
    dy := SEL(py[I + 1] > py[I], SEL(py[I + 1] < py[I], 0, -1), 1);
    sx := px[I] + dx * T0;
    sy := py[I] + dy * T0;
    ex := px[I + 1] - dx * T1;
    ey := py[I + 1] - dy * T1;
    r := HopRadius();
    hn := 0;
    IF horizontal OR px[I] = px[I + 1] THEN
      a := SEL(horizontal, MIN(sy, ey), MIN(sx, ex));
      b := SEL(horizontal, MAX(sy, ey), MAX(sx, ex));
      lane := SEL(horizontal, px[I], py[I]);
      q := Before;
      WHILE q <> 0 AND hn < 8 DO
        FOR j := 0 TO q^.PointCount() - 2 DO
          IF horizontal THEN
            cx := q^.PointX(j);
            qa := MIN(q^.PointY(j), q^.PointY(j + 1));
            qb := MAX(q^.PointY(j), q^.PointY(j + 1));
            IF q^.PointX(j + 1) = cx AND cx > a + r AND cx < b - r AND py[I] > qa + r AND py[I] < qb - r AND hn < 8 THEN
              hops[hn] := cx;
              hn := hn + 1;
            END_IF;
          ELSE
            cy := q^.PointY(j);
            qa := MIN(q^.PointX(j), q^.PointX(j + 1));
            qb := MAX(q^.PointX(j), q^.PointX(j + 1));
            IF q^.PointY(j + 1) = cy AND cy > a + r AND cy < b - r AND px[I] > qa + r AND px[I] < qb - r AND hn < 8 THEN
              hops[hn] := cy;
              hn := hn + 1;
            END_IF;
          END_IF;
        END_FOR;
        q := q^.Prior();
      END_WHILE;
    END_IF;
    IF hn = 0 THEN
      HMI_Line(sx, sy, ex, ey, Thickness, C);
      DrawSegment := TRUE;
      RETURN;
    END_IF;
    FOR j := 1 TO hn - 1 DO
      t := hops[j];
      k := j - 1;
      WHILE k >= 0 AND hops[k] > t DO
        hops[k + 1] := hops[k];
        k := k - 1;
      END_WHILE;
      hops[k + 1] := t;
    END_FOR;
    t := a;
    FOR j := 0 TO hn - 1 DO
      IF horizontal THEN
        HMI_Line(t, lane, hops[j] - r, lane, Thickness, C);
        HMI_Arc(hops[j], lane, r, Thickness, 180, 360, C);
      ELSE
        HMI_Line(lane, t, lane, hops[j] - r, Thickness, C);
        HMI_Arc(lane, hops[j], r, Thickness, 270, 450, C);
      END_IF;
      t := hops[j] + r;
    END_FOR;
    IF horizontal THEN
      HMI_Line(t, lane, b, lane, Thickness, C);
    ELSE
      HMI_Line(lane, t, lane, b, Thickness, C);
    END_IF;
    DrawSegment := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR i : INT; c : UDINT; len, s, ph, dx, dy, t0, t1, a, b : DINT; END_VAR
    IF n < 2 THEN
      RETURN;
    END_IF;
    IF DesignMode() THEN
      FOR i := 0 TO n - 1 DO
        RecordBounds(-(1000000 + Id * 32 + INT_TO_DINT(i)), px[i], py[i], 0, 0, FALSE);
      END_FOR;
    END_IF;
    c := SEL(Value, OffColor, OnColor);
    FOR i := 0 TO n - 2 DO
      DrawSegment(i, c, BendRadius(i), BendRadius(i + 1));
      IF BendRadius(i) > 0 THEN
        DrawBend(i, BendRadius(i), c);
      END_IF;
    END_FOR;
    IF Value AND Animate THEN
      ph := UDINT_TO_DINT(HMI_TimeMs() / 40 MOD 20);
      FOR i := 0 TO n - 2 DO
        dx := px[i + 1] - px[i];
        dy := py[i + 1] - py[i];
        len := ABS(dx) + ABS(dy);
        t0 := BendRadius(i);
        t1 := len - BendRadius(i + 1);
        s := ph;
        WHILE s < t1 DO
          IF s + 7 > t0 THEN
            a := MAX(s, t0);
            b := MIN(s + 7, t1);
            HMI_Line(px[i] + dx * a / len, py[i] + dy * a / len, px[i] + dx * b / len, py[i] + dy * b / len,
              MAX(1, Thickness / 2), HMI_Alpha(COLOR.White, 70));
          END_IF;
          s := s + 20;
        END_WHILE;
      END_FOR;
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`
