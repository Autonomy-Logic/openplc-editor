PROGRAM Aux
  VAR
    aux_a : BOOL;
    TON0 : TON;
    aux_x1 : BOOL;
    aux_x2 : BOOL;
    aux_x3 : BOOL;
    aux_et1 : TIME;
    aux_b : BOOL;
    CTU0 : CTU;
    aux_y1 : BOOL;
    aux_r2 : BOOL;
    aux_cv2 : INT;
    aux_c : BOOL;
    TOF0 : TOF;
    aux_z1 : BOOL;
    aux_z2 : BOOL;
    aux_d : BOOL;
    aux_e : BOOL;
    aux_w1 : BOOL;
  END_VAR

  TON0(IN := aux_a, PT := T#1s);
  aux_et1 := TON0.ET;
  aux_x1 := TON0.Q;
  aux_x2 := TON0.Q;
  aux_x3 := TON0.Q;
  CTU0(CU := aux_b, R := aux_r2, PV := 3);
  aux_y1 := CTU0.Q;
  aux_cv2 := CTU0.CV;
  TOF0(IN := aux_c OR aux_d, PT := T#2s);
  aux_z1 := TOF0.Q;
  aux_z2 := TOF0.Q;
  aux_w1 := aux_e;
END_PROGRAM

