
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
