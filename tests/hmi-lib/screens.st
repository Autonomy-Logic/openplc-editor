(* Test screens for the StandardWidgets headless frames. Build and WriteBack are written by hand the way the HMI build
   generates them. The globals stand for the PLC variables screens are wired to. *)
VAR_GLOBAL
  Run, PumpOn, ValveOpen, Held, GoHome : BOOL;
  Clicks, Shows, Hides, LayoutW1, LayoutW2, LayoutW3, LayoutX4 : DINT;
  Speed, Level, Setpoint, Flow : REAL;
  Name : STRING(16) := 'Tank 1';
END_VAR

(* Page 0: display widgets and a shape. *)
FUNCTION_BLOCK DisplayScreen EXTENDS HmiScreen
  VAR
    Title : HmiLabel := (Text := 'Display widgets', Size := 20, Font := HMI_FONT#Bold);
    RowA : HmiStack := (Direction := HMI_DIRECTION#Row, Gap := 8);
    RowB : HmiStack := (Direction := HMI_DIRECTION#Row, Gap := 8);
    Speed1 : HmiValue := (Caption := 'Speed', Unit := 'rpm', Decimals := 0);
    LampOn : HmiLamp := (Caption := 'Running', Value := TRUE);
    LampOff : HmiLamp := (Caption := 'Fault', OnColor := COLOR.Danger);
    Gauge1 : HmiGauge := (Caption := 'Load', MinValue := 0.0, MaxValue := 200.0);
    Tank1 : HmiTank := (Caption := 'Level', Unit := 'm', MaxValue := 10.0);
    Readout1 : HmiReadout := (Caption := 'FT-101', Unit := 'GPM');
    Box : HmiRect := (Fill := COLOR.Accent, Radius := 4, PrefWidth := 60, PrefHeight := 40);
    Plain : HmiLabel := (Text := 'Right', Align := HMI_ALIGN#Right, TextColor := COLOR.TextMuted, GrowAuto := FALSE, Grow := 1);
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
    Row : HmiStack := (Direction := HMI_DIRECTION#Row, Gap := 12, GrowAuto := FALSE, Grow := 1);
    Trend1 : HmiTrend := (Caption := 'Level', Unit := 'm', MaxValue := 10.0, SampleMs := 80, Pens := 2, Decimals := 2);
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
  Vessel1.Value := Level;
  Vessel1.Rate := Flow;
END_FUNCTION_BLOCK

(* Page 2: controls wired with write-back. *)
FUNCTION_BLOCK ControlsScreen EXTENDS HmiScreen
  VAR
    Start : HmiButton := (Text := 'Start');
    RunSwitch : HmiSwitch := (Caption := 'Run');
    SpeedSlider : HmiSlider := (Caption := 'Speed', MaxValue := 200.0, Step := 10.0, Unit := 'rpm', Decimals := 0);
    SetpointIn : HmiNumericInput := (Caption := 'Setpoint', Unit := 'm', Decimals := 2);
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
    Plant : HmiDiagram := (DesignW := 800, DesignH := 500, MinScalePct := 100, Border := COLOR.Border, GrowAuto := FALSE, Grow := 1);
    Tk : HmiVessel := (Caption := 'TK-1', Unit := 'm', MaxValue := 10.0, X := 40, Y := 40, PrefWidth := 100, PrefHeight := 160);
    P1 : HmiPump := (Caption := 'P-1', X := 260, Y := 230, PrefWidth := 48, PrefHeight := 48);
    V1 : HmiValve := (Caption := 'V-1', X := 420, Y := 240);
    Ft : HmiReadout := (Caption := 'FT', Unit := 'GPM', X := 560, Y := 230);
    L1 : HmiPipe := (Source := 'Tk', SourcePort := HMI_PORT#Bottom, Target := 'P1', TargetPort := HMI_PORT#Left, Animate := TRUE);
    L2 : HmiPipe := (Source := 'P1', SourcePort := HMI_PORT#Right, Target := 'V1', TargetPort := HMI_PORT#Left);
    L3 : HmiPipe := (Source := 'V1', SourcePort := HMI_PORT#Right, Target := 'Ft', TargetPort := HMI_PORT#Left);
  END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL
    Attach(ADR(Plant), 0);
    Attach(ADR(L1), ADR(Plant));
    Attach(ADR(L2), ADR(Plant));
    Attach(ADR(L3), ADR(Plant));
    Attach(ADR(Tk), ADR(Plant));
    Attach(ADR(P1), ADR(Plant));
    Attach(ADR(V1), ADR(Plant));
    Attach(ADR(Ft), ADR(Plant));
    Connect(ADR(L1), ADR(Tk), ADR(P1));
    Connect(ADR(L2), ADR(P1), ADR(V1));
    Connect(ADR(L3), ADR(V1), ADR(Ft));
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
    Row : HmiStack := (Direction := HMI_DIRECTION#Row, Gap := 10, Padding := 6, Fill := COLOR.Surface, GrowAuto := FALSE, Grow := 1);
    A : HmiRect := (PrefWidth := 50, GrowAuto := FALSE, Grow := 1, MaxWidth := 120);
    B : HmiRect := (PrefWidth := 50, GrowAuto := FALSE, Grow := 1, Fill := COLOR.Accent);
    C : HmiRect := (PrefWidth := 300, MinWidth := 80, Fill := COLOR.Warning, MaxHeight := 60);
    Badge : HmiLabel := (Text := 'Floating', Floating := TRUE, Font := HMI_FONT#Bold);
    Hidden : HmiRect := (Visible := FALSE, PrefWidth := 500);
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

PROGRAM HmiMain
  VAR
    S0 : DisplayScreen;
    S1 : TrendScreen;
    S2 : ControlsScreen;
    S3 : DiagramScreen;
    S4 : LayoutScreen;
    S5 : NavScreen;
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
