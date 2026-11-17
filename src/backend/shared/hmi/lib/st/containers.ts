/** StandardWidgets ST source: the containers, HmiVerticalStack, HmiHorizontalStack and HmiDiagram, and their bases. */
export const CONTAINERS_ST = `(* Base of every element that holds others; only containers may sit directly on a screen. Containers fill
   the room their parent gives them unless GrowAuto is turned off. *)
{attribute 'hmi_default' := 'GrowAuto := TRUE'}
FUNCTION_BLOCK ABSTRACT HmiContainer EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_color'}
    Fill : UDINT := COLOR.Transparent;
  END_VAR

  (* Takes a child; FALSE when full. *)
  METHOD INTERNAL AddChild : BOOL
    VAR_INPUT Child : POINTER TO HmiElement; END_VAR
    AddChild := FALSE;
  END_METHOD
END_FUNCTION_BLOCK

(* Base of the stacks. Sizes start from each child's measured size, then leftover space goes to the children that
   grow and missing space is taken from all of them, within each child's minimum and maximum. *)
FUNCTION_BLOCK ABSTRACT HmiStack EXTENDS HmiContainer
  VAR_INPUT
    Gap : DINT := 8;
    Padding : DINT := 0;
  END_VAR
  VAR
    Kids : ARRAY[0..63] OF POINTER TO HmiElement;
    N : INT;
  END_VAR

  (* TRUE: children side by side, left to right; FALSE: top to bottom. *)
  METHOD PROTECTED SideBySide : BOOL
    SideBySide := FALSE;
  END_METHOD
  METHOD INTERNAL OVERRIDE AddChild : BOOL
    VAR_INPUT Child : POINTER TO HmiElement; END_VAR
    IF N < 64 THEN
      Kids[N] := Child;
      N := N + 1;
      AddChild := TRUE;
    END_IF;
  END_METHOD
  METHOD INTERNAL VisibleKids : INT
    VAR i : INT; END_VAR
    FOR i := 0 TO N - 1 DO
      IF Kids[i]^.Visible AND NOT Kids[i]^.Floating THEN
        VisibleKids := VisibleKids + 1;
      END_IF;
    END_FOR;
  END_METHOD
  METHOD OVERRIDE Place : BOOL
    VAR_INPUT PX, PY, PW, PH : DINT; END_VAR
    VAR
      i, pass : INT;
      horiz, clamped : BOOL;
      main, cross, free, sumW, accW, w, share, t, lo, hi, pos, cs, sz : DINT;
      c : POINTER TO HmiElement;
    END_VAR
    Left := PX;
    Top := PY;
    Width := MAX(PW, 0);
    Height := MAX(PH, 0);
    horiz := SideBySide();
    IF horiz THEN
      main := Width - 2 * Padding;
      cross := Height - 2 * Padding;
    ELSE
      main := Height - 2 * Padding;
      cross := Width - 2 * Padding;
    END_IF;
    IF VisibleKids() > 1 THEN
      main := main - Gap * INT_TO_DINT(VisibleKids() - 1);
    END_IF;
    main := MAX(main, 0);
    FOR i := 0 TO N - 1 DO
      c := Kids[i];
      c^.SetLayFixed(NOT c^.Visible OR c^.Floating);
      IF c^.IsLayFixed() THEN
        c^.SetLaySize(0);
      ELSE
        c^.SetLaySize(c^.Basis(horiz));
      END_IF;
    END_FOR;
    (* Each pass fixes the children that hit a limit, so at most N + 1 passes. *)
    FOR pass := 0 TO N DO
      free := main;
      FOR i := 0 TO N - 1 DO
        free := free - Kids[i]^.GetLaySize();
      END_FOR;
      IF free = 0 THEN
        EXIT;
      END_IF;
      sumW := 0;
      FOR i := 0 TO N - 1 DO
        IF NOT Kids[i]^.IsLayFixed() THEN
          IF free > 0 THEN
            sumW := sumW + Kids[i]^.GetGrow(horiz);
          ELSE
            sumW := sumW + Kids[i]^.GetLaySize();
          END_IF;
        END_IF;
      END_FOR;
      IF sumW = 0 THEN
        EXIT;
      END_IF;
      accW := 0;
      clamped := FALSE;
      FOR i := 0 TO N - 1 DO
        c := Kids[i];
        sz := c^.GetLaySize();
        c^.SetLayWant(sz);
        IF NOT c^.IsLayFixed() THEN
          IF free > 0 THEN
            w := c^.GetGrow(horiz);
          ELSE
            w := sz;
          END_IF;
          share := LINT_TO_DINT(DINT_TO_LINT(accW + w) * free / sumW - DINT_TO_LINT(accW) * free / sumW);
          accW := accW + w;
          t := sz + share;
          lo := c^.MinAlong(horiz);
          hi := c^.MaxAlong(horiz);
          IF hi > 0 AND t > hi THEN
            c^.SetLaySize(MAX(hi, sz));
            c^.SetLayFixed(TRUE);
            clamped := TRUE;
          ELSIF t < lo THEN
            c^.SetLaySize(MIN(lo, sz));
            c^.SetLayFixed(TRUE);
            clamped := TRUE;
          ELSIF t < 0 THEN
            c^.SetLaySize(0);
            c^.SetLayFixed(TRUE);
            clamped := TRUE;
          ELSE
            c^.SetLayWant(t);
          END_IF;
        END_IF;
      END_FOR;
      IF NOT clamped THEN
        FOR i := 0 TO N - 1 DO
          Kids[i]^.SetLaySize(Kids[i]^.GetLayWant());
        END_FOR;
        EXIT;
      END_IF;
    END_FOR;
    pos := Padding;
    FOR i := 0 TO N - 1 DO
      c := Kids[i];
      c^.SetFrame(FK, FOX, FOY, FClip, FCX, FCY, FCW, FCH, FALSE);
      IF c^.Visible AND NOT c^.Floating THEN
        cs := c^.Limited(cross, c^.MinAlong(NOT horiz), c^.MaxAlong(NOT horiz));
        sz := c^.GetLaySize();
        IF horiz THEN
          c^.Place(Left + pos, Top + Padding, sz, cs);
        ELSE
          c^.Place(Left + Padding, Top + pos, cs, sz);
        END_IF;
        pos := pos + sz + Gap;
      END_IF;
    END_FOR;
    Place := TRUE;
  END_METHOD
  (* Along the stack: the children's sizes plus gaps; across it: the largest child. *)
  METHOD INTERNAL Natural : DINT
    VAR_INPUT Horizontal : BOOL; END_VAR
    VAR i : INT; along : BOOL; acc : DINT; c : POINTER TO HmiElement; END_VAR
    along := SideBySide() = Horizontal;
    FOR i := 0 TO N - 1 DO
      c := Kids[i];
      IF c^.Visible AND NOT c^.Floating THEN
        IF along THEN
          acc := acc + c^.Basis(Horizontal);
        ELSE
          acc := MAX(acc, c^.Basis(Horizontal));
        END_IF;
      END_IF;
    END_FOR;
    IF along AND VisibleKids() > 1 THEN
      acc := acc + Gap * INT_TO_DINT(VisibleKids() - 1);
    END_IF;
    (* An empty container keeps room for a drop target. *)
    IF N = 0 THEN
      acc := 48;
    END_IF;
    Natural := acc + 2 * Padding;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := Natural(TRUE);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := Natural(FALSE);
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    IF Fill <> COLOR.Transparent THEN
      HMI_FillRect(Left, Top, Width, Height, 10, Fill);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Lays its children out side by side, left to right, each as tall as the stack. *)
{attribute 'hmi_palette' := 'Containers'}
FUNCTION_BLOCK HmiVerticalStack EXTENDS HmiStack
  METHOD PROTECTED OVERRIDE SideBySide : BOOL
    SideBySide := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Lays its children out top to bottom, each as wide as the stack. *)
{attribute 'hmi_palette' := 'Containers'}
FUNCTION_BLOCK HmiHorizontalStack EXTENDS HmiStack
END_FUNCTION_BLOCK

(* Free placement for process diagrams. Children sit at X, Y in design units and the whole drawing, text and lines
   included, scales to the room the parent gives it. Below MinScalePct it stops shrinking and pans. The drawing is
   DesignW x DesignH, or, where either is 0, as large as its children reach. *)
{attribute 'hmi_palette' := 'Containers'}
FUNCTION_BLOCK HmiDiagram EXTENDS HmiContainer
  VAR_INPUT
    DesignW : DINT := 0;
    DesignH : DINT := 0;
    (* Smallest scale in percent, at least 1, before the drawing stops shrinking and pans instead. *)
    MinScalePct : DINT := 50;
    (* Snap step the designer uses when moving children, in design units. *)
    Grid : DINT := 10;
    {attribute 'hmi_color'}
    Border : UDINT := COLOR.Transparent;
  END_VAR
  VAR_OUTPUT
    (* Current scale in percent. *)
    ScalePct : DINT;
  END_VAR
  VAR
    kq16, panX, panY, lastX, lastY, offX, offY, cw, ch, dw, dh : DINT;
    panning : BOOL;
    Parts : ARRAY[0..255] OF POINTER TO HmiElement;
    NP : INT;
  END_VAR

  METHOD INTERNAL OVERRIDE AddChild : BOOL
    VAR_INPUT Child : POINTER TO HmiElement; END_VAR
    IF NP < 256 THEN
      Parts[NP] := Child;
      NP := NP + 1;
      AddChild := TRUE;
    END_IF;
  END_METHOD
  (* The drawing's size in design units: DesignW and DesignH, else the children's reach plus a grid step. *)
  METHOD PRIVATE Measure : BOOL
    VAR i : INT; c : POINTER TO HmiElement; ex, ey : DINT; END_VAR
    ex := 0;
    ey := 0;
    IF DesignW <= 0 OR DesignH <= 0 THEN
      FOR i := 0 TO NP - 1 DO
        c := Parts[i];
        ex := MAX(ex, c^.X + c^.Basis(TRUE));
        ey := MAX(ey, c^.Y + c^.Basis(FALSE));
      END_FOR;
    END_IF;
    dw := SEL(DesignW > 0, MAX(ex + MAX(Grid, 0), 240), DesignW);
    dh := SEL(DesignH > 0, MAX(ey + MAX(Grid, 0), 140), DesignH);
    Measure := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    Measure();
    NaturalWidth := SEL(DesignW > 0, dw, DesignW / 2);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    Measure();
    NaturalHeight := SEL(DesignH > 0, dh, DesignH / 2);
  END_METHOD
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := CanPan();
  END_METHOD
  METHOD INTERNAL CanPan : BOOL
    CanPan := cw > Width OR ch > Height;
  END_METHOD
  METHOD OVERRIDE Place : BOOL
    VAR_INPUT PX, PY, PW, PH : DINT; END_VAR
    VAR i : INT; c : POINTER TO HmiElement; nk, nox, noy, sx, sy, sw, sh : DINT; END_VAR
    Left := PX;
    Top := PY;
    Width := MAX(PW, 0);
    Height := MAX(PH, 0);
    Measure();
    kq16 := LINT_TO_DINT(MIN(DINT_TO_LINT(Width) * 65536 / MAX(dw, 1), DINT_TO_LINT(Height) * 65536 / MAX(dh, 1)));
    kq16 := MAX(kq16, MAX(MinScalePct, 1) * 65536 / 100);
    ScalePct := kq16 * 100 / 65536;
    cw := LINT_TO_DINT(DINT_TO_LINT(dw) * kq16 / 65536);
    ch := LINT_TO_DINT(DINT_TO_LINT(dh) * kq16 / 65536);
    IF cw <= Width THEN
      offX := (Width - cw) / 2;
      panX := 0;
    ELSE
      panX := LIMIT(Width - cw, panX, 0);
      offX := panX;
    END_IF;
    IF ch <= Height THEN
      offY := (Height - ch) / 2;
      panY := 0;
    ELSE
      panY := LIMIT(Height - ch, panY, 0);
      offY := panY;
    END_IF;
    (* Children's frame: design units to this element's units to the screen, clipped to the diagram. *)
    nk := LINT_TO_DINT(DINT_TO_LINT(FK) * kq16 / 65536);
    nox := ScrX(Left + offX);
    noy := ScrY(Top + offY);
    sx := ScrX(Left);
    sy := ScrY(Top);
    sw := ScrLen(Width);
    sh := ScrLen(Height);
    IF FClip THEN
      sw := MIN(sx + sw, FCX + FCW);
      sh := MIN(sy + sh, FCY + FCH);
      sx := MAX(sx, FCX);
      sy := MAX(sy, FCY);
      sw := MAX(sw - sx, 0);
      sh := MAX(sh - sy, 0);
    END_IF;
    FOR i := 0 TO NP - 1 DO
      c := Parts[i];
      c^.SetFrame(nk, nox, noy, TRUE, sx, sy, sw, sh, TRUE);
      c^.Place(c^.X, c^.Y, c^.Basis(TRUE), c^.Basis(FALSE));
    END_FOR;
    Place := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    IF NOT Visible THEN
      panning := FALSE;
      RETURN;
    END_IF;
    IF HMI_PtrPressed() AND PointerOver() AND CanPan() THEN
      panning := TRUE;
      lastX := HMI_PtrX();
      lastY := HMI_PtrY();
      HMI_PtrConsume();
      Input := TRUE;
    ELSIF panning THEN
      IF HMI_PtrDown() AND HMI_PtrX() <> -1000000000 THEN
        panX := panX + HMI_PtrX() - lastX;
        panY := panY + HMI_PtrY() - lastY;
        lastX := HMI_PtrX();
        lastY := HMI_PtrY();
      ELSE
        panning := FALSE;
      END_IF;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    IF DesignMode() THEN
      RecordBounds(-(Id * 8 + 7) - 1, Left + offX, Top + offY, kq16, 0, FALSE);
    END_IF;
    IF Fill <> COLOR.Transparent THEN
      HMI_FillRect(Left, Top, Width, Height, 0, Fill);
    END_IF;
    IF Border <> COLOR.Transparent THEN
      HMI_StrokeRect(Left, Top, Width, Height, 0, 1, Border);
    END_IF;
    (* Scroll hints while the drawing is larger than its room. *)
    IF cw > Width THEN
      HMI_FillRect(Left - offX * Width / cw, Top + Height - 5, Width * Width / cw, 4, 2, HMI_Alpha(COLOR.TextMuted, 50));
    END_IF;
    IF ch > Height THEN
      HMI_FillRect(Left + Width - 5, Top - offY * Height / ch, 4, Height * Height / ch, 2, HMI_Alpha(COLOR.TextMuted, 50));
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`
