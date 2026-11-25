
  TON1(IN := h08_start, PT := T#1s);
  TOF0(IN := TON1.Q, PT := T#2s);
  CTU1(CU := TOF0.Q, R := h08_r1 OR h08_r2, PV := 3);
  h08_done := CTU1.Q;
  h08_count := CTU1.CV;
