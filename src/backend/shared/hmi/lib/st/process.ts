/** StandardWidgets ST source: process symbols for diagrams. */
export const PROCESS_ST = `(* Centrifugal pump: OnColor running, OffColor stopped, FaultColor on fault. A tap asks for the opposite state. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiPump EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    {attribute 'hmi_group' := 'data'}
    Fault : BOOL;
    Caption : STRING(64);
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Danger;
    {attribute 'hmi_color'}
    FaultColor : UDINT := COLOR.Gray;
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
      CapH := 15;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := MAX(36, HMI_TextWidth(Caption, 11, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 32 + CapH();
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD INTERNAL CasingR : DINT
    CasingR := MAX(MIN(Width, Height - CapH()) * 36 / 100, 1);
  END_METHOD
  (* Inlet on the left of the casing, outlet at the end of the discharge nozzle. *)
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    IF Port = HMI_PORT#Right THEN
      PortX := Left + Width / 2 + CasingR() * 135 / 100;
    ELSIF Port = HMI_PORT#Left THEN
      PortX := Left + Width / 2 - CasingR();
    ELSE
      PortX := Left + Width / 2;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    VAR cy : DINT; END_VAR
    cy := Top + CapH() + (Height - CapH()) / 2;
    IF Port = HMI_PORT#Top THEN
      PortY := cy - CasingR();
    ELSIF Port = HMI_PORT#Bottom THEN
      PortY := cy + CasingR();
    ELSIF Port = HMI_PORT#Right THEN
      PortY := cy - CasingR() * 7 / 10;
    ELSE
      PortY := cy;
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
    VAR cx, cy, r : DINT; c : UDINT; END_VAR
    IF LEN(Caption) > 0 THEN
      HMI_Text(Left + Width / 2, Top, Caption, 11, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
    END_IF;
    cx := Left + Width / 2;
    cy := Top + CapH() + (Height - CapH()) / 2;
    r := CasingR();
    c := OffColor;
    IF Fault THEN
      c := FaultColor;
    ELSIF Value THEN
      c := OnColor;
    END_IF;
    HMI_FillRect(cx, cy - r, r * 135 / 100, r * 6 / 10, 1, c);
    HMI_StrokeRect(cx, cy - r, r * 135 / 100, r * 6 / 10, 1, 1, COLOR.Text);
    HMI_FillCircle(cx, cy, r + 1, COLOR.Text);
    HMI_FillCircle(cx, cy, r, c);
    HMI_FillCircle(cx - r * 3 / 10, cy - r * 3 / 10, r * 28 / 100, HMI_Alpha(COLOR.White, 38));
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Gate valve: OnColor open, OffColor closed. A tap asks for the opposite state. *)
{attribute 'hmi_palette' := 'Process'}
FUNCTION_BLOCK HmiValve EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
    (* Row for a horizontal pipe run, Column for a vertical one. *)
    Orientation : HMI_DIRECTION := HMI_DIRECTION#Row;
    Caption : STRING(64);
    {attribute 'hmi_color'}
    OnColor : UDINT := COLOR.Accent;
    {attribute 'hmi_color'}
    OffColor : UDINT := COLOR.Surface;
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
    NaturalWidth := MAX(SEL(Vertical(), 26, 16), HMI_TextWidth(Caption, 10, HMI_FONT#Bold) + 4);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := SEL(Vertical(), 16, 26);
    IF LEN(Caption) > 0 THEN
      NaturalHeight := NaturalHeight + 13;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD INTERNAL BodyH : DINT
    BodyH := Height;
    IF LEN(Caption) > 0 THEN
      BodyH := MAX(Height - 13, 0);
    END_IF;
  END_METHOD
  (* Half the body along the pipe, so a stretched valve keeps its shape. *)
  METHOD INTERNAL HalfLen : DINT
    IF Vertical() THEN
      HalfLen := MIN(BodyH(), 26) / 2;
    ELSE
      HalfLen := MIN(Width, 26) / 2;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    IF Vertical() OR Port = HMI_PORT#Top OR Port = HMI_PORT#Bottom THEN
      PortX := Left + Width / 2;
    ELSIF Port = HMI_PORT#Right THEN
      PortX := Left + Width / 2 + HalfLen();
    ELSE
      PortX := Left + Width / 2 - HalfLen();
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    IF NOT Vertical() OR Port = HMI_PORT#Right OR Port = HMI_PORT#Left THEN
      PortY := Top + BodyH() / 2;
    ELSIF Port = HMI_PORT#Top THEN
      PortY := Top + BodyH() / 2 - HalfLen();
    ELSE
      PortY := Top + BodyH() / 2 + HalfLen();
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
  METHOD INTERNAL Wedge : BOOL
    VAR_INPUT X1, Y1, X2, Y2, X3, Y3 : DINT; C : UDINT; END_VAR
    HMI_PolyBegin(C);
    HMI_PolyPoint(X1, Y1);
    HMI_PolyPoint(X2, Y2);
    HMI_PolyPoint(X3, Y3);
    HMI_PolyFill();
    HMI_PolyBegin(COLOR.Text);
    HMI_PolyPoint(X1, Y1);
    HMI_PolyPoint(X2, Y2);
    HMI_PolyPoint(X3, Y3);
    HMI_PolyStroke(1, TRUE);
    Wedge := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR c : UDINT; bh, cx, cy, hl : DINT; END_VAR
    c := SEL(Value, OffColor, OnColor);
    bh := BodyH();
    hl := HalfLen();
    cx := Left + Width / 2;
    cy := Top + bh / 2;
    IF Vertical() THEN
      Wedge(cx - 7, cy - hl, cx + 7, cy - hl, cx, cy, c);
      Wedge(cx - 7, cy + hl, cx + 7, cy + hl, cx, cy, c);
    ELSE
      Wedge(cx - hl, cy - 7, cx - hl, cy + 7, cx, cy, c);
      Wedge(cx + hl, cy - 7, cx + hl, cy + 7, cx, cy, c);
    END_IF;
    IF LEN(Caption) > 0 THEN
      HMI_Text(cx, Top + bh + 1, Caption, 10, HMI_FONT#Bold, HMI_ALIGN#Center, COLOR.Text);
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
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
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
  (* Adds a point, after an elbow when it is on neither axis of the last one: vertical first when Vertical. *)
  METHOD PRIVATE AddPoint : BOOL
    VAR_INPUT X, Y : DINT; Vertical : BOOL; END_VAR
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
  (* Route: through the bends when Path has any, leaving and reaching each port along its axis; else a Z when both
     ends leave along the same axis, an L otherwise. *)
  METHOD PROTECTED OVERRIDE Prepare : BOOL
    VAR x0, y0, x1, y1, m, x2, y2 : DINT; d0, d1 : HMI_PORT; v0, v1 : BOOL; i : INT; END_VAR
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
        AddPoint(wx[i], wy[i], i = 0 AND v0);
      END_FOR;
      AddPoint(x1, y1, NOT v1);
    ELSIF v0 AND v1 THEN
      m := (y0 + y1) / 2;
      px[1] := x0; py[1] := m; px[2] := x1; py[2] := m; px[3] := x1; py[3] := y1;
      n := 4;
    ELSIF NOT v0 AND NOT v1 THEN
      m := (x0 + x1) / 2;
      px[1] := m; py[1] := y0; px[2] := m; py[2] := y1; px[3] := x1; py[3] := y1;
      n := 4;
    ELSIF v0 THEN
      px[1] := x0; py[1] := y1; px[2] := x1; py[2] := y1;
      n := 3;
    ELSE
      px[1] := x1; py[1] := y0; px[2] := x1; py[2] := y1;
      n := 3;
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
  (* Draws segment I, leaving a hop wherever it crosses a segment of a pipe declared before this one. *)
  METHOD PRIVATE DrawSegment : BOOL
    VAR_INPUT I : INT; C : UDINT; END_VAR
    VAR q : POINTER TO HmiPipe; j, k, hn : INT; r, a, b, lane, cx, cy, qa, qb, t : DINT; horizontal : BOOL;
      hops : ARRAY[0..7] OF DINT; END_VAR
    horizontal := py[I] = py[I + 1];
    r := HopRadius();
    hn := 0;
    IF horizontal OR px[I] = px[I + 1] THEN
      a := SEL(horizontal, MIN(py[I], py[I + 1]), MIN(px[I], px[I + 1]));
      b := SEL(horizontal, MAX(py[I], py[I + 1]), MAX(px[I], px[I + 1]));
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
      HMI_Line(px[I], py[I], px[I + 1], py[I + 1], Thickness, C);
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
    VAR i : INT; c : UDINT; len, s, ph, dx, dy : DINT; END_VAR
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
      DrawSegment(i, c);
      IF i > 0 THEN
        HMI_FillRect(px[i] - Thickness / 2, py[i] - Thickness / 2, Thickness, Thickness, 0, c);
      END_IF;
    END_FOR;
    IF Value AND Animate THEN
      ph := UDINT_TO_DINT(HMI_TimeMs() / 40 MOD 20);
      FOR i := 0 TO n - 2 DO
        dx := px[i + 1] - px[i];
        dy := py[i + 1] - py[i];
        len := ABS(dx) + ABS(dy);
        s := ph;
        WHILE s < len DO
          HMI_Line(px[i] + dx * s / len, py[i] + dy * s / len, px[i] + dx * MIN(s + 7, len) / len,
            py[i] + dy * MIN(s + 7, len) / len, MAX(1, Thickness / 2), HMI_Alpha(COLOR.White, 70));
          s := s + 20;
        END_WHILE;
      END_FOR;
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`
