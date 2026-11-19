(* Test screens for the StandardWidgets headless frames. Build and WriteBack are written by hand the way the HMI build
   generates them, and declarations set the type defaults (hmi_default) the build would. The globals stand for the
   PLC variables screens are wired to. *)
VAR_GLOBAL
  Run, PumpOn, ValveOpen, Held, GoHome : BOOL;
  Clicks, Shows, Hides, LayoutW1, LayoutW2, LayoutW3, LayoutX4 : DINT;
  NestTankX, NestTankW, NestSideX, NestFillX, NestFillY, NestDrainY : DINT;
  Speed, Level, Setpoint, Flow : REAL;
  Name : STRING(16) := 'Tank 1';
  State : INT := 1;
  Now : DT := DT#2026-11-18-14:32:07;
  Latch, Jog, Rinse : BOOL;
  Mode, Recipe : INT := 1;
  Hoa : INT;
  Batch : REAL := 250.0;
  Dial : REAL := 40.0;
END_VAR

(* Page 0: display widgets and a shape. *)
FUNCTION_BLOCK DisplayScreen EXTENDS HmiScreen
  VAR
    Title : HmiLabel := (Text := 'Display widgets', Size := 20, Font := HMI_FONT#Bold);
    RowA : HmiVerticalStack := (Gap := 8, GrowAuto := TRUE);
    RowB : HmiVerticalStack := (Gap := 8, GrowAuto := TRUE);
    Speed1 : HmiValue := (Caption := 'Speed', Unit := 'rpm', Decimals := 0);
    LampOn : HmiLamp := (Caption := 'Running', Value := TRUE);
    LampOff : HmiLamp := (Caption := 'Fault', OnColor := COLOR.Danger);
    Gauge1 : HmiGauge := (Caption := 'Load', MinValue := 0.0, MaxValue := 200.0, GrowAuto := TRUE);
    Tank1 : HmiTank := (Caption := 'Level', Unit := 'm', MaxValue := 10.0);
    Readout1 : HmiReadout := (Caption := 'FT-101', Unit := 'GPM');
    Box : HmiRect := (Fill := COLOR.Accent, Radius := 4, PrefWidth := 60, PrefHeight := 40, GrowAuto := TRUE);
    Plain : HmiLabel := (Text := 'Right', Align := HMI_ALIGN#Right, TextColor := COLOR.TextMuted, GrowAuto := TRUE);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Title), 0);
    Attach(ADR(RowA), 0);
    Attach(ADR(Speed1), ADR(RowA));
    Attach(ADR(LampOn), ADR(RowA));
    Attach(ADR(LampOff), ADR(RowA));
    Attach(ADR(Box), ADR(RowA));
    Attach(ADR(RowB), 0);
    Attach(ADR(Gauge1), ADR(RowB));
    Attach(ADR(Tank1), ADR(RowB));
    Attach(ADR(Readout1), ADR(RowB));
    Attach(ADR(Plain), ADR(RowB));
    Build := TRUE;
  END_METHOD
  Speed1.Value := Speed;
  Gauge1.Value := Speed;
  Tank1.Value := Level;
  Readout1.Value := Flow;
  LampOff.Value := Run;
END_FUNCTION_BLOCK

(* Page 1: trend and vessel over time. *)
FUNCTION_BLOCK TrendScreen EXTENDS HmiScreen
  VAR
    Row : HmiVerticalStack := (Gap := 12, GrowAuto := TRUE);
    Trend1 : HmiTrend := (Caption := 'Level', Unit := 'm', MaxValue := 10.0, SampleMs := 80, Pens := 3, Decimals := 2, Color3 := COLOR.Orange, GrowAuto := TRUE);
    Vessel1 : HmiVessel := (Caption := 'TK-1', Unit := 'm', MaxValue := 10.0, RateUnit := 'GPM', Capacity := '5000 GAL');
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Row), 0);
    Attach(ADR(Trend1), ADR(Row));
    Attach(ADR(Vessel1), ADR(Row));
    UseTheme(2);
    Build := TRUE;
  END_METHOD
  Trend1.Value := Level;
  Trend1.Value2 := Flow / 10.0;
  Trend1.Value3 := 10.0 - Level;
  Vessel1.Value := Level;
  Vessel1.Rate := Flow;
END_FUNCTION_BLOCK

(* Page 2: controls wired with write-back. *)
FUNCTION_BLOCK ControlsScreen EXTENDS HmiScreen
  VAR
    Start : HmiButton := (Text := 'Start');
    RunSwitch : HmiSwitch := (Caption := 'Run');
    SpeedSlider : HmiSlider := (Caption := 'Speed', MaxValue := 200.0, Step := 10.0, Unit := 'rpm', Decimals := 0);
    SetpointIn : HmiNumericInput := (Caption := 'Setpoint', Unit := 'm', Decimals := 2, MinValue := 0.0, MaxValue := 100.0);
    NameIn : HmiTextInput := (Caption := 'Name', MaxLength := 12, Placeholder := 'Tag name');
    Locked : HmiSwitch := (Caption := 'Locked', Enabled := FALSE);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Start), 0);
    Attach(ADR(RunSwitch), 0);
    Attach(ADR(SpeedSlider), 0);
    Attach(ADR(SetpointIn), 0);
    Attach(ADR(NameIn), 0);
    Attach(ADR(Locked), 0);
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE WriteBack : BOOL
    IF RunSwitch.Changed THEN Run := RunSwitch.NewValue; END_IF;
    IF SpeedSlider.Changed THEN Speed := SpeedSlider.NewValue; END_IF;
    IF SetpointIn.Changed THEN Setpoint := SetpointIn.NewValue; END_IF;
    IF NameIn.Changed THEN Name := NameIn.NewValue; END_IF;
    IF Locked.Changed THEN Run := FALSE; END_IF;
    Held := Start.Pressed;
    WriteBack := TRUE;
  END_METHOD
  IF Start.Clicked THEN Clicks := Clicks + 1; END_IF;
  RunSwitch.Value := Run;
  SpeedSlider.Value := Speed;
  SetpointIn.Value := Setpoint;
  NameIn.Value := Name;
END_FUNCTION_BLOCK

(* Page 3: a process diagram, larger than the screen so it pans. *)
FUNCTION_BLOCK DiagramScreen EXTENDS HmiScreen
  VAR
    Plant : HmiDiagram := (DesignW := 800, DesignH := 500, MinScalePct := 100, Border := COLOR.Border, GrowAuto := TRUE);
    Tk : HmiVessel := (Caption := 'TK-1', Unit := 'm', MaxValue := 10.0, X := 40, Y := 40, PrefWidth := 100, PrefHeight := 160);
    P1 : HmiPump := (Caption := 'P-1', X := 260, Y := 230, PrefWidth := 48, PrefHeight := 48);
    V1 : HmiValve := (Caption := 'V-1', X := 420, Y := 240);
    Ft : HmiReadout := (Caption := 'FT', Unit := 'GPM', X := 560, Y := 230);
    L1 : HmiPipe := (Source := 'Tk', SourcePort := HMI_PORT#Bottom, Target := 'P1', TargetPort := HMI_PORT#Left, Animate := TRUE);
    L2 : HmiPipe := (Source := 'P1', SourcePort := HMI_PORT#Top, Target := 'V1', TargetPort := HMI_PORT#Left);
    L3 : HmiPipe := (Source := 'V1', SourcePort := HMI_PORT#Right, Target := 'Ft', TargetPort := HMI_PORT#Left);
    L4 : HmiPipe := (Source := 'Tk', SourcePort := HMI_PORT#Right, Target := 'Ft', TargetPort := HMI_PORT#Bottom, Path := '330,136;330,400;600,400');
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Plant), 0);
    Attach(ADR(L1), ADR(Plant));
    Attach(ADR(L2), ADR(Plant));
    Attach(ADR(L3), ADR(Plant));
    Attach(ADR(L4), ADR(Plant));
    Attach(ADR(Tk), ADR(Plant));
    Attach(ADR(P1), ADR(Plant));
    Attach(ADR(V1), ADR(Plant));
    Attach(ADR(Ft), ADR(Plant));
    Connect(ADR(L1), ADR(Tk), ADR(P1), 0);
    Connect(ADR(L2), ADR(P1), ADR(V1), ADR(L1));
    Connect(ADR(L3), ADR(V1), ADR(Ft), ADR(L2));
    Connect(ADR(L4), ADR(Tk), ADR(Ft), ADR(L3));
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE WriteBack : BOOL
    IF P1.Changed THEN PumpOn := P1.NewValue; END_IF;
    IF V1.Changed THEN ValveOpen := V1.NewValue; END_IF;
    WriteBack := TRUE;
  END_METHOD
  Tk.Value := Level;
  P1.Value := PumpOn;
  V1.Value := ValveOpen;
  L1.Value := PumpOn;
  L2.Value := PumpOn;
  L3.Value := PumpOn AND ValveOpen;
  Ft.Value := Flow;
END_FUNCTION_BLOCK

(* Page 4: stack sizing within limits, and a floating element placed by the screen's code. *)
FUNCTION_BLOCK LayoutScreen EXTENDS HmiScreen
  VAR
    Row : HmiVerticalStack := (Gap := 10, Padding := 6, Fill := COLOR.Surface, GrowAuto := TRUE);
    A : HmiRect := (PrefWidth := 50, MaxWidth := 120, GrowAuto := TRUE);
    B : HmiRect := (PrefWidth := 50, Fill := COLOR.Accent, GrowAuto := TRUE);
    C : HmiRect := (PrefWidth := 300, MinWidth := 80, Fill := COLOR.Warning, MaxHeight := 60, GrowAuto := TRUE);
    Badge : HmiLabel := (Text := 'Floating', Floating := TRUE, Font := HMI_FONT#Bold);
    Hidden : HmiRect := (Visible := FALSE, PrefWidth := 500, GrowAuto := TRUE);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Row), 0);
    Attach(ADR(A), ADR(Row));
    Attach(ADR(Hidden), ADR(Row));
    Attach(ADR(B), ADR(Row));
    Attach(ADR(C), ADR(Row));
    Attach(ADR(Badge), 0);
    UseTheme(5);
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Layout : BOOL
    Badge.Place(B.Left + 4, B.Below(-30), Badge.MeasureWidth(), Badge.MeasureHeight());
    LayoutW1 := A.Width;
    LayoutW2 := B.Width;
    LayoutW3 := C.Width;
    LayoutX4 := Badge.Left;
    Layout := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Page 5: navigation, show and hide hooks. *)
FUNCTION_BLOCK NavScreen EXTENDS HmiScreen
  VAR
    Back : HmiButton := (Text := 'Back');
    Home : HmiButton := (Text := 'Home');
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Back), 0);
    Attach(ADR(Home), 0);
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE OnShow : BOOL
    Shows := Shows + 1;
    OnShow := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE OnHide : BOOL
    Hides := Hides + 1;
    OnHide := TRUE;
  END_METHOD
  IF Back.Clicked THEN HMI_Back(); END_IF;
  IF Home.Clicked THEN GoHome := TRUE; END_IF;
END_FUNCTION_BLOCK

(* Page 6: a diagram allowed to shrink without limit, squeezed to no height, with a control inside. *)
FUNCTION_BLOCK SqueezedScreen EXTENDS HmiScreen
  VAR
    Plant : HmiDiagram := (MinScalePct := 0, Floating := TRUE, GrowAuto := TRUE);
    Go : HmiButton := (Text := 'Go', X := 10, Y := 10);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Plant), 0);
    Attach(ADR(Go), ADR(Plant));
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Layout : BOOL
    Plant.Place(10, 10, 200, 0);
    Layout := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Page 7: shapes beside the rectangle, and animated widgets: fan, conveyor, pump impeller and a blinking lamp. *)
FUNCTION_BLOCK MotionScreen EXTENDS HmiScreen
  VAR
    Shapes : HmiVerticalStack := (Gap := 8, GrowAuto := TRUE);
    Oval : HmiEllipse := (Fill := COLOR.Accent, PrefWidth := 80, PrefHeight := 56, GrowAuto := TRUE);
    Tri : HmiPolygon := (Fill := COLOR.Warning, PrefWidth := 60, PrefHeight := 56, GrowAuto := TRUE);
    Hex : HmiPolygon := (Sides := 6, Rotation := 0, Fill := COLOR.Success, PrefWidth := 60, PrefHeight := 56, GrowAuto := TRUE);
    Star : HmiPolygon := (Sides := 5, InnerPct := 45, Fill := COLOR.Danger, BorderWidth := 0, PrefWidth := 60, PrefHeight := 56, GrowAuto := TRUE);
    Rule : HmiLine := (Angle := 30, Thickness := 3, PrefWidth := 80, PrefHeight := 40, GrowAuto := TRUE);
    Moving : HmiVerticalStack := (Gap := 12, GrowAuto := TRUE);
    Fan1 : HmiFan := (Caption := 'FAN-1', Value := TRUE);
    Fan2 : HmiFan := (Caption := 'FAN-2', Value := TRUE, Fault := TRUE, Blades := 3);
    Pump1 : HmiPump := (Caption := 'P-2', Value := TRUE, PrefWidth := 56, PrefHeight := 56);
    Alarm : HmiLamp := (Caption := 'Alarm', Value := TRUE, Blink := TRUE, OnColor := COLOR.Danger);
    Belt : HmiConveyor := (Caption := 'CV-1', Value := TRUE, PrefWidth := 200);
    Back : HmiConveyor := (Caption := 'CV-2', Value := TRUE, Reverse := TRUE, Speed := 80, PrefWidth := 200);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Shapes), 0);
    Attach(ADR(Oval), ADR(Shapes));
    Attach(ADR(Tri), ADR(Shapes));
    Attach(ADR(Hex), ADR(Shapes));
    Attach(ADR(Star), ADR(Shapes));
    Attach(ADR(Rule), ADR(Shapes));
    Attach(ADR(Moving), 0);
    Attach(ADR(Fan1), ADR(Moving));
    Attach(ADR(Fan2), ADR(Moving));
    Attach(ADR(Pump1), ADR(Moving));
    Attach(ADR(Alarm), ADR(Moving));
    Attach(ADR(Belt), 0);
    Attach(ADR(Back), 0);
    Build := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Page 8: nested stacks. A vertical stack lays a tank beside a horizontal stack of buttons, inside the screen's
   horizontal stack. *)
FUNCTION_BLOCK NestedScreen EXTENDS HmiScreen
  VAR
    Body : HmiHorizontalStack := (GrowAuto := TRUE);
    Split : HmiVerticalStack := (Gap := 12, GrowAuto := TRUE);
    Tank2 : HmiTank := (Caption := 'TK-2', Unit := 'm', MaxValue := 10.0, GrowAuto := TRUE);
    Side : HmiHorizontalStack := (Gap := 6, Padding := 6, Fill := COLOR.Surface, GrowAuto := TRUE);
    Fill1 : HmiButton := (Text := 'Fill');
    Drain : HmiButton := (Text := 'Drain');
    Level2 : HmiValue := (Caption := 'Level', Unit := 'm', Decimals := 2);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Body), 0);
    Attach(ADR(Split), ADR(Body));
    Attach(ADR(Tank2), ADR(Split));
    Attach(ADR(Side), ADR(Split));
    Attach(ADR(Fill1), ADR(Side));
    Attach(ADR(Drain), ADR(Side));
    Attach(ADR(Level2), ADR(Side));
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Layout : BOOL
    NestTankX := Tank2.Left;
    NestTankW := Tank2.Width;
    NestSideX := Side.Left;
    NestFillX := Fill1.Left;
    NestFillY := Fill1.Top;
    NestDrainY := Drain.Top;
    Layout := TRUE;
  END_METHOD
  Tank2.Value := Level;
  Level2.Value := Level;
END_FUNCTION_BLOCK

(* Page 9: indicators. *)
FUNCTION_BLOCK IndicatorScreen EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 8, Padding := 8, GrowAuto := TRUE);
    Lamp : HmiMultiLamp := (Caption := 'Mixer M-1');
    Bar : HmiBarGraph := (Caption := 'Pressure', Unit := 'bar', MaxValue := 10.0, LowZone := 1.5, HighZone := 8.0,
      ShowSetpoint := TRUE, Setpoint := 7.0);
    Prog : HmiProgress := (Caption := 'Batch');
    Leds : HmiVerticalStack := (Gap := 12);
    L1 : HmiLed := (Caption := 'Power', Value := TRUE);
    L2 : HmiLed := (Caption := 'Warn', Value := TRUE, OnColor := COLOR.Warning);
    L3 : HmiLed := (Caption := 'Trip');
    Seg : HmiSevenSegment := (Digits := 5, Decimals := 1);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Col), 0);
    Attach(ADR(Lamp), ADR(Col));
    Attach(ADR(Bar), ADR(Col));
    Attach(ADR(Prog), ADR(Col));
    Attach(ADR(Leds), ADR(Col));
    Attach(ADR(L1), ADR(Leds));
    Attach(ADR(L2), ADR(Leds));
    Attach(ADR(L3), ADR(Leds));
    Attach(ADR(Seg), ADR(Col));
    Build := TRUE;
  END_METHOD
  Lamp.Value := State;
  Bar.Value := Level;
  Prog.Value := 42.0;
  Seg.Value := Speed;
END_FUNCTION_BLOCK

(* Page 10: a thermometer, a level meter, the clock and the date and time of a DT. *)
FUNCTION_BLOCK TimeScreen EXTENDS HmiScreen
  VAR
    Row : HmiVerticalStack := (Gap := 8, Padding := 8, GrowAuto := TRUE);
    Thermo : HmiThermometer;
    Meter : HmiBarGraph := (Caption := 'Tank', Unit := 'm', MaxValue := 10.0, Orientation := HMI_DIRECTION#Column,
      HighZone := 9.0);
    Right : HmiHorizontalStack := (Gap := 8);
    Face : HmiClock;
    Stamp : HmiDateTime;
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Row), 0);
    Attach(ADR(Thermo), ADR(Row));
    Attach(ADR(Meter), ADR(Row));
    Attach(ADR(Right), ADR(Row));
    Attach(ADR(Face), ADR(Right));
    Attach(ADR(Stamp), ADR(Right));
    Build := TRUE;
  END_METHOD
  Thermo.Value := 63.0;
  Meter.Value := Level;
  Face.Value := Now;
  Stamp.Value := Now;
END_FUNCTION_BLOCK

(* Page 11: the latching, selecting and stepping controls, and a drop-down whose list opens over the screen. *)
FUNCTION_BLOCK InputScreen EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 8, Padding := 8, GrowAuto := TRUE);
    RowA : HmiVerticalStack := (Gap := 12);
    RowB : HmiVerticalStack := (Gap := 12);
    RowC : HmiVerticalStack := (Gap := 12);
    Toggle : HmiToggleButton := (OnText := 'PUMP ON', OffText := 'PUMP OFF', MaxHeight := 44);
    JogBtn : HmiLampButton := (Text := 'JOG');
    Hand : HmiSelector;
    Modes : HmiOptionButtons;
    RinseBox : HmiCheckBox := (Caption := 'Rinse');
    Recipes : HmiDropDown := (Caption := 'Recipe', Options := 'Soup;Broth;Sauce;Cream;Stock;Water',
      MaxHeight := 60);
    Batcher : HmiStepper := (Caption := 'Batch', Step := 10.0, MaxValue := 300.0, Unit := 'kg',
      MaxHeight := 64);
    Speed2 : HmiKnob := (Caption := 'Dial', Step := 5.0, PrefWidth := 90, PrefHeight := 104);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Col), 0);
    Attach(ADR(RowA), ADR(Col));
    Attach(ADR(Toggle), ADR(RowA));
    Attach(ADR(JogBtn), ADR(RowA));
    Attach(ADR(Hand), ADR(RowA));
    Attach(ADR(RowB), ADR(Col));
    Attach(ADR(Modes), ADR(RowB));
    Attach(ADR(RinseBox), ADR(RowB));
    Attach(ADR(RowC), ADR(Col));
    Attach(ADR(Recipes), ADR(RowC));
    Attach(ADR(Batcher), ADR(RowC));
    Attach(ADR(Speed2), ADR(RowC));
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE WriteBack : BOOL
    IF Toggle.Changed THEN Latch := Toggle.NewValue; END_IF;
    IF Hand.Changed THEN Hoa := Hand.NewValue; END_IF;
    IF Modes.Changed THEN Mode := Modes.NewValue; END_IF;
    IF RinseBox.Changed THEN Rinse := RinseBox.NewValue; END_IF;
    IF Recipes.Changed THEN Recipe := Recipes.NewValue; END_IF;
    IF Batcher.Changed THEN Batch := Batcher.NewValue; END_IF;
    IF Speed2.Changed THEN Dial := Speed2.NewValue; END_IF;
    Jog := JogBtn.Pressed;
    WriteBack := TRUE;
  END_METHOD
  Toggle.Value := Latch;
  JogBtn.Lamp := Jog;
  Hand.Value := Hoa;
  Modes.Value := Mode;
  RinseBox.Value := Rinse;
  Recipes.Value := Recipe;
  Batcher.Value := Batch;
  Speed2.Value := Dial;
END_FUNCTION_BLOCK

(* Page 12: the drawn process symbols, joined by pipes at their ports. *)
FUNCTION_BLOCK SymbolScreen EXTENDS HmiScreen
  VAR
    Area : HmiDiagram := (DesignW := 464, DesignH := 304, GrowAuto := TRUE);
    Si : HmiSilo := (Caption := 'SI-1', X := 10, Y := 10, PrefWidth := 60, PrefHeight := 150);
    Cv : HmiCheckValve := (X := 96, Y := 196);
    Fcv : HmiControlValve := (Caption := 'FCV-2', X := 150, Y := 166);
    It : HmiInstrument := (Tag := 'FIC', Loop := '102', Unit := 'm3/h', X := 150, Y := 40);
    Tw : HmiThreeWayValve := (X := 240, Y := 172);
    Hx : HmiHeatExchanger := (Caption := 'E-1', X := 200, Y := 250, PrefWidth := 96, PrefHeight := 48);
    Tk : HmiVessel := (Unit := 'm', MaxValue := 10.0, ShowLabels := FALSE, X := 350, Y := 60, PrefWidth := 90, PrefHeight := 160);
    Ag : HmiAgitator := (X := 375, Y := 36, PrefWidth := 40, PrefHeight := 70);
    Mo : HmiMotor := (Caption := 'M-1', X := 360, Y := 236);
    L1 : HmiPipe := (Source := 'Si', SourcePort := HMI_PORT#Bottom, Target := 'Cv', TargetPort := HMI_PORT#Left);
    L2 : HmiPipe := (Source := 'Cv', SourcePort := HMI_PORT#Right, Target := 'Fcv', TargetPort := HMI_PORT#Left);
    L3 : HmiPipe := (Source := 'Fcv', SourcePort := HMI_PORT#Right, Target := 'Tw', TargetPort := HMI_PORT#Left);
    L4 : HmiPipe := (Source := 'Tw', SourcePort := HMI_PORT#Right, Target := 'Tk', TargetPort := HMI_PORT#Left);
    L5 : HmiPipe := (Source := 'Tw', SourcePort := HMI_PORT#Bottom, Target := 'Hx', TargetPort := HMI_PORT#Top);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Area), 0);
    Attach(ADR(L1), ADR(Area));
    Attach(ADR(L2), ADR(Area));
    Attach(ADR(L3), ADR(Area));
    Attach(ADR(L4), ADR(Area));
    Attach(ADR(L5), ADR(Area));
    Attach(ADR(Si), ADR(Area));
    Attach(ADR(Cv), ADR(Area));
    Attach(ADR(Fcv), ADR(Area));
    Attach(ADR(It), ADR(Area));
    Attach(ADR(Tw), ADR(Area));
    Attach(ADR(Hx), ADR(Area));
    Attach(ADR(Tk), ADR(Area));
    Attach(ADR(Ag), ADR(Area));
    Attach(ADR(Mo), ADR(Area));
    Connect(ADR(L1), ADR(Si), ADR(Cv), 0);
    Connect(ADR(L2), ADR(Cv), ADR(Fcv), ADR(L1));
    Connect(ADR(L3), ADR(Fcv), ADR(Tw), ADR(L2));
    Connect(ADR(L4), ADR(Tw), ADR(Tk), ADR(L3));
    Connect(ADR(L5), ADR(Tw), ADR(Hx), ADR(L4));
    Build := TRUE;
  END_METHOD
  Si.Value := Level * 10.0;
  Fcv.Value := 62.0;
  It.Value := Flow;
  Tk.Value := Level;
  Ag.Value := Run;
  Mo.Value := Run;
  L1.Value := TRUE;
  L2.Value := TRUE;
  L3.Value := TRUE;
  L4.Value := NOT Tw.Value;
  L5.Value := Tw.Value;
END_FUNCTION_BLOCK

(* Stand-ins for the PLC's alarm table, event log, summary and arrays, read through hand-written feeds the way the
   HMI build generates them. Scale is the data pages' widget size in per mille. *)
TYPE DemoAlarm :
  STRUCT
    Used, Active, Acked : BOOL;
    Severity : INT;
    Message : STRING(80);
    Raised : DT;
  END_STRUCT;
END_TYPE
TYPE DemoEvent :
  STRUCT
    Seq : UDINT;
    Kind, Severity : INT;
    Message : STRING(80);
    Stamp : DT;
  END_STRUCT;
END_TYPE
VAR_GLOBAL
  DemoAlarms : ARRAY[0..7] OF DemoAlarm;
  DemoEvents : ARRAY[0..9] OF DemoEvent;
  SumValid, SumAcked : BOOL;
  SumSeverity : INT;
  SumMessage : STRING(80);
  SumRaised : DT;
  SumCount, SumUnacked : DINT;
  AckedRow : DINT := -1;
  AckTopHits, AckAllHits : DINT;
  CurveX, PumpY, SystemY : ARRAY[0..20] OF REAL;
  Scale : DINT := 1000;
  DlgOpen : BOOL;
  DlgResult : INT;
  DlgAnswers : DINT;
  ListX, ListY, ListW, ListH, BannerX, BannerY, BannerW, BannerH, LogX, LogY, LogW, LogH : DINT;
END_VAR

FUNCTION_BLOCK DemoAlarmFeed EXTENDS HmiFeed
  METHOD OVERRIDE Count : DINT
    Count := 8;
  END_METHOD
  METHOD OVERRIDE Used : BOOL
    VAR_INPUT I : DINT; END_VAR
    Used := DemoAlarms[I].Used;
  END_METHOD
  METHOD OVERRIDE Active : BOOL
    VAR_INPUT I : DINT; END_VAR
    Active := DemoAlarms[I].Active;
  END_METHOD
  METHOD OVERRIDE Acked : BOOL
    VAR_INPUT I : DINT; END_VAR
    Acked := DemoAlarms[I].Acked;
  END_METHOD
  METHOD OVERRIDE Severity : INT
    VAR_INPUT I : DINT; END_VAR
    Severity := DemoAlarms[I].Severity;
  END_METHOD
  METHOD OVERRIDE Message : STRING(80)
    VAR_INPUT I : DINT; END_VAR
    Message := DemoAlarms[I].Message;
  END_METHOD
  METHOD OVERRIDE Stamp : DT
    VAR_INPUT I : DINT; END_VAR
    Stamp := DemoAlarms[I].Raised;
  END_METHOD
END_FUNCTION_BLOCK

FUNCTION_BLOCK DemoSummaryFeed EXTENDS HmiFeed
  METHOD OVERRIDE Count : DINT
    Count := SumCount;
  END_METHOD
  METHOD OVERRIDE Unacked : DINT
    Unacked := SumUnacked;
  END_METHOD
  METHOD OVERRIDE Used : BOOL
    VAR_INPUT I : DINT; END_VAR
    Used := SumValid;
  END_METHOD
  METHOD OVERRIDE Acked : BOOL
    VAR_INPUT I : DINT; END_VAR
    Acked := SumAcked;
  END_METHOD
  METHOD OVERRIDE Severity : INT
    VAR_INPUT I : DINT; END_VAR
    Severity := SumSeverity;
  END_METHOD
  METHOD OVERRIDE Message : STRING(80)
    VAR_INPUT I : DINT; END_VAR
    Message := SumMessage;
  END_METHOD
  METHOD OVERRIDE Stamp : DT
    VAR_INPUT I : DINT; END_VAR
    Stamp := SumRaised;
  END_METHOD
END_FUNCTION_BLOCK

FUNCTION_BLOCK DemoEventFeed EXTENDS HmiFeed
  METHOD OVERRIDE Count : DINT
    Count := 10;
  END_METHOD
  METHOD OVERRIDE Seq : UDINT
    VAR_INPUT I : DINT; END_VAR
    Seq := DemoEvents[I].Seq;
  END_METHOD
  METHOD OVERRIDE Kind : INT
    VAR_INPUT I : DINT; END_VAR
    Kind := DemoEvents[I].Kind;
  END_METHOD
  METHOD OVERRIDE Severity : INT
    VAR_INPUT I : DINT; END_VAR
    Severity := DemoEvents[I].Severity;
  END_METHOD
  METHOD OVERRIDE Message : STRING(80)
    VAR_INPUT I : DINT; END_VAR
    Message := DemoEvents[I].Message;
  END_METHOD
  METHOD OVERRIDE Stamp : DT
    VAR_INPUT I : DINT; END_VAR
    Stamp := DemoEvents[I].Stamp;
  END_METHOD
END_FUNCTION_BLOCK

(* Which: 0 the flow axis, 1 the pump curve, 2 the system curve. *)
FUNCTION_BLOCK DemoNumbers EXTENDS HmiFeed
  VAR_INPUT Which : INT; END_VAR
  METHOD OVERRIDE Count : DINT
    Count := 21;
  END_METHOD
  METHOD OVERRIDE Number : REAL
    VAR_INPUT I : DINT; END_VAR
    CASE Which OF
      1: Number := PumpY[I];
      2: Number := SystemY[I];
    ELSE
      Number := CurveX[I];
    END_CASE;
  END_METHOD
END_FUNCTION_BLOCK

(* Page 13: alarm banner and alarm list. *)
FUNCTION_BLOCK AlarmScreen EXTENDS HmiScreen
  VAR
    Ban : HmiAlarmBanner;
    List : HmiAlarmList := (GrowAuto := FALSE);
    AlarmFeed : DemoAlarmFeed;
    SummaryFeed : DemoSummaryFeed;
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Ban), 0);
    Attach(ADR(List), 0);
    Ban.SetFeed(0, ADR(SummaryFeed));
    List.SetFeed(0, ADR(AlarmFeed));
    List.SetFeed(1, ADR(SummaryFeed));
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE WriteBack : BOOL
    IF List.AckRow >= 0 THEN
      AckedRow := List.AckRow;
      DemoAlarms[List.AckRow].Acked := TRUE;
    END_IF;
    IF List.AckAll THEN AckAllHits := AckAllHits + 1; END_IF;
    IF Ban.AckTop THEN AckTopHits := AckTopHits + 1; END_IF;
    WriteBack := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Layout : BOOL
    BannerX := Ban.Left; BannerY := Ban.Top; BannerW := Ban.Width; BannerH := Ban.Height;
    ListX := List.Left; ListY := List.Top; ListW := List.Width; ListH := List.Height;
    Layout := TRUE;
  END_METHOD
  Ban.PrefWidth := 460 * Scale / 1000;
  Ban.PrefHeight := 34 * Scale / 1000;
  List.PrefWidth := 520 * Scale / 1000;
  List.PrefHeight := 210 * Scale / 1000;
END_FUNCTION_BLOCK

(* Page 14: event log. *)
FUNCTION_BLOCK LogScreen EXTENDS HmiScreen
  VAR
    Events : HmiEventLog := (GrowAuto := FALSE);
    EventFeed : DemoEventFeed;
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Events), 0);
    Events.SetFeed(0, ADR(EventFeed));
    Build := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Layout : BOOL
    LogX := Events.Left; LogY := Events.Top; LogW := Events.Width; LogH := Events.Height;
    Layout := TRUE;
  END_METHOD
  Events.PrefWidth := 420 * Scale / 1000;
  Events.PrefHeight := 214 * Scale / 1000;
END_FUNCTION_BLOCK

(* Page 15: XY plot with two series and the live point, and the data table. *)
FUNCTION_BLOCK PlotScreen EXTENDS HmiScreen
  VAR
    Plot : HmiXYPlot := (Series := 2, XMax := 100.0, YMax := 50.0, XLabel := 'Flow (m3/h)', YLabel := 'Head (m)',
      XUnit := 'm3/h', YUnit := 'm', Name1 := 'Pump', Name2 := 'System', ShowLive := TRUE, LiveX := 68.0, LiveY := 19.0,
      GrowAuto := FALSE);
    Table : HmiDataTable := (Value := 68.2, Value2 := 1.84, Value3 := 91.6, Value4 := 92.4, Decimals := 1,
      Tag := 'FT-101', Tag2 := 'PT-101', Tag3 := 'TT-201', Tag4 := 'LT-101', Text := 'Inlet flow',
      Text2 := 'Discharge pressure', Text3 := 'Product temperature', Text4 := 'Tank level', Unit := 'm3/h',
      Unit2 := 'bar', Unit3 := 'C', Unit4 := '%', Status2 := COLOR.Warning, Status4 := COLOR.Danger);
    XFeed : DemoNumbers := (Which := 0);
    PumpFeed : DemoNumbers := (Which := 1);
    SystemFeed : DemoNumbers := (Which := 2);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Plot), 0);
    Attach(ADR(Table), 0);
    Plot.SetFeed(0, ADR(XFeed));
    Plot.SetFeed(1, ADR(PumpFeed));
    Plot.SetFeed(3, ADR(SystemFeed));
    Build := TRUE;
  END_METHOD
  Plot.PrefWidth := 330 * Scale / 1000;
  Plot.PrefHeight := 220 * Scale / 1000;
  Table.PrefWidth := 400 * Scale / 1000;
  Table.PrefHeight := 156 * Scale / 1000;
END_FUNCTION_BLOCK

(* Page 16: a dialog over the screen, answered by a tap. *)
FUNCTION_BLOCK DialogScreen EXTENDS HmiScreen
  VAR
    Back1 : HmiTank := (Caption := 'Level', MaxValue := 10.0, PrefWidth := 140, PrefHeight := 120);
    Back2 : HmiButton := (Text := 'Start pump');
    Dlg : HmiDialog := (Title := 'Start pump P-101?', Message := 'Inlet valve V-12 is closed.;The pump may run dry.',
      Buttons := 'Cancel;Start');
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Back1), 0);
    Attach(ADR(Back2), 0);
    Attach(ADR(Dlg), 0);
    Build := TRUE;
  END_METHOD
  IF Back2.Clicked THEN DlgOpen := TRUE; END_IF;
  IF Dlg.Answered THEN
    DlgResult := Dlg.Result;
    DlgAnswers := DlgAnswers + 1;
    DlgOpen := FALSE;
  END_IF;
  Dlg.Open := DlgOpen;
  Dlg.BoxWidth := 260 * Scale / 1000;
  Dlg.BoxHeight := 140 * Scale / 1000;
  Back1.Value := 6.0;
END_FUNCTION_BLOCK

PROGRAM HmiMain
  VAR
    S0 : DisplayScreen;
    S1 : TrendScreen;
    S2 : ControlsScreen;
    S3 : DiagramScreen;
    S4 : LayoutScreen;
    S5 : NavScreen;
    S6 : SqueezedScreen;
    S7 : MotionScreen;
    S8 : NestedScreen;
    S9 : IndicatorScreen;
    S10 : TimeScreen;
    S11 : InputScreen;
    S12 : SymbolScreen;
    S13 : AlarmScreen;
    S14 : LogScreen;
    S15 : PlotScreen;
    S16 : DialogScreen;
    Rt : HmiRuntime;
    Started : BOOL;
  END_VAR
  IF NOT Started THEN
    Rt.CopyTheme(5, 0);
    Rt.SetThemeColor(5, 7, 16#7C3AED);
    Rt.AddScreen(ADR(S0));
    Rt.AddScreen(ADR(S1));
    Rt.AddScreen(ADR(S2));
    Rt.AddScreen(ADR(S3));
    Rt.AddScreen(ADR(S4));
    Rt.AddScreen(ADR(S5));
    Rt.AddScreen(ADR(S6));
    Rt.AddScreen(ADR(S7));
    Rt.AddScreen(ADR(S8));
    Rt.AddScreen(ADR(S9));
    Rt.AddScreen(ADR(S10));
    Rt.AddScreen(ADR(S11));
    Rt.AddScreen(ADR(S12));
    Rt.AddScreen(ADR(S13));
    Rt.AddScreen(ADR(S14));
    Rt.AddScreen(ADR(S15));
    Rt.AddScreen(ADR(S16));
    Rt.SetStart(0);
    Started := TRUE;
  END_IF;
  CASE Rt.BeginFrame() OF
    0: S0();
    1: S1();
    2: S2();
    3: S3();
    4: S4();
    5: S5();
    6: S6();
    7: S7();
    8: S8();
    9: S9();
    10: S10();
    11: S11();
    12: S12();
    13: S13();
    14: S14();
    15: S15();
    16: S16();
  END_CASE;
  Rt.EndFrame();
  IF GoHome THEN
    Rt.Show(0);
    GoHome := FALSE;
  END_IF;
END_PROGRAM

CONFIGURATION HmiConfig
  RESOURCE HmiRes ON PLC
    TASK HmiTask(INTERVAL := T#40ms, PRIORITY := 1);
    PROGRAM HmiInst WITH HmiTask : HmiMain;
  END_RESOURCE
END_CONFIGURATION
