/** StandardWidgets ST source: the containers, HmiStack and HmiDiagram. */
export const CONTAINERS_ST = `(* Arranges its children in a row or a column. Sizes start from each child's measured size, then leftover space goes
   to the children that grow and missing space is taken from all of them, within each child's minimum and maximum. *)
{attribute 'hmi_palette' := 'Containers'}
FUNCTION_BLOCK HmiStack EXTENDS HmiElement
  VAR_INPUT
    Direction : HMI_DIRECTION := HMI_DIRECTION#Auto;
    Gap : DINT := 8;
    Padding : DINT := 0;
    {attribute 'hmi_color'}
    Fill : UDINT := COLOR.Transparent;
  END_VAR
  VAR
    Kids : ARRAY[0..63] OF POINTER TO HmiElement;
    N : INT;
  END_VAR

  (* Children run along a row. *)
  METHOD INTERNAL IsRow : BOOL
    IsRow := Direction = HMI_DIRECTION#Row OR (Direction = HMI_DIRECTION#Auto AND Width >= Height);
  END_METHOD
  METHOD INTERNAL AddChild : BOOL
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
      main, cross, free, sumW, accW, w, share, t, lo, hi, pos, cs : DINT;
      size, want : ARRAY[0..63] OF DINT;
      fixed : ARRAY[0..63] OF BOOL;
      c : POINTER TO HmiElement;
    END_VAR
    Left := PX;
    Top := PY;
    Width := MAX(PW, 0);
    Height := MAX(PH, 0);
    horiz := IsRow();
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
      fixed[i] := NOT c^.Visible OR c^.Floating;
      IF fixed[i] THEN
        size[i] := 0;
      ELSE
        size[i] := c^.Basis(horiz);
      END_IF;
    END_FOR;
    (* Each pass fixes the children that hit a limit, so at most N + 1 passes. *)
    FOR pass := 0 TO N DO
      free := main;
      FOR i := 0 TO N - 1 DO
        free := free - size[i];
      END_FOR;
      IF free = 0 THEN
        EXIT;
      END_IF;
      sumW := 0;
      FOR i := 0 TO N - 1 DO
        IF NOT fixed[i] THEN
          IF free > 0 THEN
            sumW := sumW + Kids[i]^.GetGrow();
          ELSE
            sumW := sumW + size[i];
          END_IF;
        END_IF;
      END_FOR;
      IF sumW = 0 THEN
        EXIT;
      END_IF;
      accW := 0;
      clamped := FALSE;
      FOR i := 0 TO N - 1 DO
        want[i] := size[i];
        IF NOT fixed[i] THEN
          IF free > 0 THEN
            w := Kids[i]^.GetGrow();
          ELSE
            w := size[i];
          END_IF;
          share := LINT_TO_DINT(DINT_TO_LINT(accW + w) * free / sumW - DINT_TO_LINT(accW) * free / sumW);
          accW := accW + w;
          t := size[i] + share;
          lo := Kids[i]^.MinAlong(horiz);
          hi := Kids[i]^.MaxAlong(horiz);
          IF hi > 0 AND t > hi THEN
            size[i] := MAX(hi, size[i]);
            fixed[i] := TRUE;
            clamped := TRUE;
          ELSIF t < lo THEN
            size[i] := MIN(lo, size[i]);
            fixed[i] := TRUE;
            clamped := TRUE;
          ELSIF t < 0 THEN
            size[i] := 0;
            fixed[i] := TRUE;
            clamped := TRUE;
          ELSE
            want[i] := t;
          END_IF;
        END_IF;
      END_FOR;
      IF NOT clamped THEN
        FOR i := 0 TO N - 1 DO
          size[i] := want[i];
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
        IF horiz THEN
          c^.Place(Left + pos, Top + Padding, size[i], cs);
        ELSE
          c^.Place(Left + Padding, Top + pos, cs, size[i]);
        END_IF;
        pos := pos + size[i] + Gap;
      END_IF;
    END_FOR;
    Place := TRUE;
  END_METHOD
  (* Along the stack: the children's sizes plus gaps; across it: the largest child. *)
  METHOD INTERNAL Natural : DINT
    VAR_INPUT Horizontal : BOOL; END_VAR
    VAR i : INT; along : BOOL; acc : DINT; c : POINTER TO HmiElement; END_VAR
    along := (Direction <> HMI_DIRECTION#Column) = Horizontal;
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
  (* Containers keep their natural size unless told to grow. *)
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 0;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    IF Fill <> COLOR.Transparent THEN
      HMI_FillRect(Left, Top, Width, Height, 10, Fill);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Free placement for process diagrams. Children sit at X, Y in design units (DesignW x DesignH) and the whole drawing,
   text and lines included, scales to the room the parent gives it. Below MinScalePct it stops shrinking and pans. *)
{attribute 'hmi_palette' := 'Containers'}
FUNCTION_BLOCK HmiDiagram EXTENDS HmiStack
  VAR_INPUT
    DesignW : DINT := 1600;
    DesignH : DINT := 900;
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
    kq16, panX, panY, lastX, lastY, offX, offY, cw, ch : DINT;
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
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := DesignW / 2;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := DesignH / 2;
  END_METHOD
  (* A diagram takes the room it is given. *)
  METHOD PROTECTED OVERRIDE NaturalGrow : DINT
    NaturalGrow := 1;
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
    kq16 := LINT_TO_DINT(MIN(DINT_TO_LINT(Width) * 65536 / MAX(DesignW, 1), DINT_TO_LINT(Height) * 65536 / MAX(DesignH, 1)));
    kq16 := MAX(kq16, MAX(MinScalePct, 1) * 65536 / 100);
    ScalePct := kq16 * 100 / 65536;
    cw := LINT_TO_DINT(DINT_TO_LINT(DesignW) * kq16 / 65536);
    ch := LINT_TO_DINT(DINT_TO_LINT(DesignH) * kq16 / 65536);
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
