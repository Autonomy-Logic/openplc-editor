PROGRAM Mixed
  VAR
    h10_a : BOOL;
    CTU0 : CTU;
    h10_q : BOOL;
    h10_r1 : BOOL;
    h10_r2 : BOOL;
    h10_cv : INT;
    h10_b : BOOL;
    TON0 : TON;
    h10_k1 : BOOL;
    h10_k2 : BOOL;
    h10_k3 : BOOL;
    h10_e : BOOL;
    h10_s : BOOL;
    SR0 : SR;
    h10_q1 : BOOL;
    h10_rr : BOOL;
  END_VAR

  CTU0(CU := h10_a, R := h10_r1 OR h10_r2, PV := 2);
  h10_q := CTU0.Q;
  h10_cv := CTU0.CV;
  TON0(IN := h10_b OR h10_e, PT := T#1s);
  h10_k1 := TON0.Q;
  h10_k2 := TON0.Q;
  h10_k3 := TON0.Q;
  SR0(S1 := h10_s, R := h10_rr);
  h10_q1 := SR0.Q1;
END_PROGRAM

