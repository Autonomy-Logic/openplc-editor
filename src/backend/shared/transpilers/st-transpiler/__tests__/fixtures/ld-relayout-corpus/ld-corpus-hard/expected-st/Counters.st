PROGRAM Counters
  VAR
    h01_a : BOOL;
    CTU0 : CTU;
    h01_q : BOOL;
    h01_b : BOOL;
    h01_c : BOOL;
    h01_d : BOOL;
    h01_cv : INT;
    h02_a : BOOL;
    CTUD0 : CTUD;
    h02_qu : BOOL;
    h02_b : BOOL;
    h02_c : BOOL;
    h02_d : BOOL;
    h02_e : BOOL;
    h02_g : BOOL;
    h02_f : BOOL;
    h02_h : BOOL;
    h02_i : BOOL;
    h02_k : BOOL;
    h02_j : BOOL;
    h02_qd : BOOL;
    h02_cv : INT;
    h03_a : BOOL;
    SR0 : SR;
    h03_q1 : BOOL;
    h03_c : BOOL;
    h03_b : BOOL;
    h03_d : BOOL;
    h03_e : BOOL;
    RS0 : RS;
    h03_q2 : BOOL;
    h03_f : BOOL;
    h03_h : BOOL;
    h03_g : BOOL;
    h04_e : BOOL;
    TON0 : TON;
    h04_q : BOOL;
    h04_a : BOOL;
    h04_b : BOOL;
    h04_c : BOOL;
    h04_d : BOOL;
    h04_et : TIME;
  END_VAR

  CTU0(CU := h01_b AND h01_a, R := h01_c OR h01_d, PV := 10);
  h01_q := CTU0.Q;
  h01_cv := CTU0.CV;
  CTUD0(CU := (h02_b OR h02_d AND h02_c) AND h02_a, CD := h02_g AND (h02_e OR h02_f), R := h02_h, LD := h02_k OR h02_j AND h02_i, PV := 30);
  h02_qu := CTUD0.QU;
  h02_qd := CTUD0.QD;
  h02_cv := CTUD0.CV;
  SR0(S1 := h03_c AND (h03_a OR h03_b), R := h03_d);
  h03_q1 := SR0.Q1;
  RS0(S := h03_e, R1 := h03_h OR h03_g AND h03_f);
  h03_q2 := RS0.Q1;
  TON0(IN := h04_e OR (h04_b OR h04_d AND h04_c) AND h04_a, PT := T#3s);
  h04_q := TON0.Q;
  h04_et := TON0.ET;
END_PROGRAM

