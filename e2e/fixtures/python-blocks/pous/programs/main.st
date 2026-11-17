PROGRAM main
  VAR
    counter : DINT;
    stats : PyStats;
    fail : PyFail;
    spin : PySpin;
    net : PySocket;
    py_mean : REAL;
    py_count : DINT;
    py_beats : DINT;
    fail_count : DINT;
    spin_entered : DINT;
    net_connected : DINT;
  END_VAR

counter := counter + 1;
stats(x := DINT_TO_REAL(counter MOD 100));
py_mean := stats.mean;
py_count := stats.count;
py_beats := stats.beats;
fail();
fail_count := fail.count;
spin();
spin_entered := spin.entered;
net();
net_connected := net.connected;

END_PROGRAM
