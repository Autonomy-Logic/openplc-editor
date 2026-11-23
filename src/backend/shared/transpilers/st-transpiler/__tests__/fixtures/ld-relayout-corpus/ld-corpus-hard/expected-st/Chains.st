PROGRAM Chains
  VAR
    h07_start : BOOL;
    TON0 : TON;
    CTU0 : CTU;
    h07_done : BOOL;
    h07_reset : BOOL;
    h07_count : INT;
    h08_start : BOOL;
    TON1 : TON;
    TOF0 : TOF;
    CTU1 : CTU;
    h08_done : BOOL;
    h08_r1 : BOOL;
    h08_r2 : BOOL;
    h08_count : INT;
  END_VAR

  TON0(IN := h07_start, PT := T#1s);
  CTU0(CU := TON0.Q, R := h07_reset, PV := 4);
  h07_done := CTU0.Q;
  h07_count := CTU0.CV;
  TON1(IN := h08_start, PT := T#1s);
  TOF0(IN := TON1.Q, PT := T#2s);
  CTU1(CU := TOF0.Q, R := h08_r1 OR h08_r2, PV := 3);
  h08_done := CTU1.Q;
  h08_count := CTU1.CV;
END_PROGRAM

