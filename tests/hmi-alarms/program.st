(* Scripted program for the HmiAlarms headless test: the driver sets the globals, runs scans and prints the table,
   the log and the summary. AckRow, AckTopReq and AckAllReq stand for the HMI's writes. *)
VAR_GLOBAL
  In1, In2, In3, In4 : BOOL;
  Ev : BOOL;
  AckRow : DINT;
  AckTopReq, AckAllReq : BOOL;
  Lost4 : BOOL;
  Logged : DINT;
END_VAR

PROGRAM Main
  VAR
    Alarms : ARRAY[1..3] OF HMI_ALARM_ROW;
    Events : ARRAY[0..3] OF HMI_EVENT_ROW;
    Sys : HMI_ALARM_SUMMARY;
    EvWas : BOOL;
  END_VAR
  HMI_ALARM(In := In1, Id := 1, Severity := 3, Message := 'Tank high', Table := Alarms);
  HMI_ALARM(In := In2, Id := 2, Severity := 2, Message := 'Pressure low', Table := Alarms);
  HMI_ALARM(In := In3, Id := 3, Severity := 1, Message := 'Filter dirty', Table := Alarms);
  Lost4 := NOT HMI_ALARM(In := In4, Id := 4, Severity := 3, Message := 'Motor trip', Table := Alarms);
  IF AckRow <> 0 THEN
    Alarms[AckRow].AckReq := TRUE;
    AckRow := 0;
  END_IF;
  IF AckTopReq THEN
    Sys.AckTop := TRUE;
    AckTopReq := FALSE;
  END_IF;
  IF AckAllReq THEN
    Sys.AckAll := TRUE;
    AckAllReq := FALSE;
  END_IF;
  HMI_ALARMS(Summary := Sys, Table := Alarms);
  Logged := HMI_ALARM_LOGGER(Table := Alarms, Events := Events);
  IF Ev AND NOT EvWas THEN
    HMI_LOG_EVENT(Message := 'Batch started', Events := Events);
  END_IF;
  EvWas := Ev;
END_PROGRAM

CONFIGURATION Config
  RESOURCE Res ON PLC
    TASK Scan(INTERVAL := T#10ms, PRIORITY := 1);
    PROGRAM Inst WITH Scan : Main;
  END_RESOURCE
END_CONFIGURATION
