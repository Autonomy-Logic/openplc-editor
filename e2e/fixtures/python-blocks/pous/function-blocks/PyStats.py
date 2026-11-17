FUNCTION_BLOCK PyStats
  VAR_INPUT
    x : REAL;
  END_VAR
  VAR_OUTPUT
    mean : REAL;
    count : DINT;
    beats : DINT;
  END_VAR

from multiprocessing import shared_memory
import struct
import time
import os
import threading
import numpy as np

_samples = []
_lock = threading.Lock()
_beats = 0


def _worker():
    global _beats
    while True:
        with _lock:
            _beats += 1
        time.sleep(0.05)


def block_init():
    print('PyStats started, numpy', np.__version__)
    threading.Thread(target=_worker, daemon=True).start()


def block_loop():
    global mean, count, beats
    _samples.append(x)
    if len(_samples) > 50:
        _samples.pop(0)
    mean = float(np.mean(np.array(_samples)))
    count = count + 1
    with _lock:
        beats = _beats
    if count % 20 == 0:
        print('count=' + str(count) + ' beats=' + str(beats) + ' mean=' + str(round(mean, 1)))

END_FUNCTION_BLOCK
