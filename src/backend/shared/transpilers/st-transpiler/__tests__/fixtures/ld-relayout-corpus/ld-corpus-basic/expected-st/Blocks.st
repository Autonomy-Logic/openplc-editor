PROGRAM Blocks
  VAR
    b03_enable : BOOL;
    TON0 : TON;
    b03_done : BOOL;
    b03_start : BOOL;
    b03_q : BOOL;
    b03_et : TIME;
    b04_up : BOOL;
    CTUD0 : CTUD;
    b04_at_max : BOOL;
    b04_down : BOOL;
    b04_reset : BOOL;
    b04_load : BOOL;
    b04_at_min : BOOL;
    b04_count : INT;
    b05_run : BOOL;
    ONTIME0 : ONTIME;
    b05_eno : BOOL;
    b05_in : BOOL;
    b05_rst : BOOL;
    b05_seconds : UDINT;
    b05_cycles : UDINT;
    b08_go : BOOL;
    TON1 : TON;
    b08_q : BOOL;
    b08_et : TIME;
    b09_go : BOOL;
    TON2 : TON;
    b09_eno : BOOL;
    b09_in : BOOL;
    b09_q : BOOL;
    b09_et : TIME;
  END_VAR

  TON0(EN := b03_enable, IN := b03_start, PT := T#2s);
  b03_done := TON0.ENO;
  IF TON0.ENO THEN
      b03_q := TON0.Q;
  END_IF;
  IF TON0.ENO THEN
      b03_et := TON0.ET;
  END_IF;
  CTUD0(CU := b04_up, CD := b04_down, R := b04_reset, LD := b04_load, PV := 20);
  b04_at_max := CTUD0.QU;
  b04_at_min := CTUD0.QD;
  b04_count := CTUD0.CV;
  ONTIME0(EN := b05_run, IN := b05_in, RST := b05_rst, SECONDS := b05_seconds, CYCLES := b05_cycles);
  b05_eno := ONTIME0.ENO;
  TON1(IN := b08_go, PT := T#500ms);
  b08_q := TON1.Q;
  b08_et := TON1.ET;
  TON2(EN := b09_go, IN := b09_in, PT := T#1s);
  b09_eno := TON2.ENO;
  IF TON2.ENO THEN
      b09_q := TON2.Q;
  END_IF;
  IF TON2.ENO THEN
      b09_et := TON2.ET;
  END_IF;
END_PROGRAM

