PROGRAM main_ld
  VAR
    man_mode : BOOL;
    Moisture : BOOL;
    timeout : BOOL;
    run_valve : BOOL;
    new_ct : BOOL;
    T_Max : TIME;
    test_something : INT;
    TON0 : TON;
    TOF0 : TOF;
    CTU0 : CTU;
  END_VAR

  run_valve := NOT(TOF0.Q) AND Moisture AND NOT(man_mode);
  TON0(IN := run_valve, PT := T_Max);
  TOF0(IN := TON0.Q, PT := T_Max);
  timeout := TOF0.Q;
  CTU0(CU := new_ct, R := NOT(man_mode), PV := 10);
  test_something := CTU0.CV;
END_PROGRAM

