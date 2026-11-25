PROGRAM Main
  VAR
    b01_start : BOOL;
    b01_motor : BOOL;
    b01_permit : BOOL;
    b01_guard : BOOL;
    b02_a : BOOL;
    b02_out : BOOL;
    b02_b : BOOL;
    b02_c : BOOL;
    b02_e : BOOL;
    b06_run : BOOL;
    b06_lamp1 : BOOL;
    b06_lamp2 : BOOL;
    b06_lamp3 : BOOL;
    b07_cmd : BOOL;
    b07_latch : BOOL;
    b07_unlatch : BOOL;
    b07_rise : BOOL;
    b07_fall : BOOL;
    b11_conveyor_section_one_upstream_permissive_signal : BOOL;
    TON0 : TON;
    b11_conveyor_section_one_downstream_motor_run_command : BOOL;
    b11_conveyor_section_one_start_delay_preset_time_value : TIME;
    b11_conveyor_section_one_start_delay_elapsed_time_value : TIME;
    _TMP_R_TRIG1898394 : R_TRIG;
    _TMP_F_TRIG2000051 : F_TRIG;
  END_VAR

  b01_motor := b01_guard AND b01_permit AND b01_start;
  b02_out := b02_a OR b02_b OR b02_e AND b02_c;
  b06_lamp1 := b06_run;
  b06_lamp2 := b06_run;
  b06_lamp3 := b06_run;
  IF b07_cmd THEN
    b07_latch := TRUE; (*set*)
  END_IF;
  IF b07_cmd THEN
    b07_unlatch := FALSE; (*reset*)
  END_IF;
  _TMP_R_TRIG1898394(CLK := b07_cmd);
  b07_rise := _TMP_R_TRIG1898394.Q;
  _TMP_F_TRIG2000051(CLK := b07_cmd);
  b07_fall := _TMP_F_TRIG2000051.Q;
  TON0(IN := b11_conveyor_section_one_upstream_permissive_signal, PT := b11_conveyor_section_one_start_delay_preset_time_value);
  b11_conveyor_section_one_downstream_motor_run_command := TON0.Q;
  b11_conveyor_section_one_start_delay_elapsed_time_value := TON0.ET;
END_PROGRAM


