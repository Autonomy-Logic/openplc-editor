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
    try:
        socket.create_connection(('1.1.1.1', 80), timeout=2)
        print('raw IP connect succeeded')
    except OSError as error:
        print('raw IP connect failed:', type(error).__name__)
    try:
        open('/etc/hosts').read()
        print('host file read')
    except OSError as error:
        print('host file hidden:', type(error).__name__)
    socket.create_connection(('example.com', 80), timeout=2)
    connected = 1


def block_loop():
    pass

END_FUNCTION_BLOCK
