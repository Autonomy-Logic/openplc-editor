FUNCTION_BLOCK PySocket
  VAR_OUTPUT
    connected : DINT;
  END_VAR

from multiprocessing import shared_memory
import struct
import time
import os
import socket


def block_init():
    global connected
    socket.create_connection(('example.com', 80), timeout=2)
    connected = 1


def block_loop():
    pass

END_FUNCTION_BLOCK
