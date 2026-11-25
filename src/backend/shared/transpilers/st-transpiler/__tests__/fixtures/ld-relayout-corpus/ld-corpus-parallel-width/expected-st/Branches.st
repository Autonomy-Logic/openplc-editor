PROGRAM Branches
  VAR
    w01_a : BOOL;
    w01_y : BOOL;
    w01_b : BOOL;
    w01_e : BOOL;
    w01_c : BOOL;
    w01_d : BOOL;
    w02_f : BOOL;
    w02_y : BOOL;
    w02_g : BOOL;
    w02_j : BOOL;
    w02_h : BOOL;
    w02_i : BOOL;
    w02_k : BOOL;
    w03_e : BOOL;
    w03_y : BOOL;
    w03_a : BOOL;
    w03_b : BOOL;
    w03_d : BOOL;
    w03_c : BOOL;
    w04_a : BOOL;
    w04_y : BOOL;
    w04_conveyor_infeed_photoeye_blocked_longer_than_limit : BOOL;
    w04_b : BOOL;
    w05_a : BOOL;
    w05_k : BOOL;
    w05_conveyor_reject_gate_solenoid_output_main : BOOL;
  END_VAR

  w01_y := (w01_e OR w01_d AND w01_c AND w01_b) AND w01_a;
  w02_y := w02_f OR w02_i AND w02_h AND w02_g OR w02_k AND w02_j;
  w03_y := w03_e OR (w03_d OR w03_c AND w03_b) AND w03_a;
  w04_y := w04_conveyor_infeed_photoeye_blocked_longer_than_limit OR w04_b AND w04_a;
  w05_k := w05_a;
  w05_conveyor_reject_gate_solenoid_output_main := w05_a;
END_PROGRAM


