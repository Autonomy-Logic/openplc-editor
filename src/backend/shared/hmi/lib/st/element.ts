/** StandardWidgets ST source: IHmiElement and HmiElement, the base of every visual element. */
export const ELEMENT_ST = `(* What screen code may ask any element: where layout put it and how big it wants to be. *)
INTERFACE IHmiElement
  METHOD Right : DINT
  END_METHOD
  METHOD Bottom : DINT
  END_METHOD
  METHOD CenterX : DINT
  END_METHOD
  METHOD CenterY : DINT
  END_METHOD
  METHOD Below : DINT
    VAR_INPUT Gap : DINT; END_VAR
  END_METHOD
  METHOD After : DINT
    VAR_INPUT Gap : DINT; END_VAR
  END_METHOD
  METHOD Contains : BOOL
    VAR_INPUT PX, PY : DINT; END_VAR
  END_METHOD
  METHOD PointerOver : BOOL
  END_METHOD
  METHOD MeasureWidth : DINT
  END_METHOD
  METHOD MeasureHeight : DINT
  END_METHOD
  METHOD Place : BOOL
    VAR_INPUT PX, PY, PW, PH : DINT; END_VAR
  END_METHOD
END_INTERFACE

(* Base of every visual element. Containers place elements; an element knows its own size. Widget authors override
   the PROTECTED methods: Draw, Input, NaturalWidth, NaturalHeight, NaturalGrow, TakesInput, Prepare and the ports. *)
FUNCTION_BLOCK ABSTRACT HmiElement IMPLEMENTS IHmiElement
  VAR_INPUT
    (* Container this element sits in, by name; empty means the screen. Read by the HMI build. *)
    {attribute 'hmi_group' := 'layout'}
    {attribute 'hmi_element_ref'}
    Parent : STRING(64);
    (* Preferred size in lu; 0 means the element's natural size. *)
    {attribute 'hmi_group' := 'layout'}
    PrefWidth : DINT;
    {attribute 'hmi_group' := 'layout'}
    PrefHeight : DINT;
    (* Size limits a container keeps to; 0 means no limit. *)
    {attribute 'hmi_group' := 'layout'}
    MinWidth : DINT;
    {attribute 'hmi_group' := 'layout'}
    MaxWidth : DINT;
    {attribute 'hmi_group' := 'layout'}
    MinHeight : DINT;
    {attribute 'hmi_group' := 'layout'}
    MaxHeight : DINT;
    (* Share of the space left over in the container, used when GrowAuto is FALSE. *)
    {attribute 'hmi_group' := 'layout'}
    Grow : DINT;
    (* TRUE: the element's own choice of growing (NaturalGrow) instead of Grow. *)
    {attribute 'hmi_group' := 'layout'}
    GrowAuto : BOOL := TRUE;
    (* Left out of container layout; the screen's code places it with Place. *)
    {attribute 'hmi_group' := 'layout'}
    Floating : BOOL;
    (* Position inside a diagram, in the diagram's design units. Ignored by stacks. *)
    {attribute 'hmi_group' := 'layout'}
    X : DINT;
    {attribute 'hmi_group' := 'layout'}
    Y : DINT;
    Visible : BOOL := TRUE;
    Enabled : BOOL := TRUE;
  END_VAR
  VAR_OUTPUT
    (* Where layout put the element this frame, in lu. *)
    Left : DINT;
    Top : DINT;
    Width : DINT;
    Height : DINT;
  END_VAR
  VAR
    Id : DINT;
    (* Frame the element draws through: scale Q16 (65536 = 1), offsets and clip in 1/16 lu. *)
    FK : DINT := 65536;
    FOX, FOY, FCX, FCY, FCW, FCH : DINT;
    FClip, Framed, ShowPorts : BOOL;
  END_VAR

  METHOD Right : DINT
    Right := Left + Width;
  END_METHOD
  METHOD Bottom : DINT
    Bottom := Top + Height;
  END_METHOD
  METHOD CenterX : DINT
    CenterX := Left + Width / 2;
  END_METHOD
  METHOD CenterY : DINT
    CenterY := Top + Height / 2;
  END_METHOD
  (* Just under the element, Gap lu away. *)
  METHOD Below : DINT
    VAR_INPUT Gap : DINT; END_VAR
    Below := Top + Height + Gap;
  END_METHOD
  (* Just right of the element, Gap lu away. *)
  METHOD After : DINT
    VAR_INPUT Gap : DINT; END_VAR
    After := Left + Width + Gap;
  END_METHOD
  METHOD Contains : BOOL
    VAR_INPUT PX, PY : DINT; END_VAR
    Contains := PX >= Left AND PX < Left + Width AND PY >= Top AND PY < Top + Height;
  END_METHOD
  (* The pointer is on the element. Touch areas are at least 28 lu on screen; where they overlap, the element under
     the pointer wins, else the nearest one. *)
  METHOD PointerOver : BOOL
    VAR mx, my, px, py, owner : DINT; END_VAR
    px := HMI_PtrX();
    py := HMI_PtrY();
    IF Contains(px, py) THEN
      PointerOver := TRUE;
      RETURN;
    END_IF;
    IF FK <= 0 THEN
      RETURN;
    END_IF;
    mx := MAX(0, (1835008 / FK - Width) / 2);
    my := MAX(0, (1835008 / FK - Height) / 2);
    IF px >= Left - mx AND px < Left + Width + mx AND py >= Top - my AND py < Top + Height + my THEN
      owner := PtrOwner();
      PointerOver := owner = 0 OR owner = Id;
    END_IF;
  END_METHOD
  (* Width the element is given by a container that has room, within MinWidth and MaxWidth. *)
  METHOD MeasureWidth : DINT
    IF PrefWidth > 0 THEN
      MeasureWidth := PrefWidth;
    ELSE
      MeasureWidth := NaturalWidth();
    END_IF;
    MeasureWidth := Limited(MeasureWidth, MinWidth, MaxWidth);
  END_METHOD
  METHOD MeasureHeight : DINT
    IF PrefHeight > 0 THEN
      MeasureHeight := PrefHeight;
    ELSE
      MeasureHeight := NaturalHeight();
    END_IF;
    MeasureHeight := Limited(MeasureHeight, MinHeight, MaxHeight);
  END_METHOD
  (* The measured size fits in AvailW x AvailH. *)
  METHOD Fits : BOOL
    VAR_INPUT AvailW, AvailH : DINT; END_VAR
    Fits := MeasureWidth() <= AvailW AND MeasureHeight() <= AvailH;
  END_METHOD
  (* Gives the element its rectangle; containers also arrange their children. Screen code places Floating elements. *)
  METHOD Place : BOOL
    VAR_INPUT PX, PY, PW, PH : DINT; END_VAR
    Left := PX;
    Top := PY;
    Width := MAX(PW, 0);
    Height := MAX(PH, 0);
    Place := TRUE;
  END_METHOD

  (* ---- override surface ---- *)
  (* Natural size; 0 means flexible. *)
  METHOD PROTECTED NaturalWidth : DINT
    NaturalWidth := 0;
  END_METHOD
  METHOD PROTECTED NaturalHeight : DINT
    NaturalHeight := 0;
  END_METHOD
  (* Share of leftover space the element takes when GrowAuto is TRUE. *)
  METHOD PROTECTED NaturalGrow : DINT
    NaturalGrow := 1;
  END_METHOD
  (* TRUE for controls: their touch area takes part in pointer arbitration. *)
  METHOD PROTECTED TakesInput : BOOL
    TakesInput := FALSE;
  END_METHOD
  (* Runs before drawing; elements whose geometry depends on others (pipes) compute it here. *)
  METHOD PROTECTED Prepare : BOOL
    Prepare := TRUE;
  END_METHOD
  METHOD PROTECTED Draw : BOOL
    Draw := FALSE;
  END_METHOD
  (* Runs every frame, topmost element first, also when hidden or disabled; TRUE when it took the pointer. *)
  METHOD PROTECTED Input : BOOL
    Input := FALSE;
  END_METHOD
  METHOD PROTECTED PortCount : INT
    PortCount := 4;
  END_METHOD
  (* Connection ports, in the same units as Left and Top. *)
  METHOD PROTECTED PortX : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    IF Port = HMI_PORT#Right THEN
      PortX := Left + Width;
    ELSIF Port = HMI_PORT#Left THEN
      PortX := Left;
    ELSE
      PortX := Left + Width / 2;
    END_IF;
  END_METHOD
  METHOD PROTECTED PortY : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    IF Port = HMI_PORT#Top THEN
      PortY := Top;
    ELSIF Port = HMI_PORT#Bottom THEN
      PortY := Top + Height;
    ELSE
      PortY := Top + Height / 2;
    END_IF;
  END_METHOD
  (* Direction a pipe leaves the port. *)
  METHOD PROTECTED PortDir : HMI_PORT
    VAR_INPUT Port : HMI_PORT; END_VAR
    PortDir := Port;
  END_METHOD
  (* Opens the on-screen keyboard for this element, starting from Text. *)
  METHOD PROTECTED KeyboardOpen : BOOL
    VAR_INPUT Text : STRING; Title : STRING; Numeric : BOOL; END_VAR
    {external hmi_kbd_open((int32_t)ID.get(), TEXT.get().c_str(), (int)TEXT.get().length(), TITLE.get().c_str(), (int)TITLE.get().length(), NUMERIC.get() ? 1 : 0); }
    KeyboardOpen := TRUE;
  END_METHOD
  (* TRUE once after the operator confirmed this element's keyboard; KeyboardText then holds the entry. *)
  METHOD PROTECTED KeyboardTake : BOOL
    {external KEYBOARDTAKE_result.set(hmi_kbd_take((int32_t)ID.get()) != 0); }
  END_METHOD
  METHOD PROTECTED KeyboardText : STRING
    {external KEYBOARDTEXT_result.set(hmi_kbd_text()); }
  END_METHOD
  (* The keyboard is open for this element. *)
  METHOD PROTECTED KeyboardFocused : BOOL
    {external KEYBOARDFOCUSED_result.set(hmi_kbd_is_open() != 0 && hmi_kbd_owner() == (int32_t)ID.get()); }
  END_METHOD

  (* ---- engine ---- *)
  METHOD INTERNAL Limited : DINT
    VAR_INPUT V, Lo, Hi : DINT; END_VAR
    Limited := V;
    IF Hi > 0 THEN Limited := MIN(Limited, Hi); END_IF;
    IF Lo > 0 THEN Limited := MAX(Limited, Lo); END_IF;
  END_METHOD
  METHOD INTERNAL ElementId : DINT
    ElementId := Id;
  END_METHOD
  METHOD INTERNAL SetId : BOOL
    VAR_INPUT NewId : DINT; END_VAR
    Id := NewId;
    SetId := TRUE;
  END_METHOD
  (* Size along one axis a container starts from; 0 when hidden. *)
  METHOD INTERNAL Basis : DINT
    VAR_INPUT Horizontal : BOOL; END_VAR
    IF NOT Visible THEN
      Basis := 0;
    ELSIF Horizontal THEN
      Basis := MeasureWidth();
    ELSE
      Basis := MeasureHeight();
    END_IF;
  END_METHOD
  METHOD INTERNAL MinAlong : DINT
    VAR_INPUT Horizontal : BOOL; END_VAR
    MinAlong := SEL(Horizontal, MinHeight, MinWidth);
  END_METHOD
  METHOD INTERNAL MaxAlong : DINT
    VAR_INPUT Horizontal : BOOL; END_VAR
    MaxAlong := SEL(Horizontal, MaxHeight, MaxWidth);
  END_METHOD
  METHOD INTERNAL GetGrow : DINT
    IF NOT Visible THEN
      GetGrow := 0;
    ELSIF GrowAuto THEN
      GetGrow := NaturalGrow();
    ELSE
      GetGrow := MAX(Grow, 0);
    END_IF;
  END_METHOD
  (* Frame the element draws through, set by its container before Place. Ports: also report connection ports. *)
  METHOD INTERNAL SetFrame : BOOL
    VAR_INPUT K, OX, OY : DINT; Clip : BOOL; CX, CY, CW, CH : DINT; Ports : BOOL; END_VAR
    FK := K;
    FOX := OX;
    FOY := OY;
    FClip := Clip;
    FCX := CX;
    FCY := CY;
    FCW := CW;
    FCH := CH;
    ShowPorts := Ports;
    Framed := Clip OR K <> 65536 OR OX <> 0 OR OY <> 0;
    SetFrame := TRUE;
  END_METHOD
  (* Local lu to screen 1/16 lu through this element's frame. *)
  METHOD INTERNAL ScrX : DINT
    VAR_INPUT V : DINT; END_VAR
    ScrX := FOX + ScrLen(V);
  END_METHOD
  METHOD INTERNAL ScrY : DINT
    VAR_INPUT V : DINT; END_VAR
    ScrY := FOY + ScrLen(V);
  END_METHOD
  METHOD INTERNAL ScrLen : DINT
    VAR_INPUT V : DINT; END_VAR
    ScrLen := LINT_TO_DINT(DINT_TO_LINT(V) * 16 * DINT_TO_LINT(FK) / 65536);
  END_METHOD
  METHOD INTERNAL PortAt : HMI_PORT
    VAR_INPUT N : INT; END_VAR
    CASE N OF
      0: PortAt := HMI_PORT#Top;
      1: PortAt := HMI_PORT#Right;
      2: PortAt := HMI_PORT#Bottom;
    ELSE
      PortAt := HMI_PORT#Left;
    END_CASE;
  END_METHOD
  METHOD INTERNAL PortXOf : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    PortXOf := PortX(Port);
  END_METHOD
  METHOD INTERNAL PortYOf : DINT
    VAR_INPUT Port : HMI_PORT; END_VAR
    PortYOf := PortY(Port);
  END_METHOD
  METHOD INTERNAL PortDirOf : HMI_PORT
    VAR_INPUT Port : HMI_PORT; END_VAR
    PortDirOf := PortDir(Port);
  END_METHOD
  METHOD INTERNAL PtrOwner : DINT
    {external PTROWNER_result.set(hmi_ptr_owner()); }
  END_METHOD
  METHOD INTERNAL ApplyFrame : BOOL
    {external hmi_frame_set(FK.get(), FOX.get(), FOY.get(), FCLIP.get() ? 1 : 0, FCX.get(), FCY.get(), FCW.get(), FCH.get()); }
    ApplyFrame := TRUE;
  END_METHOD
  METHOD INTERNAL ResetFrame : BOOL
    {external hmi_frame_reset(); }
    ResetFrame := TRUE;
  END_METHOD
  METHOD INTERNAL ClipToFrame : BOOL
    {external hmi_frame_clip(); }
    ClipToFrame := TRUE;
  END_METHOD
  METHOD INTERNAL RecordBounds : BOOL
    VAR_INPUT RId, RX, RY, RW, RH : DINT; Input : BOOL; END_VAR
    {external hmi_elem_bounds_in((int32_t)RID.get(), RX.get(), RY.get(), RW.get(), RH.get(), INPUT.get() ? 1 : 0); }
    RecordBounds := TRUE;
  END_METHOD
  METHOD INTERNAL DesignMode : BOOL
    {external DESIGNMODE_result.set(hmi_design_mode() != 0); }
  END_METHOD
  METHOD INTERNAL Render : BOOL
    VAR p : INT; port : HMI_PORT; END_VAR
    IF NOT Visible THEN
      RETURN;
    END_IF;
    Prepare();
    IF Framed THEN
      ApplyFrame();
      ClipToFrame();
    END_IF;
    RecordBounds(Id, Left, Top, Width, Height, TakesInput() AND Enabled);
    IF ShowPorts AND DesignMode() THEN
      FOR p := 0 TO PortCount() - 1 DO
        port := PortAt(p);
        RecordBounds(-(Id * 8 + INT_TO_DINT(p)) - 1, PortX(port), PortY(port), 0, 0, FALSE);
      END_FOR;
    END_IF;
    Render := Draw();
    IF Framed THEN
      ResetFrame();
      IF FClip THEN
        HMI_Unclip();
      END_IF;
    END_IF;
  END_METHOD
  METHOD INTERNAL HandleInput : BOOL
    IF Framed THEN
      ApplyFrame();
    END_IF;
    HandleInput := Input();
    IF Framed THEN
      ResetFrame();
    END_IF;
  END_METHOD
END_FUNCTION_BLOCK
`
