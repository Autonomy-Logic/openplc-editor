/** StandardWidgets ST source: data feeds, alarm and event widgets, the XY plot, the data table and the dialog. */
export const DATA_ST = `(* Icon of a dialog. *)
TYPE HMI_DIALOG_ICON : (None := 0, Info := 1, Warning := 2, Danger := 3, Question := 4); END_TYPE

(* Colour of an alarm severity: 3 high, 2 medium, 1 low. *)
FUNCTION HMI_SeverityColor : UDINT
  VAR_INPUT Severity : INT; END_VAR
  CASE Severity OF
    3: HMI_SeverityColor := COLOR.Danger;
    2: HMI_SeverityColor := COLOR.Warning;
    1: HMI_SeverityColor := 16#0EA5E9;
  ELSE
    HMI_SeverityColor := COLOR.TextMuted;
  END_CASE;
END_FUNCTION

(* Short name of an alarm severity. *)
FUNCTION HMI_SeverityText : STRING(8)
  VAR_INPUT Severity : INT; END_VAR
  CASE Severity OF
    3: HMI_SeverityText := 'HI';
    2: HMI_SeverityText := 'MED';
    1: HMI_SeverityText := 'LO';
  ELSE
    HMI_SeverityText := '';
  END_CASE;
END_FUNCTION

(* N with a leading zero below 10. *)
FUNCTION HMI_TwoDigits : STRING(16)
  VAR_INPUT N : DINT; END_VAR
  HMI_TwoDigits := HMI_FormatInt(N);
  IF N >= 0 AND N < 10 THEN
    HMI_TwoDigits := CONCAT('0', HMI_TwoDigits);
  END_IF;
END_FUNCTION

(* Time of day of a DT as hh:mm:ss. *)
FUNCTION HMI_ClockText : STRING(16)
  VAR_INPUT Value : DT; END_VAR
  VAR s : LINT; END_VAR
  s := (HMI_DTNanos(Value) / 1000000000) MOD 86400;
  IF s < 0 THEN
    s := s + 86400;
  END_IF;
  HMI_ClockText := CONCAT(CONCAT(CONCAT(CONCAT(HMI_TwoDigits(LINT_TO_DINT(s / 3600)), ':'),
    HMI_TwoDigits(LINT_TO_DINT(s / 60 MOD 60))), ':'), HMI_TwoDigits(LINT_TO_DINT(s MOD 60)));
END_FUNCTION

(* V scaled by K per mille, the factor data widgets draw at relative to their reference size. *)
FUNCTION HMI_Scaled : DINT
  VAR_INPUT V, K : DINT; END_VAR
  HMI_Scaled := V * K / 1000;
END_FUNCTION

(* Data a widget reads from a PLC table, array or summary, row by row from 0. The HMI build generates one per bound
   source; each kind overrides what its rows have. A summary answers row 0: Used is TopValid, the rest the top alarm. *)
FUNCTION_BLOCK ABSTRACT HmiFeed
  METHOD Count : DINT
    Count := 0;
  END_METHOD
  METHOD Used : BOOL
    VAR_INPUT I : DINT; END_VAR
    Used := FALSE;
  END_METHOD
  METHOD Active : BOOL
    VAR_INPUT I : DINT; END_VAR
    Active := FALSE;
  END_METHOD
  METHOD Acked : BOOL
    VAR_INPUT I : DINT; END_VAR
    Acked := FALSE;
  END_METHOD
  METHOD Severity : INT
    VAR_INPUT I : DINT; END_VAR
    Severity := 0;
  END_METHOD
  METHOD Kind : INT
    VAR_INPUT I : DINT; END_VAR
    Kind := 0;
  END_METHOD
  METHOD Seq : UDINT
    VAR_INPUT I : DINT; END_VAR
    Seq := 0;
  END_METHOD
  METHOD Message : STRING(80)
    VAR_INPUT I : DINT; END_VAR
    Message := '';
  END_METHOD
  METHOD Stamp : DT
    VAR_INPUT I : DINT; END_VAR
    Stamp := DT#1970-01-01-00:00:00;
  END_METHOD
  METHOD Number : REAL
    VAR_INPUT I : DINT; END_VAR
    Number := 0.0;
  END_METHOD
  METHOD Unacked : DINT
    Unacked := 0;
  END_METHOD
END_FUNCTION_BLOCK

(* Base of widgets that show PLC data through feeds: inputs marked hmi_source name the data, and the HMI build gives
   each its feed, in declaration order, with SetFeed. *)
FUNCTION_BLOCK ABSTRACT HmiDataElement EXTENDS HmiElement
  VAR
    feeds : ARRAY[0..7] OF POINTER TO HmiFeed;
    (* Scale of this frame against the widget's reference size, per mille. *)
    k : DINT := 1000;
  END_VAR
  (* Generated: the feed of source Slot. *)
  METHOD SetFeed : BOOL
    VAR_INPUT Slot : INT; Feed : POINTER TO HmiFeed; END_VAR
    IF Slot >= 0 AND Slot <= 7 THEN
      feeds[Slot] := Feed;
      SetFeed := TRUE;
    END_IF;
  END_METHOD
  (* Sets the scale for a widget drawn RefW x RefH at its reference size. *)
  METHOD PROTECTED Fit : BOOL
    VAR_INPUT RefW, RefH : DINT; END_VAR
    k := MAX(1, MIN(Width * 1000 / MAX(RefW, 1), Height * 1000 / MAX(RefH, 1)));
    Fit := TRUE;
  END_METHOD
  (* A reference length at this frame's scale, at least one unit. *)
  METHOD PROTECTED Sc : DINT
    VAR_INPUT V : DINT; END_VAR
    Sc := MAX(1, V * k / 1000);
  END_METHOD
  METHOD PROTECTED Fed : BOOL
    VAR_INPUT Slot : INT; END_VAR
    Fed := feeds[Slot] <> 0;
  END_METHOD
  (* Rows of source Slot, 0 when it has no feed. *)
  METHOD PROTECTED FeedRows : DINT
    VAR_INPUT Slot : INT; END_VAR
    IF feeds[Slot] <> 0 THEN
      FeedRows := feeds[Slot]^.Count();
    END_IF;
  END_METHOD
  (* Scroll thumb of a list showing Shown of Total rows from First, in the strip at X, Y of height H. *)
  METHOD PROTECTED Thumb : BOOL
    VAR_INPUT X, Y, H, First, Shown, Total : DINT; END_VAR
    IF Total > Shown AND Total > 0 THEN
      HMI_FillRect(X, Y + H * First / Total, Sc(4), MAX(H * Shown / Total, Sc(10)), Sc(2), COLOR.Border);
    END_IF;
    Thumb := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* The newest unacknowledged alarm in its severity's colour with the count of the others and ACK, the newest active
   one marked Acked when all are acknowledged, else "No active alarms". Source names an HMI_ALARM_SUMMARY. *)
{attribute 'hmi_palette' := 'Alarms'}
FUNCTION_BLOCK HmiAlarmBanner EXTENDS HmiDataElement
  VAR_INPUT
    (* The HMI_ALARM_SUMMARY the program's HMI_ALARMS fills, ackY name. *)
    {attribute 'hmi_source' := 'HMI_ALARM_SUMMARY'}
    {attribute 'hmi_group' := 'data'}
    Source : STRING(96);
    ShowTime : BOOL := TRUE;
  END_VAR
  VAR_OUTPUT
    (* TRUE for one frame when the operator acknowledges the shown alarm. *)
    AckTop : BOOL;
  END_VAR
  VAR
    ackX, ackY, ackW, ackH : DINT;
    shown, acked : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 460;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 34;
  END_METHOD
  METHOD INTERNAL Arrange : BOOL
    Fit(460, 34);
    shown := FALSE;
    acked := FALSE;
    IF feeds[0] <> 0 THEN
      shown := feeds[0]^.Used(0);
      acked := feeds[0]^.Acked(0);
    END_IF;
    ackW := Sc(62);
    ackH := Sc(24);
    ackX := Left + Width - ackW - Sc(6);
    ackY := Top + (Height - ackH) / 2;
    Arrange := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    AckTop := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      RETURN;
    END_IF;
    Arrange();
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      AckTop := shown AND NOT acked AND HMI_Hit(ackX, ackY, ackW, ackH);
      Input := TRUE;
    END_IF;
  END_METHOD
  (* A bell of height H with its top left at X, Y. *)
  METHOD INTERNAL Bell : BOOL
    VAR_INPUT X, Y, H : DINT; C : UDINT; END_VAR
    VAR w : DINT; END_VAR
    w := H;
    HMI_FillCircle(X + w / 2, Y + H * 4 / 10, H * 3 / 10, C);
    HMI_PolyBegin(C);
    HMI_PolyPoint(X + w * 2 / 10, Y + H * 4 / 10);
    HMI_PolyPoint(X + w * 8 / 10, Y + H * 4 / 10);
    HMI_PolyPoint(X + w, Y + H * 8 / 10);
    HMI_PolyPoint(X, Y + H * 8 / 10);
    HMI_PolyFill();
    HMI_FillCircle(X + w / 2, Y + H * 9 / 10, MAX(1, H / 8), C);
    Bell := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR c, fg, muted : UDINT; x, cy, fs, more, pw, mx : DINT; text : STRING(120); END_VAR
    Arrange();
    cy := Top + Height / 2;
    fs := Sc(13);
    IF NOT shown THEN
      HMI_FillRect(Left, Top, Width, Height, Sc(6), COLOR.Surface);
      HMI_StrokeRect(Left, Top, Width, Height, Sc(6), 1, COLOR.Border);
      HMI_FillCircle(Left + Sc(18), cy, Sc(5), COLOR.Success);
      HMI_TextBox(Left + Sc(32), Top, Width - Sc(40), Height, 'No active alarms', fs, HMI_FONT#Regular, HMI_ALIGN#Left,
        HMI_VALIGN#Middle, COLOR.TextMuted);
      Draw := TRUE;
      RETURN;
    END_IF;
    c := HMI_SeverityColor(feeds[0]^.Severity(0));
    IF acked THEN
      HMI_FillRect(Left, Top, Width, Height, Sc(6), COLOR.Surface);
      HMI_StrokeRect(Left, Top, Width, Height, Sc(6), MAX(1, Sc(1)), c);
      fg := COLOR.Text;
      muted := COLOR.TextMuted;
      Bell(Left + Sc(12), cy - Sc(6), Sc(12), c);
    ELSE
      HMI_FillRect(Left, Top, Width, Height, Sc(6), c);
      fg := COLOR.White;
      muted := COLOR.White;
      Bell(Left + Sc(12), cy - Sc(6), Sc(12), COLOR.White);
    END_IF;
    x := Left + Sc(32);
    IF ShowTime THEN
      HMI_TextBox(x, Top, Sc(58), Height, HMI_ClockText(feeds[0]^.Stamp(0)), Sc(12), HMI_FONT#Bold, HMI_ALIGN#Left,
        HMI_VALIGN#Middle, muted);
      x := x + Sc(60);
    END_IF;
    more := feeds[0]^.Count() - 1;
    pw := Sc(56);
    mx := ackX - Sc(8);
    IF more > 0 THEN
      mx := ackX - pw - Sc(16);
    END_IF;
    text := CONCAT(CONCAT(HMI_SeverityText(feeds[0]^.Severity(0)), '  '), feeds[0]^.Message(0));
    HMI_Clip(x, Top, MAX(mx - x, 0), Height);
    HMI_TextBox(x, Top, MAX(mx - x, 0) + Sc(200), Height, text, fs, HMI_FONT#Bold, HMI_ALIGN#Left, HMI_VALIGN#Middle,
      fg);
    HMI_Unclip();
    IF more > 0 THEN
      HMI_FillRect(ackX - pw - Sc(8), cy - Sc(10), pw, Sc(20), Sc(10), SEL(acked, HMI_Alpha(COLOR.White, 25), COLOR.Fill));
      HMI_TextBox(ackX - pw - Sc(8), cy - Sc(10), pw, Sc(20), CONCAT(CONCAT('+', HMI_FormatInt(more)), ' more'), Sc(11),
        HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, fg);
    END_IF;
    IF acked THEN
      HMI_TextBox(ackX, ackY, ackW, ackH, 'Acked', Sc(12), HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, COLOR.TextMuted);
    ELSE
      HMI_FillRect(ackX, ackY, ackW, ackH, Sc(5), COLOR.White);
      HMI_TextBox(ackX, ackY, ackW, ackH, 'ACK', Sc(12), HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, c);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* The alarms of a table, active and newest first: time, severity, message and state; unacknowledged rows tinted and
   bold with their own Ack. Ack all goes through Service; the filter shows active alarms or all. Drag to scroll. *)
{attribute 'hmi_palette' := 'Alarms'}
{attribute 'hmi_requires' := 'hmiDataWidgets'}
{attribute 'hmi_default' := 'GrowAuto := TRUE'}
FUNCTION_BLOCK HmiAlarmList EXTENDS HmiDataElement
  VAR_INPUT
    (* The program's alarm table, an ARRAY OF HMI_ALARM_ROW, by name. *)
    {attribute 'hmi_source' := 'ARRAY OF HMI_ALARM_ROW'}
    {attribute 'hmi_group' := 'data'}
    Source : STRING(96);
    (* The table's HMI_ALARM_SUMMARY, by name; Ack all shows when it is set. *)
    {attribute 'hmi_source' := 'HMI_ALARM_SUMMARY'}
    {attribute 'hmi_group' := 'data'}
    Service : STRING(96);
    (* Starts with the active alarms only; the filter button switches. *)
    ActiveOnly : BOOL;
  END_VAR
  VAR_OUTPUT
    (* Feed row the operator acknowledged this frame, -1 for none. *)
    AckRow : DINT := -1;
    (* TRUE for one frame when the operator acknowledges every alarm. *)
    AckAll : BOOL;
  END_VAR
  VAR
    flipped, pressing, dragged : BOOL;
    first, total, unacked, nvis, rows, rowH, headH, footH, listY, pressY, pressFirst : DINT;
    vis : ARRAY[0..63] OF DINT;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 520;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 210;
  END_METHOD
  METHOD INTERNAL Filtered : BOOL
    Filtered := ActiveOnly XOR flipped;
  END_METHOD
  METHOD INTERNAL Shows : BOOL
    VAR_INPUT I : DINT; END_VAR
    Shows := feeds[0]^.Used(I);
    IF Shows AND Filtered() THEN
      Shows := feeds[0]^.Active(I);
    END_IF;
  END_METHOD
  (* Row A comes before row B: active first, then newest, then in table order. *)
  METHOD INTERNAL Before : BOOL
    VAR_INPUT A, B : DINT; END_VAR
    VAR aa, ab : BOOL; sa, sb : DT; END_VAR
    aa := feeds[0]^.Active(A);
    ab := feeds[0]^.Active(B);
    IF aa <> ab THEN
      Before := aa;
      RETURN;
    END_IF;
    sa := feeds[0]^.Stamp(A);
    sb := feeds[0]^.Stamp(B);
    IF sa <> sb THEN
      Before := sa > sb;
    ELSE
      Before := A < B;
    END_IF;
  END_METHOD
  (* Counts the rows, keeps the scroll in range and finds the shown rows in order, in vis. *)
  METHOD INTERNAL Arrange : BOOL
    VAR i, n, slot, prev, best : DINT; later : BOOL; END_VAR
    Fit(520, 210);
    rowH := Sc(34);
    headH := Sc(30);
    footH := Sc(34);
    listY := Top + headH;
    rows := LIMIT(0, (Height - headH - footH) / MAX(rowH, 1), 64);
    total := 0;
    unacked := 0;
    nvis := 0;
    IF feeds[0] = 0 THEN
      RETURN;
    END_IF;
    n := feeds[0]^.Count();
    FOR i := 0 TO n - 1 DO
      IF Shows(i) THEN
        total := total + 1;
        IF NOT feeds[0]^.Acked(i) THEN
          unacked := unacked + 1;
        END_IF;
      END_IF;
    END_FOR;
    first := LIMIT(0, first, MAX(total - rows, 0));
    prev := -1;
    FOR slot := 0 TO MIN(first + rows, total) - 1 DO
      best := -1;
      FOR i := 0 TO n - 1 DO
        IF Shows(i) THEN
          later := prev < 0;
          IF NOT later THEN
            later := Before(prev, i);
          END_IF;
          IF later THEN
            IF best < 0 THEN
              best := i;
            ELSIF Before(i, best) THEN
              best := i;
            END_IF;
          END_IF;
        END_IF;
      END_FOR;
      prev := best;
      IF slot >= first AND best >= 0 THEN
        vis[nvis] := best;
        nvis := nvis + 1;
      END_IF;
    END_FOR;
    Arrange := TRUE;
  END_METHOD
  (* Left edge of the rows' Ack buttons. *)
  METHOD INTERNAL AckX : DINT
    AckX := Left + Width - Sc(50);
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    VAR s, fy : DINT; END_VAR
    AckRow := -1;
    AckAll := FALSE;
    IF NOT Visible OR NOT Enabled THEN
      pressing := FALSE;
      RETURN;
    END_IF;
    Arrange();
    fy := Top + Height - footH;
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      Input := TRUE;
      IF feeds[1] <> 0 AND HMI_Hit(Left + Sc(8), fy + Sc(4), Sc(90), Sc(26)) THEN
        AckAll := TRUE;
      ELSIF HMI_Hit(Left + Sc(106), fy + Sc(4), Sc(120), Sc(26)) THEN
        flipped := NOT flipped;
        first := 0;
      ELSIF HMI_PtrY() >= listY AND HMI_PtrY() < listY + rows * rowH THEN
        s := (HMI_PtrY() - listY) / MAX(rowH, 1);
        IF s < nvis THEN
          IF HMI_Hit(AckX(), listY + s * rowH + Sc(6), Sc(42), Sc(22)) AND NOT feeds[0]^.Acked(vis[s]) THEN
            AckRow := vis[s];
          END_IF;
        END_IF;
        IF AckRow < 0 THEN
          pressing := TRUE;
          dragged := FALSE;
          pressY := HMI_PtrY();
          pressFirst := first;
        END_IF;
      END_IF;
      RETURN;
    END_IF;
    IF pressing THEN
      IF HMI_PtrDown() THEN
        IF ABS(HMI_PtrY() - pressY) > rowH / 2 THEN
          dragged := TRUE;
        END_IF;
        IF dragged THEN
          first := MAX(0, pressFirst - (HMI_PtrY() - pressY) / MAX(rowH, 1));
        END_IF;
        Input := TRUE;
      ELSE
        pressing := FALSE;
      END_IF;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR s, i, y, fy, sx, mw : DINT; c : UDINT; open : BOOL; state : STRING(32); END_VAR
    Arrange();
    HMI_FillRect(Left, Top, Width, Height, Sc(6), COLOR.Surface);
    HMI_Clip(Left, Top, Width, headH);
    HMI_FillRect(Left, Top, Width, headH + Sc(6), Sc(6), COLOR.Fill);
    HMI_Unclip();
    sx := Left + Width - Sc(140);
    HMI_TextBox(Left + Sc(12), Top, Sc(70), headH, 'Time', Sc(12), HMI_FONT#Bold, HMI_ALIGN#Left, HMI_VALIGN#Middle,
      COLOR.TextMuted);
    HMI_TextBox(Left + Sc(86), Top, Sc(48), headH, 'Sev', Sc(12), HMI_FONT#Bold, HMI_ALIGN#Left, HMI_VALIGN#Middle,
      COLOR.TextMuted);
    HMI_TextBox(Left + Sc(136), Top, Sc(120), headH, 'Message', Sc(12), HMI_FONT#Bold, HMI_ALIGN#Left,
      HMI_VALIGN#Middle, COLOR.TextMuted);
    HMI_TextBox(sx, Top, Sc(80), headH, 'State', Sc(12), HMI_FONT#Bold, HMI_ALIGN#Left, HMI_VALIGN#Middle,
      COLOR.TextMuted);
    IF nvis = 0 THEN
      HMI_TextBox(Left, listY, Width, rows * rowH, SEL(Filtered(), 'No alarms', 'No active alarms'), Sc(13),
        HMI_FONT#Regular, HMI_ALIGN#Center, HMI_VALIGN#Middle, COLOR.TextMuted);
    END_IF;
    HMI_Clip(Left, listY, Width, rows * rowH);
    FOR s := 0 TO nvis - 1 DO
      i := vis[s];
      y := listY + s * rowH;
      c := HMI_SeverityColor(feeds[0]^.Severity(i));
      open := NOT feeds[0]^.Acked(i);
      IF open THEN
        HMI_FillRect(Left + 1, y, Width - 2, rowH, 0, HMI_Alpha(c, 10));
      END_IF;
      HMI_FillRect(Left, y, Sc(4), rowH, 0, c);
      HMI_TextBox(Left + Sc(12), y, Sc(70), rowH, HMI_ClockText(feeds[0]^.Stamp(i)), Sc(12), HMI_FONT#Regular,
        HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.Text);
      HMI_FillRect(Left + Sc(84), y + (rowH - Sc(17)) / 2, Sc(38), Sc(17), Sc(4), c);
      HMI_TextBox(Left + Sc(84), y + (rowH - Sc(17)) / 2, Sc(38), Sc(17), HMI_SeverityText(feeds[0]^.Severity(i)),
        Sc(10), HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, COLOR.White);
      mw := MAX(sx - Left - Sc(144), 0);
      HMI_Clip(Left + Sc(136), MAX(y, listY), mw, rowH);
      HMI_TextBox(Left + Sc(136), y, mw + Sc(200), rowH, feeds[0]^.Message(i), Sc(13),
        SEL(open, HMI_FONT#Regular, HMI_FONT#Bold), HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.Text);
      HMI_Clip(Left, listY, Width, rows * rowH);
      IF feeds[0]^.Active(i) THEN
        state := 'Active';
      ELSE
        state := 'Cleared';
      END_IF;
      IF NOT open THEN
        state := CONCAT(state, ' - acked');
      END_IF;
      HMI_TextBox(sx, y, Sc(96), rowH, state, Sc(12), HMI_FONT#Regular, HMI_ALIGN#Left, HMI_VALIGN#Middle,
        SEL(feeds[0]^.Active(i), COLOR.TextMuted, COLOR.Text));
      IF open THEN
        HMI_FillRect(AckX(), y + Sc(6), Sc(42), Sc(22), Sc(5), COLOR.Accent);
        HMI_TextBox(AckX(), y + Sc(6), Sc(42), Sc(22), 'Ack', Sc(11), HMI_FONT#Bold, HMI_ALIGN#Center,
          HMI_VALIGN#Middle, COLOR.OnAccent);
      END_IF;
      HMI_FillRect(Left, y + rowH - 1, Width, 1, 0, COLOR.Fill);
    END_FOR;
    HMI_Unclip();
    Thumb(Left + Width - Sc(6), listY + Sc(2), rows * rowH - Sc(4), first, nvis, total);
    fy := Top + Height - footH;
    IF feeds[1] <> 0 THEN
      HMI_FillRect(Left + Sc(8), fy + Sc(4), Sc(90), Sc(26), Sc(5), COLOR.Accent);
      HMI_TextBox(Left + Sc(8), fy + Sc(4), Sc(90), Sc(26), 'Ack all', Sc(12), HMI_FONT#Bold, HMI_ALIGN#Center,
        HMI_VALIGN#Middle, COLOR.OnAccent);
    END_IF;
    HMI_FillRect(Left + Sc(106), fy + Sc(4), Sc(120), Sc(26), Sc(5), COLOR.Surface);
    HMI_StrokeRect(Left + Sc(106), fy + Sc(4), Sc(120), Sc(26), Sc(5), 1, COLOR.Border);
    HMI_TextBox(Left + Sc(116), fy + Sc(4), Sc(90), Sc(26), SEL(Filtered(), 'All alarms', 'Active only'), Sc(12),
      HMI_FONT#Regular, HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.Text);
    HMI_Line(Left + Sc(206), fy + Sc(15), Left + Sc(210), fy + Sc(19), MAX(1, Sc(2)), COLOR.TextMuted);
    HMI_Line(Left + Sc(210), fy + Sc(19), Left + Sc(214), fy + Sc(15), MAX(1, Sc(2)), COLOR.TextMuted);
    HMI_TextBox(Left + Sc(232), fy + Sc(4), Width - Sc(240), Sc(26), CONCAT(CONCAT(CONCAT(HMI_FormatInt(total),
      ' alarms, '), HMI_FormatInt(unacked)), ' unacked'), Sc(11), HMI_FONT#Regular, HMI_ALIGN#Right,
      HMI_VALIGN#Middle, COLOR.TextMuted);
    HMI_StrokeRect(Left, Top, Width, Height, Sc(6), 1, COLOR.Border);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* The entries of an event log, newest first: a dot coloured by kind on a time line, the time and kind, and the
   message. Source names the program's ARRAY OF HMI_EVENT_ROW. The entries scroll by dragging. *)
{attribute 'hmi_palette' := 'Alarms'}
{attribute 'hmi_requires' := 'hmiDataWidgets'}
{attribute 'hmi_default' := 'GrowAuto := TRUE'}
FUNCTION_BLOCK HmiEventLog EXTENDS HmiDataElement
  VAR_INPUT
    (* The program's event log, an ARRAY OF HMI_EVENT_ROW, by name. *)
    {attribute 'hmi_source' := 'ARRAY OF HMI_EVENT_ROW'}
    {attribute 'hmi_group' := 'data'}
    Source : STRING(96);
  END_VAR
  VAR
    pressing, dragged : BOOL;
    first, total, newest, rows, rowH, pressY, pressFirst : DINT;
    topSeq : UDINT;
  END_VAR
  METHOD PROTECTED OVERRIDE TakesInput : BOOL
    TakesInput := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 420;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 214;
  END_METHOD
  (* Feed row of the J-th newest entry. *)
  METHOD INTERNAL Entry : DINT
    VAR_INPUT J : DINT; END_VAR
    VAR n : DINT; END_VAR
    n := MAX(feeds[0]^.Count(), 1);
    Entry := ((newest - J) MOD n + n) MOD n;
  END_METHOD
  (* Finds the newest entry and how many entries follow it back in sequence. *)
  METHOD INTERNAL Arrange : BOOL
    VAR i, n : DINT; q : UDINT; END_VAR
    Fit(420, 214);
    rowH := Sc(32);
    rows := (Height - Sc(10)) / MAX(rowH, 1);
    total := 0;
    IF feeds[0] = 0 THEN
      RETURN;
    END_IF;
    n := feeds[0]^.Count();
    topSeq := 0;
    FOR i := 0 TO n - 1 DO
      q := feeds[0]^.Seq(i);
      IF q > topSeq THEN
        topSeq := q;
        newest := i;
      END_IF;
    END_FOR;
    WHILE total < n AND topSeq > DINT_TO_UDINT(total) DO
      IF feeds[0]^.Seq(Entry(total)) <> topSeq - DINT_TO_UDINT(total) THEN
        EXIT;
      END_IF;
      total := total + 1;
    END_WHILE;
    first := LIMIT(0, first, MAX(total - rows, 0));
    Arrange := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    IF NOT Visible OR NOT Enabled THEN
      pressing := FALSE;
      RETURN;
    END_IF;
    Arrange();
    IF HMI_PtrPressed() AND PointerOver() THEN
      HMI_PtrConsume();
      pressing := TRUE;
      dragged := FALSE;
      pressY := HMI_PtrY();
      pressFirst := first;
      Input := TRUE;
      RETURN;
    END_IF;
    IF pressing THEN
      IF HMI_PtrDown() THEN
        IF ABS(HMI_PtrY() - pressY) > rowH / 2 THEN
          dragged := TRUE;
        END_IF;
        IF dragged THEN
          first := MAX(0, pressFirst - (HMI_PtrY() - pressY) / MAX(rowH, 1));
        END_IF;
        Input := TRUE;
      ELSE
        pressing := FALSE;
      END_IF;
    END_IF;
  END_METHOD
  METHOD INTERNAL KindText : STRING(16)
    VAR_INPUT Kind : INT; END_VAR
    CASE Kind OF
      1: KindText := 'Alarm';
      2: KindText := 'Ack';
      3: KindText := 'Cleared';
      5: KindText := 'Operator';
    ELSE
      KindText := 'Event';
    END_CASE;
  END_METHOD
  METHOD INTERNAL KindColor : UDINT
    VAR_INPUT Kind, Severity : INT; END_VAR
    CASE Kind OF
      1: KindColor := HMI_SeverityColor(Severity);
      2, 3: KindColor := COLOR.Success;
      5: KindColor := COLOR.Accent;
    ELSE
      KindColor := COLOR.TextMuted;
    END_CASE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR j, i, y, x, shown : DINT; END_VAR
    Arrange();
    HMI_FillRect(Left, Top, Width, Height, Sc(6), COLOR.Surface);
    HMI_StrokeRect(Left, Top, Width, Height, Sc(6), 1, COLOR.Border);
    IF total = 0 THEN
      HMI_TextBox(Left, Top, Width, Height, 'No events', Sc(13), HMI_FONT#Regular, HMI_ALIGN#Center, HMI_VALIGN#Middle,
        COLOR.TextMuted);
      Draw := TRUE;
      RETURN;
    END_IF;
    shown := MIN(rows, total - first);
    x := Left + Sc(16);
    HMI_Clip(Left, Top + 1, Width, Height - 2);
    FOR j := 0 TO shown - 1 DO
      i := Entry(first + j);
      y := Top + Sc(10) + j * rowH;
      IF first + j < total - 1 THEN
        HMI_FillRect(x - Sc(1), y + Sc(18), MAX(1, Sc(2)), rowH - Sc(6), 0, COLOR.Fill);
      END_IF;
      HMI_FillCircle(x, y + Sc(12), Sc(5), KindColor(feeds[0]^.Kind(i), feeds[0]^.Severity(i)));
      HMI_TextBox(Left + Sc(30), y + Sc(1), Width - Sc(44), Sc(13), CONCAT(CONCAT(HMI_ClockText(feeds[0]^.Stamp(i)),
        '  -  '), KindText(feeds[0]^.Kind(i))), Sc(11), HMI_FONT#Bold, HMI_ALIGN#Left, HMI_VALIGN#Middle,
        COLOR.TextMuted);
      HMI_TextBox(Left + Sc(30), y + Sc(15), Width - Sc(44), Sc(16), feeds[0]^.Message(i), Sc(13), HMI_FONT#Regular,
        HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.Text);
    END_FOR;
    HMI_Unclip();
    Thumb(Left + Width - Sc(10), Top + Sc(12), Height - Sc(24), first, shown, total);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Y against X from arrays of numbers, up to four series as Series counts them, each its own pair of sources (a
   series without an X source uses the first one's), with a marker at LiveX, LiveY when ShowLive. *)
{attribute 'hmi_palette' := 'Data'}
{attribute 'hmi_default' := 'GrowAuto := TRUE'}
FUNCTION_BLOCK HmiXYPlot EXTENDS HmiPlotBase
  VAR_INPUT
    {attribute 'hmi_source' := 'ARRAY OF REAL'}
    {attribute 'hmi_group' := 'data'}
    XSource : STRING(96);
    {attribute 'hmi_source' := 'ARRAY OF REAL'}
    {attribute 'hmi_group' := 'data'}
    YSource : STRING(96);
    {attribute 'hmi_source' := 'ARRAY OF REAL'}
    {attribute 'hmi_group' := 'data'}
    X2Source : STRING(96);
    {attribute 'hmi_source' := 'ARRAY OF REAL'}
    {attribute 'hmi_group' := 'data'}
    Y2Source : STRING(96);
    {attribute 'hmi_source' := 'ARRAY OF REAL'}
    {attribute 'hmi_group' := 'data'}
    X3Source : STRING(96);
    {attribute 'hmi_source' := 'ARRAY OF REAL'}
    {attribute 'hmi_group' := 'data'}
    Y3Source : STRING(96);
    {attribute 'hmi_source' := 'ARRAY OF REAL'}
    {attribute 'hmi_group' := 'data'}
    X4Source : STRING(96);
    {attribute 'hmi_source' := 'ARRAY OF REAL'}
    {attribute 'hmi_group' := 'data'}
    Y4Source : STRING(96);
    (* Number of series drawn, 1 to 4. *)
    Series : INT := 1;
    XMin : REAL := 0.0;
    XMax : REAL := 100.0;
    YMin : REAL := 0.0;
    YMax : REAL := 100.0;
    (* Ranges from the data instead of the limits above. *)
    AutoRange : BOOL;
    XLabel : STRING(32);
    YLabel : STRING(32);
    XUnit : STRING(16);
    YUnit : STRING(16);
    Decimals : INT := 0;
    (* Legend names; a series without one is left out of the legend. *)
    Name1 : STRING(16);
    Name2 : STRING(16);
    Name3 : STRING(16);
    Name4 : STRING(16);
    {attribute 'hmi_color'}
    Color1 : UDINT := COLOR.Accent;
    {attribute 'hmi_color'}
    Color2 : UDINT := COLOR.TextMuted;
    {attribute 'hmi_color'}
    Color3 : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    Color4 : UDINT := COLOR.Danger;
    ShowLive : BOOL;
    {attribute 'hmi_enabled_by' := 'ShowLive'}
    LiveX : REAL;
    {attribute 'hmi_enabled_by' := 'ShowLive'}
    LiveY : REAL;
    {attribute 'hmi_color'}
    {attribute 'hmi_enabled_by' := 'ShowLive'}
    LiveColor : UDINT := COLOR.Warning;
  END_VAR
  VAR
    feeds : ARRAY[0..7] OF POINTER TO HmiFeed;
    k : DINT := 1000;
  END_VAR
  (* Generated: the feed of source Slot, XSource to Y4Source from 0. *)
  METHOD SetFeed : BOOL
    VAR_INPUT Slot : INT; Feed : POINTER TO HmiFeed; END_VAR
    IF Slot >= 0 AND Slot <= 7 THEN
      feeds[Slot] := Feed;
      SetFeed := TRUE;
    END_IF;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 330;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 220;
  END_METHOD
  METHOD INTERNAL Sc : DINT
    VAR_INPUT V : DINT; END_VAR
    Sc := MAX(1, V * k / 1000);
  END_METHOD
  METHOD INTERNAL XFeed : POINTER TO HmiFeed
    VAR_INPUT S : INT; END_VAR
    XFeed := feeds[(S - 1) * 2];
    IF XFeed = 0 THEN
      XFeed := feeds[0];
    END_IF;
  END_METHOD
  METHOD INTERNAL Points : DINT
    VAR_INPUT S : INT; END_VAR
    VAR xf, yf : POINTER TO HmiFeed; END_VAR
    xf := XFeed(S);
    yf := feeds[(S - 1) * 2 + 1];
    IF xf <> 0 AND yf <> 0 THEN
      Points := MIN(xf^.Count(), yf^.Count());
    END_IF;
  END_METHOD
  METHOD INTERNAL SeriesColor : UDINT
    VAR_INPUT S : INT; END_VAR
    CASE S OF
      2: SeriesColor := Color2;
      3: SeriesColor := Color3;
      4: SeriesColor := Color4;
    ELSE
      SeriesColor := Color1;
    END_CASE;
  END_METHOD
  METHOD INTERNAL SeriesName : STRING(16)
    VAR_INPUT S : INT; END_VAR
    CASE S OF
      2: SeriesName := Name2;
      3: SeriesName := Name3;
      4: SeriesName := Name4;
    ELSE
      SeriesName := Name1;
    END_CASE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR
      s, n, i, px, py, pw, ph, g, lx, topH, bottom : DINT;
      xlo, xhi, ylo, yhi, x, y : REAL;
      any : BOOL;
      xf, yf : POINTER TO HmiFeed;
    END_VAR
    k := MAX(1, MIN(Width * 1000 / 330, Height * 1000 / 220));
    xlo := XMin;
    xhi := XMax;
    ylo := YMin;
    yhi := YMax;
    IF AutoRange THEN
      FOR s := 1 TO LIMIT(1, Series, 4) DO
        xf := XFeed(s);
        yf := feeds[(s - 1) * 2 + 1];
        FOR i := 0 TO Points(s) - 1 DO
          x := xf^.Number(i);
          y := yf^.Number(i);
          IF NOT any THEN
            xlo := x;
            xhi := x;
            ylo := y;
            yhi := y;
            any := TRUE;
          END_IF;
          xlo := MIN(xlo, x);
          xhi := MAX(xhi, x);
          ylo := MIN(ylo, y);
          yhi := MAX(yhi, y);
        END_FOR;
      END_FOR;
      IF xhi - xlo < 0.0001 THEN
        xhi := xlo + 1.0;
      END_IF;
      IF yhi - ylo < 0.0001 THEN
        yhi := ylo + 1.0;
      END_IF;
    END_IF;
    Panel(Sc(6));
    topH := Sc(24);
    bottom := SEL(LEN(XLabel) > 0, Sc(22), Sc(36));
    px := Left + Sc(44);
    py := Top + topH;
    pw := Width - Sc(44) - Sc(22);
    ph := Height - topH - bottom;
    IF pw < 8 OR ph < 8 THEN
      Draw := TRUE;
      RETURN;
    END_IF;
    Grid(px, py, pw, ph, 4);
    FOR g := 0 TO 4 DO
      HMI_TextBox(Left, py + ph * g / 4 - Sc(7), Sc(38), Sc(14), HMI_FormatReal(yhi - (yhi - ylo) * DINT_TO_REAL(g) / 4.0,
        Decimals), Sc(10), HMI_FONT#Regular, HMI_ALIGN#Right, HMI_VALIGN#Middle, COLOR.TextMuted);
      HMI_TextBox(px + pw * g / 4 - Sc(30), py + ph + Sc(4), Sc(60), Sc(14), HMI_FormatReal(xlo + (xhi - xlo) *
        DINT_TO_REAL(g) / 4.0, Decimals), Sc(10), HMI_FONT#Regular, HMI_ALIGN#Center, HMI_VALIGN#Middle,
        COLOR.TextMuted);
    END_FOR;
    IF LEN(XLabel) > 0 THEN
      HMI_TextBox(px, Top + Height - Sc(18), pw, Sc(16), XLabel, Sc(11), HMI_FONT#Regular, HMI_ALIGN#Center,
        HMI_VALIGN#Middle, COLOR.TextMuted);
    END_IF;
    IF LEN(YLabel) > 0 THEN
      HMI_TextBox(Left + Sc(8), Top + Sc(4), Sc(120), Sc(16), YLabel, Sc(11), HMI_FONT#Regular, HMI_ALIGN#Left,
        HMI_VALIGN#Middle, COLOR.TextMuted);
    END_IF;
    lx := Left + Width - Sc(10);
    FOR s := LIMIT(1, Series, 4) TO 1 BY -1 DO
      IF LEN(SeriesName(s)) > 0 THEN
        lx := lx - HMI_TextWidth(SeriesName(s), Sc(10), HMI_FONT#Regular);
        HMI_Text(lx, Top + Sc(6), SeriesName(s), Sc(10), HMI_FONT#Regular, HMI_ALIGN#Left, COLOR.TextMuted);
        lx := lx - Sc(18);
        HMI_FillRect(lx, Top + Sc(11), Sc(14), Sc(3), 0, SeriesColor(s));
        lx := lx - Sc(10);
      END_IF;
    END_FOR;
    HMI_Clip(px - Sc(2), py - Sc(2), pw + Sc(4), ph + Sc(4));
    FOR s := 1 TO LIMIT(1, Series, 4) DO
      n := Points(s);
      IF n > 1 THEN
        xf := XFeed(s);
        yf := feeds[(s - 1) * 2 + 1];
        LineBegin(SeriesColor(s), MAX(1, Sc(2)));
        FOR i := 0 TO n - 1 DO
          LinePoint(MapX(xf^.Number(i), xlo, xhi, px, pw), MapY(yf^.Number(i), ylo, yhi, py, ph));
        END_FOR;
        LineEnd();
      END_IF;
    END_FOR;
    HMI_Unclip();
    IF ShowLive THEN
      x := LIMIT(xlo, LiveX, xhi);
      y := LIMIT(ylo, LiveY, yhi);
      i := MapX(x, xlo, xhi, px, pw);
      n := MapY(y, ylo, yhi, py, ph);
      HMI_FillCircle(i, n, Sc(6), COLOR.Surface);
      HMI_FillCircle(i, n, MAX(1, Sc(6) - MAX(1, Sc(2))), LiveColor);
      HMI_Text(i + SEL(i > px + pw / 2, Sc(10), -Sc(10)), n - Sc(18), CONCAT(CONCAT(HMI_FormatValue(LiveX, Decimals,
        XUnit), '  -  '), HMI_FormatValue(LiveY, Decimals, YUnit)), Sc(11), HMI_FONT#Bold,
        SEL(i > px + pw / 2, HMI_ALIGN#Left, HMI_ALIGN#Right), COLOR.Text);
    END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* Up to eight rows of tags as Rows counts them: tag name, description, live value with its unit and a status dot, on
   zebra rows under a header. *)
{attribute 'hmi_palette' := 'Data'}
FUNCTION_BLOCK HmiDataTable EXTENDS HmiElement
  VAR_INPUT
    (* Row 1's value; rows 2 to 8 take Value2 to Value8. *)
    {attribute 'hmi_main'}
    {attribute 'hmi_series' := 'value'}
    Value : REAL;
    {attribute 'hmi_group' := 'data'}
    {attribute 'hmi_series' := 'value'}
    Value2 : REAL;
    {attribute 'hmi_group' := 'data'}
    {attribute 'hmi_series' := 'value'}
    Value3 : REAL;
    {attribute 'hmi_group' := 'data'}
    {attribute 'hmi_series' := 'value'}
    Value4 : REAL;
    {attribute 'hmi_group' := 'data'}
    {attribute 'hmi_series' := 'value'}
    Value5 : REAL;
    {attribute 'hmi_group' := 'data'}
    {attribute 'hmi_series' := 'value'}
    Value6 : REAL;
    {attribute 'hmi_group' := 'data'}
    {attribute 'hmi_series' := 'value'}
    Value7 : REAL;
    {attribute 'hmi_group' := 'data'}
    {attribute 'hmi_series' := 'value'}
    Value8 : REAL;
    (* Number of rows shown, 1 to 8. *)
    {attribute 'hmi_series' := 'count'}
    Rows : INT := 4;
    (* Status dot of row 1; rows 2 to 8 take Status2 to Status8. Transparent hides the dot. *)
    {attribute 'hmi_color'}
    {attribute 'hmi_series' := 'color'}
    Status : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    {attribute 'hmi_series' := 'color'}
    Status2 : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    {attribute 'hmi_series' := 'color'}
    Status3 : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    {attribute 'hmi_series' := 'color'}
    Status4 : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    {attribute 'hmi_series' := 'color'}
    Status5 : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    {attribute 'hmi_series' := 'color'}
    Status6 : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    {attribute 'hmi_series' := 'color'}
    Status7 : UDINT := COLOR.Success;
    {attribute 'hmi_color'}
    {attribute 'hmi_series' := 'color'}
    Status8 : UDINT := COLOR.Success;
    {attribute 'hmi_group' := 'data'}
    Tag : STRING(16) := 'TAG-1';
    {attribute 'hmi_group' := 'data'}
    Tag2 : STRING(16) := 'TAG-2';
    {attribute 'hmi_group' := 'data'}
    Tag3 : STRING(16) := 'TAG-3';
    {attribute 'hmi_group' := 'data'}
    Tag4 : STRING(16) := 'TAG-4';
    {attribute 'hmi_group' := 'data'}
    Tag5 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Tag6 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Tag7 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Tag8 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Text : STRING(48);
    {attribute 'hmi_group' := 'data'}
    Text2 : STRING(48);
    {attribute 'hmi_group' := 'data'}
    Text3 : STRING(48);
    {attribute 'hmi_group' := 'data'}
    Text4 : STRING(48);
    {attribute 'hmi_group' := 'data'}
    Text5 : STRING(48);
    {attribute 'hmi_group' := 'data'}
    Text6 : STRING(48);
    {attribute 'hmi_group' := 'data'}
    Text7 : STRING(48);
    {attribute 'hmi_group' := 'data'}
    Text8 : STRING(48);
    {attribute 'hmi_group' := 'data'}
    Unit : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Unit2 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Unit3 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Unit4 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Unit5 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Unit6 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Unit7 : STRING(16);
    {attribute 'hmi_group' := 'data'}
    Unit8 : STRING(16);
    Decimals : INT := 1;
    ShowHeader : BOOL := TRUE;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 400;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := SEL(ShowHeader, 0, 28) + INT_TO_DINT(LIMIT(1, Rows, 8)) * 32;
  END_METHOD
  METHOD INTERNAL RowValue : REAL
    VAR_INPUT R : INT; END_VAR
    CASE R OF
      2: RowValue := Value2;
      3: RowValue := Value3;
      4: RowValue := Value4;
      5: RowValue := Value5;
      6: RowValue := Value6;
      7: RowValue := Value7;
      8: RowValue := Value8;
    ELSE
      RowValue := Value;
    END_CASE;
  END_METHOD
  METHOD INTERNAL RowStatus : UDINT
    VAR_INPUT R : INT; END_VAR
    CASE R OF
      2: RowStatus := Status2;
      3: RowStatus := Status3;
      4: RowStatus := Status4;
      5: RowStatus := Status5;
      6: RowStatus := Status6;
      7: RowStatus := Status7;
      8: RowStatus := Status8;
    ELSE
      RowStatus := Status;
    END_CASE;
  END_METHOD
  METHOD INTERNAL RowTag : STRING(16)
    VAR_INPUT R : INT; END_VAR
    CASE R OF
      2: RowTag := Tag2;
      3: RowTag := Tag3;
      4: RowTag := Tag4;
      5: RowTag := Tag5;
      6: RowTag := Tag6;
      7: RowTag := Tag7;
      8: RowTag := Tag8;
    ELSE
      RowTag := Tag;
    END_CASE;
  END_METHOD
  METHOD INTERNAL RowText : STRING(48)
    VAR_INPUT R : INT; END_VAR
    CASE R OF
      2: RowText := Text2;
      3: RowText := Text3;
      4: RowText := Text4;
      5: RowText := Text5;
      6: RowText := Text6;
      7: RowText := Text7;
      8: RowText := Text8;
    ELSE
      RowText := Text;
    END_CASE;
  END_METHOD
  METHOD INTERNAL RowUnit : STRING(16)
    VAR_INPUT R : INT; END_VAR
    CASE R OF
      2: RowUnit := Unit2;
      3: RowUnit := Unit3;
      4: RowUnit := Unit4;
      5: RowUnit := Unit5;
      6: RowUnit := Unit6;
      7: RowUnit := Unit7;
      8: RowUnit := Unit8;
    ELSE
      RowUnit := Unit;
    END_CASE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    VAR k, n, headH, rowH, y, vx, r : DINT; i : INT; c : UDINT; END_VAR
    n := INT_TO_DINT(LIMIT(1, Rows, 8));
    k := MAX(1, MIN(Width * 1000 / 400, Height * 1000 / (SEL(ShowHeader, 0, 28) + n * 32)));
    headH := SEL(ShowHeader, 0, HMI_Scaled(28, k));
    rowH := HMI_Scaled(32, k);
    r := HMI_Scaled(6, k);
    vx := Left + Width - HMI_Scaled(82, k);
    HMI_FillRect(Left, Top, Width, Height, r, COLOR.Surface);
    IF ShowHeader THEN
      HMI_Clip(Left, Top, Width, headH);
      HMI_FillRect(Left, Top, Width, headH + r, r, COLOR.Fill);
      HMI_Unclip();
      HMI_TextBox(Left + HMI_Scaled(12, k), Top, HMI_Scaled(70, k), headH, 'Tag', HMI_Scaled(12, k), HMI_FONT#Bold,
        HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.TextMuted);
      HMI_TextBox(Left + HMI_Scaled(84, k), Top, HMI_Scaled(120, k), headH, 'Description', HMI_Scaled(12, k),
        HMI_FONT#Bold, HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.TextMuted);
      HMI_TextBox(vx - HMI_Scaled(80, k), Top, HMI_Scaled(80, k), headH, 'Value', HMI_Scaled(12, k), HMI_FONT#Bold,
        HMI_ALIGN#Right, HMI_VALIGN#Middle, COLOR.TextMuted);
      HMI_TextBox(vx + HMI_Scaled(12, k), Top, HMI_Scaled(50, k), headH, 'Unit', HMI_Scaled(12, k), HMI_FONT#Bold,
        HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.TextMuted);
    END_IF;
    FOR i := 1 TO DINT_TO_INT(n) DO
      y := Top + headH + INT_TO_DINT(i - 1) * rowH;
      IF i MOD 2 = 0 THEN
        HMI_FillRect(Left + 1, y, Width - 2, rowH, 0, COLOR.Background);
      END_IF;
      HMI_TextBox(Left + HMI_Scaled(12, k), y, HMI_Scaled(70, k), rowH, RowTag(i), HMI_Scaled(12, k), HMI_FONT#Bold,
        HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.Text);
      HMI_Clip(Left + HMI_Scaled(84, k), y, MAX(vx - HMI_Scaled(108, k) - Left - HMI_Scaled(84, k), 0), rowH);
      HMI_TextBox(Left + HMI_Scaled(84, k), y, Width, rowH, RowText(i), HMI_Scaled(13, k), HMI_FONT#Regular,
        HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.Text);
      HMI_Unclip();
      HMI_TextBox(vx - HMI_Scaled(100, k), y, HMI_Scaled(100, k), rowH, HMI_FormatReal(RowValue(i), Decimals),
        HMI_Scaled(14, k), HMI_FONT#Bold, HMI_ALIGN#Right, HMI_VALIGN#Middle, COLOR.Text);
      HMI_TextBox(vx + HMI_Scaled(12, k), y, HMI_Scaled(50, k), rowH, RowUnit(i), HMI_Scaled(12, k), HMI_FONT#Regular,
        HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.TextMuted);
      c := RowStatus(i);
      IF c <> COLOR.Transparent THEN
        HMI_FillCircle(Left + Width - HMI_Scaled(16, k), y + rowH / 2, MAX(1, HMI_Scaled(5, k)), c);
      END_IF;
    END_FOR;
    HMI_StrokeRect(Left, Top, Width, Height, r, 1, COLOR.Border);
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK

(* A modal dialog over the dimmed screen while Open: icon, Title, Message and Buttons (';' lists, the last highlighted).
   A tap closes it for this viewer and sets Result (button from 1) with Answered for one frame, until Open falls. *)
{attribute 'hmi_palette' := 'Controls'}
FUNCTION_BLOCK HmiDialog EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    {attribute 'hmi_preview' := 'FALSE'}
    Open : BOOL;
    Title : STRING(64) := 'Confirm';
    Message : STRING(160) := 'Are you sure?';
    Icon : HMI_DIALOG_ICON := HMI_DIALOG_ICON#Warning;
    Buttons : STRING(96) := 'Cancel;OK';
    (* Size of the dialog box; text and buttons follow it. *)
    BoxWidth : DINT := 260;
    BoxHeight : DINT := 140;
  END_VAR
  VAR_OUTPUT
    Result : INT;
    Answered : BOOL;
  END_VAR
  VAR
    done : BOOL;
    picked : INT;
    k, boxX, boxY, boxW, boxH, btnW, btnH, btnY, gap : DINT;
    count : INT;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := SEL(DesignMode(), 0, 180);
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := SEL(DesignMode(), 0, 36);
  END_METHOD
  METHOD INTERNAL Arrange : BOOL
    boxW := MAX(MIN(BoxWidth, HMI_ScreenW() - 16), 40);
    boxH := MAX(MIN(BoxHeight, HMI_ScreenH() - 16), 40);
    k := MAX(1, MIN(boxW * 1000 / 260, boxH * 1000 / 140));
    boxX := (HMI_ScreenW() - boxW) / 2;
    boxY := (HMI_ScreenH() - boxH) / 2;
    count := LIMIT(0, HMI_ListCount(Buttons), 3);
    btnW := HMI_Scaled(70, k);
    btnH := HMI_Scaled(32, k);
    gap := HMI_Scaled(8, k);
    btnY := boxY + boxH - btnH - HMI_Scaled(14, k);
    Arrange := TRUE;
  END_METHOD
  (* Left edge of button B, from 1; the buttons sit at the box's bottom right. *)
  METHOD INTERNAL ButtonX : DINT
    VAR_INPUT B : INT; END_VAR
    ButtonX := boxX + boxW - HMI_Scaled(12, k) - INT_TO_DINT(count - B + 1) * btnW - INT_TO_DINT(count - B) * gap;
  END_METHOD
  METHOD PROTECTED OVERRIDE Input : BOOL
    Answered := FALSE;
    IF picked > 0 THEN
      Result := picked;
      Answered := TRUE;
      picked := 0;
    END_IF;
    IF NOT Open THEN
      done := FALSE;
    END_IF;
    SetPopup(Open AND NOT done AND Visible AND Enabled AND NOT DesignMode());
  END_METHOD
  METHOD PROTECTED OVERRIDE PopupInput : BOOL
    VAR b : INT; END_VAR
    Arrange();
    IF HMI_PtrPressed() THEN
      HMI_PtrConsume();
      FOR b := 1 TO count DO
        IF HMI_Hit(ButtonX(b), btnY, btnW, btnH) THEN
          picked := b;
          done := TRUE;
        END_IF;
      END_FOR;
      IF done THEN
        SetPopup(FALSE);
      END_IF;
    END_IF;
    PopupInput := TRUE;
  END_METHOD
  METHOD INTERNAL IconColor : UDINT
    CASE Icon OF
      HMI_DIALOG_ICON#Info, HMI_DIALOG_ICON#Question: IconColor := COLOR.Accent;
      HMI_DIALOG_ICON#Danger: IconColor := COLOR.Danger;
    ELSE
      IconColor := COLOR.Warning;
    END_CASE;
  END_METHOD
  METHOD INTERNAL IconText : STRING(4)
    CASE Icon OF
      HMI_DIALOG_ICON#Info: IconText := 'i';
      HMI_DIALOG_ICON#Question: IconText := '?';
    ELSE
      IconText := '!';
    END_CASE;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    IF NOT DesignMode() THEN
      RETURN;
    END_IF;
    HMI_FillRect(Left, Top, Width, Height, 6, COLOR.Surface);
    HMI_StrokeRect(Left, Top, Width, Height, 6, 1, COLOR.Border);
    HMI_FillCircle(Left + Height / 2, Top + Height / 2, Height / 4, IconColor());
    HMI_TextBox(Left + Height, Top, MAX(Width - Height - 6, 0), Height, Title, 12, HMI_FONT#Bold, HMI_ALIGN#Left,
      HMI_VALIGN#Middle, COLOR.Text);
    Draw := TRUE;
  END_METHOD
  METHOD PROTECTED OVERRIDE DrawPopup : BOOL
    VAR b, line, tx, ty, lines, ir : DINT; primary : BOOL; END_VAR
    Arrange();
    HMI_FillRect(0, 0, HMI_ScreenW(), HMI_ScreenH(), 0, HMI_Alpha(COLOR.Black, 35));
    HMI_FillRect(boxX, boxY, boxW, boxH, HMI_Scaled(10, k), COLOR.Surface);
    tx := boxX + HMI_Scaled(18, k);
    IF Icon <> HMI_DIALOG_ICON#None THEN
      ir := HMI_Scaled(14, k);
      HMI_FillCircle(boxX + HMI_Scaled(28, k), boxY + HMI_Scaled(32, k), ir, IconColor());
      HMI_TextBox(boxX + HMI_Scaled(28, k) - ir, boxY + HMI_Scaled(32, k) - ir, 2 * ir, 2 * ir, IconText(),
        HMI_Scaled(16, k), HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, COLOR.White);
      tx := boxX + HMI_Scaled(52, k);
    END_IF;
    ty := boxY + HMI_Scaled(20, k);
    HMI_Clip(boxX, boxY, boxW, boxH);
    HMI_TextBox(tx, ty, boxX + boxW - tx - HMI_Scaled(12, k), HMI_Scaled(20, k), Title, HMI_Scaled(15, k), HMI_FONT#Bold,
      HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.Text);
    lines := INT_TO_DINT(MIN(HMI_ListCount(Message), 3));
    FOR line := 0 TO lines - 1 DO
      HMI_TextBox(tx, ty + HMI_Scaled(22, k) + line * HMI_Scaled(16, k), boxX + boxW - tx - HMI_Scaled(12, k),
        HMI_Scaled(16, k), HMI_ListItem(Message, DINT_TO_INT(line)), HMI_Scaled(12, k), HMI_FONT#Regular,
        HMI_ALIGN#Left, HMI_VALIGN#Middle, COLOR.TextMuted);
    END_FOR;
    HMI_Unclip();
    FOR b := 1 TO INT_TO_DINT(count) DO
      primary := b = INT_TO_DINT(count);
      IF primary THEN
        HMI_FillRect(ButtonX(DINT_TO_INT(b)), btnY, btnW, btnH, HMI_Scaled(6, k), COLOR.Accent);
      ELSE
        HMI_FillRect(ButtonX(DINT_TO_INT(b)), btnY, btnW, btnH, HMI_Scaled(6, k), COLOR.Surface);
        HMI_StrokeRect(ButtonX(DINT_TO_INT(b)), btnY, btnW, btnH, HMI_Scaled(6, k), 1, COLOR.Border);
      END_IF;
      HMI_TextBox(ButtonX(DINT_TO_INT(b)), btnY, btnW, btnH, HMI_ListItem(Buttons, DINT_TO_INT(b) - 1),
        HMI_Scaled(13, k), HMI_FONT#Bold, HMI_ALIGN#Center, HMI_VALIGN#Middle, SEL(primary, COLOR.Text,
        COLOR.OnAccent));
    END_FOR;
    DrawPopup := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`
