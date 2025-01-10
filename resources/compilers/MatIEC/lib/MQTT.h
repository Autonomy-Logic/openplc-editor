
// FUNCTION_BLOCK MQTT_RECEIVE

// Data part
typedef struct {
  // FB Interface - IN, OUT, IN_OUT variables
  __DECLARE_VAR(BOOL,EN)
  __DECLARE_VAR(BOOL,ENO)
  __DECLARE_VAR(BOOL,RECEIVE)
  __DECLARE_VAR(STRING,TOPIC)
  __DECLARE_VAR(BOOL,RECEIVED)
  __DECLARE_VAR(STRING,MESSAGE)

  // FB private variables - TEMP, private and located variables

} MQTT_RECEIVE;

static void MQTT_RECEIVE_init__(MQTT_RECEIVE *data__, BOOL retain);
// Code part
static void MQTT_RECEIVE_body__(MQTT_RECEIVE *data__);
// FUNCTION_BLOCK MQTT_SEND
// Data part
typedef struct {
  // FB Interface - IN, OUT, IN_OUT variables
  __DECLARE_VAR(BOOL,EN)
  __DECLARE_VAR(BOOL,ENO)
  __DECLARE_VAR(BOOL,SEND)
  __DECLARE_VAR(STRING,TOPIC)
  __DECLARE_VAR(STRING,MESSAGE)
  __DECLARE_VAR(BOOL,SUCCESS)

  // FB private variables - TEMP, private and located variables

} MQTT_SEND;

static void MQTT_SEND_init__(MQTT_SEND *data__, BOOL retain);
// Code part
static void MQTT_SEND_body__(MQTT_SEND *data__);
// FUNCTION_BLOCK MQTT_CONNECT
// Data part
typedef struct {
  // FB Interface - IN, OUT, IN_OUT variables
  __DECLARE_VAR(BOOL,EN)
  __DECLARE_VAR(BOOL,ENO)
  __DECLARE_VAR(BOOL,CONNECT)
  __DECLARE_VAR(STRING,BROKER)
  __DECLARE_VAR(UINT,PORT)
  __DECLARE_VAR(BOOL,SUCCESS)

  // FB private variables - TEMP, private and located variables

} MQTT_CONNECT;

static void MQTT_CONNECT_init__(MQTT_CONNECT *data__, BOOL retain);
// Code part
static void MQTT_CONNECT_body__(MQTT_CONNECT *data__);
// FUNCTION_BLOCK MQTT_CONNECT_AUTH
// Data part
typedef struct {
  // FB Interface - IN, OUT, IN_OUT variables
  __DECLARE_VAR(BOOL,EN)
  __DECLARE_VAR(BOOL,ENO)
  __DECLARE_VAR(BOOL,CONNECT)
  __DECLARE_VAR(STRING,BROKER)
  __DECLARE_VAR(UINT,PORT)
  __DECLARE_VAR(STRING,USER)
  __DECLARE_VAR(STRING,PASSWORD)
  __DECLARE_VAR(BOOL,SUCCESS)

  // FB private variables - TEMP, private and located variables

} MQTT_CONNECT_AUTH;

static void MQTT_CONNECT_AUTH_init__(MQTT_CONNECT_AUTH *data__, BOOL retain);
// Code part
static void MQTT_CONNECT_AUTH_body__(MQTT_CONNECT_AUTH *data__);
// FUNCTION_BLOCK MQTT_SUBSCRIBE
// Data part
typedef struct {
  // FB Interface - IN, OUT, IN_OUT variables
  __DECLARE_VAR(BOOL,EN)
  __DECLARE_VAR(BOOL,ENO)
  __DECLARE_VAR(BOOL,SUBSCRIBE)
  __DECLARE_VAR(STRING,TOPIC)
  __DECLARE_VAR(BOOL,SUCCESS)

  // FB private variables - TEMP, private and located variables

} MQTT_SUBSCRIBE;

static void MQTT_SUBSCRIBE_init__(MQTT_SUBSCRIBE *data__, BOOL retain);
// Code part
static void MQTT_SUBSCRIBE_body__(MQTT_SUBSCRIBE *data__);
// FUNCTION_BLOCK MQTT_UNSUBSCRIBE
// Data part
typedef struct {
  // FB Interface - IN, OUT, IN_OUT variables
  __DECLARE_VAR(BOOL,EN)
  __DECLARE_VAR(BOOL,ENO)
  __DECLARE_VAR(BOOL,UNSUBSCRIBE)
  __DECLARE_VAR(STRING,TOPIC)
  __DECLARE_VAR(BOOL,SUCCESS)

  // FB private variables - TEMP, private and located variables

} MQTT_UNSUBSCRIBE;

static void MQTT_UNSUBSCRIBE_init__(MQTT_UNSUBSCRIBE *data__, BOOL retain);
// Code part
static void MQTT_UNSUBSCRIBE_body__(MQTT_UNSUBSCRIBE *data__);
// FUNCTION_BLOCK MQTT_DISCONNECT
// Data part
typedef struct {
  // FB Interface - IN, OUT, IN_OUT variables
  __DECLARE_VAR(BOOL,EN)
  __DECLARE_VAR(BOOL,ENO)
  __DECLARE_VAR(BOOL,DISCONNECT)
  __DECLARE_VAR(BOOL,SUCCESS)

  // FB private variables - TEMP, private and located variables

} MQTT_DISCONNECT;

static void MQTT_DISCONNECT_init__(MQTT_DISCONNECT *data__, BOOL retain);
// Code part
static void MQTT_DISCONNECT_body__(MQTT_DISCONNECT *data__);


// External C Functions
uint8_t connect_mqtt(char *broker, uint16_t port);
uint8_t connect_mqtt_auth(char *broker, uint16_t port, char *user, char *password);
uint8_t mqtt_send(char *topic, char *message);
void mqtt_loop();
uint8_t mqtt_receive(char *topic, char *message);
uint8_t mqtt_subscribe(char *topic);
uint8_t mqtt_unsubscribe(char *topic);
uint8_t mqtt_disconnect();


static void MQTT_RECEIVE_init__(MQTT_RECEIVE *data__, BOOL retain) {
  __INIT_VAR(data__->EN,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->ENO,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->RECEIVE,__BOOL_LITERAL(FALSE),retain)
  __INIT_VAR(data__->TOPIC,__STRING_LITERAL(0,""),retain)
  __INIT_VAR(data__->RECEIVED,__BOOL_LITERAL(FALSE),retain)
  __INIT_VAR(data__->MESSAGE,__STRING_LITERAL(0,""),retain)
}

// Code part
static void MQTT_RECEIVE_body__(MQTT_RECEIVE *data__) {
  // Control execution
  if (!__GET_VAR(data__->EN)) {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(FALSE));
    return;
  }
  else {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(TRUE));
  }

  if (__GET_VAR(data__->RECEIVE))
  {
    // Make sure strings are NULL terminated
    __GET_VAR(data__->TOPIC).body[__GET_VAR(data__->TOPIC).len] = '\0';

    __GET_VAR(data__->MESSAGE).len = mqtt_receive(__GET_VAR(data__->TOPIC).body, __GET_VAR(data__->MESSAGE).body);
    if (__GET_VAR(data__->MESSAGE).len > 0)
    {
      __SET_VAR(data__->,RECEIVED,,1);
    }
    else
    {
      __SET_VAR(data__->,RECEIVED,,0);
    }
  }
  else
  {
    __SET_VAR(data__->,RECEIVED,,0);
  }

  goto __end;

__end:
  return;
} // MQTT_RECEIVE_body__() 





static void MQTT_SEND_init__(MQTT_SEND *data__, BOOL retain) {
  __INIT_VAR(data__->EN,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->ENO,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->SEND,__BOOL_LITERAL(FALSE),retain)
  __INIT_VAR(data__->TOPIC,__STRING_LITERAL(1,"\0"),retain)
  __INIT_VAR(data__->MESSAGE,__STRING_LITERAL(1,"\0"),retain)
  __INIT_VAR(data__->SUCCESS,__BOOL_LITERAL(FALSE),retain)
}

// Code part
static void MQTT_SEND_body__(MQTT_SEND *data__) {
  // Control execution
  if (!__GET_VAR(data__->EN)) {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(FALSE));
    return;
  }
  else {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(TRUE));
  }
  // Initialise TEMP variables

  uint8_t message_sent = 0;

  if (__GET_VAR(data__->SEND))
  {
    // Make sure strings are NULL terminated
    __GET_VAR(data__->TOPIC).body[__GET_VAR(data__->TOPIC).len] = '\0';
    __GET_VAR(data__->MESSAGE).body[__GET_VAR(data__->MESSAGE).len] = '\0';

    message_sent = mqtt_send(__GET_VAR(data__->TOPIC).body, __GET_VAR(data__->MESSAGE).body);
  }

  __SET_VAR(data__->,SUCCESS,,message_sent);

  goto __end;

__end:
  return;
} // MQTT_SEND_body__() 



static void MQTT_CONNECT_init__(MQTT_CONNECT *data__, BOOL retain) {
  __INIT_VAR(data__->EN,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->ENO,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->CONNECT,__BOOL_LITERAL(FALSE),retain)
  __INIT_VAR(data__->BROKER,__STRING_LITERAL(1,"\0"),retain)
  __INIT_VAR(data__->PORT,0,retain)
  __INIT_VAR(data__->SUCCESS,__BOOL_LITERAL(FALSE),retain)
}

// Code part
static void MQTT_CONNECT_body__(MQTT_CONNECT *data__) {
  // Control execution
  if (!__GET_VAR(data__->EN)) {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(FALSE));
    return;
  }
  else {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(TRUE));
  }
  // Initialise TEMP variables

  if (__GET_VAR(data__->CONNECT))
  {
    // Make sure strings are NULL terminated
    __GET_VAR(data__->BROKER).body[__GET_VAR(data__->BROKER).len] = '\0';

    uint8_t mqtt_connected = connect_mqtt(__GET_VAR(data__->BROKER).body, __GET_VAR(data__->PORT));
    __SET_VAR(data__->,SUCCESS,,mqtt_connected);
  }

  // Call MQTT loop every scan cycle after a successfull connection
  if (__GET_VAR(data__->SUCCESS))
  {
    mqtt_loop();
  }

  goto __end;

__end:
  return;
} // MQTT_CONNECT_body__() 



static void MQTT_CONNECT_AUTH_init__(MQTT_CONNECT_AUTH *data__, BOOL retain) {
  __INIT_VAR(data__->EN,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->ENO,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->CONNECT,__BOOL_LITERAL(FALSE),retain)
  __INIT_VAR(data__->BROKER,__STRING_LITERAL(1,"\0"),retain)
  __INIT_VAR(data__->PORT,0,retain)
  __INIT_VAR(data__->USER,__STRING_LITERAL(1,"\0"),retain)
  __INIT_VAR(data__->PASSWORD,__STRING_LITERAL(1,"\0"),retain)
  __INIT_VAR(data__->SUCCESS,__BOOL_LITERAL(FALSE),retain)
}

// Code part
static void MQTT_CONNECT_AUTH_body__(MQTT_CONNECT_AUTH *data__) {
  // Control execution
  if (!__GET_VAR(data__->EN)) {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(FALSE));
    return;
  }
  else {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(TRUE));
  }
  // Initialise TEMP variables

  if (__GET_VAR(data__->CONNECT))
  {
    // Make sure strings are NULL terminated
    __GET_VAR(data__->BROKER).body[__GET_VAR(data__->BROKER).len] = '\0';
    __GET_VAR(data__->USER).body[__GET_VAR(data__->USER).len] = '\0';
    __GET_VAR(data__->PASSWORD).body[__GET_VAR(data__->PASSWORD).len] = '\0';

    uint8_t mqtt_connected = connect_mqtt_auth(__GET_VAR(data__->BROKER).body, __GET_VAR(data__->PORT), __GET_VAR(data__->USER).body, __GET_VAR(data__->PASSWORD).body);
    __SET_VAR(data__->,SUCCESS,,mqtt_connected);
  }

  // Call MQTT loop every scan cycle after a successfull connection
  if (__GET_VAR(data__->SUCCESS))
  {
    mqtt_loop();
  }

  goto __end;

__end:
  return;
} // MQTT_CONNECT_AUTH_body__() 





static void MQTT_SUBSCRIBE_init__(MQTT_SUBSCRIBE *data__, BOOL retain) {
  __INIT_VAR(data__->EN,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->ENO,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->SUBSCRIBE,__BOOL_LITERAL(FALSE),retain)
  __INIT_VAR(data__->TOPIC,__STRING_LITERAL(0,""),retain)
  __INIT_VAR(data__->SUCCESS,__BOOL_LITERAL(FALSE),retain)
}

// Code part
static void MQTT_SUBSCRIBE_body__(MQTT_SUBSCRIBE *data__) {
  // Control execution
  if (!__GET_VAR(data__->EN)) {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(FALSE));
    return;
  }
  else {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(TRUE));
  }
  // Initialise TEMP variables

  if (__GET_VAR(data__->SUBSCRIBE))
  {
    // Make sure strings are NULL terminated
    __GET_VAR(data__->TOPIC).body[__GET_VAR(data__->TOPIC).len] = '\0';

    uint8_t topic_subscribed = mqtt_subscribe(__GET_VAR(data__->TOPIC).body);
    __SET_VAR(data__->,SUCCESS,,topic_subscribed);
  }

  goto __end;

__end:
  return;
} // MQTT_SUBSCRIBE_body__() 





static void MQTT_UNSUBSCRIBE_init__(MQTT_UNSUBSCRIBE *data__, BOOL retain) {
  __INIT_VAR(data__->EN,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->ENO,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->UNSUBSCRIBE,__BOOL_LITERAL(FALSE),retain)
  __INIT_VAR(data__->TOPIC,__STRING_LITERAL(0,""),retain)
  __INIT_VAR(data__->SUCCESS,__BOOL_LITERAL(FALSE),retain)
}

// Code part
static void MQTT_UNSUBSCRIBE_body__(MQTT_UNSUBSCRIBE *data__) {
  // Control execution
  if (!__GET_VAR(data__->EN)) {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(FALSE));
    return;
  }
  else {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(TRUE));
  }
  // Initialise TEMP variables

  if (__GET_VAR(data__->UNSUBSCRIBE))
  {
    // Make sure strings are NULL terminated
    __GET_VAR(data__->TOPIC).body[__GET_VAR(data__->TOPIC).len] = '\0';

    uint8_t topic_unsubscribed = mqtt_unsubscribe(__GET_VAR(data__->TOPIC).body);
    __SET_VAR(data__->,SUCCESS,,topic_unsubscribed);
  }

  goto __end;

__end:
  return;
} // MQTT_UNSUBSCRIBE_body__() 




static void MQTT_DISCONNECT_init__(MQTT_DISCONNECT *data__, BOOL retain) {
  __INIT_VAR(data__->EN,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->ENO,__BOOL_LITERAL(TRUE),retain)
  __INIT_VAR(data__->DISCONNECT,__BOOL_LITERAL(FALSE),retain)
  __INIT_VAR(data__->SUCCESS,__BOOL_LITERAL(FALSE),retain)
}

// Code part
static void MQTT_DISCONNECT_body__(MQTT_DISCONNECT *data__) {
  // Control execution
  if (!__GET_VAR(data__->EN)) {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(FALSE));
    return;
  }
  else {
    __SET_VAR(data__->,ENO,,__BOOL_LITERAL(TRUE));
  }
  // Initialise TEMP variables

  if (__GET_VAR(data__->DISCONNECT))
  {
    uint8_t broker_disconnected = mqtt_disconnect();
    __SET_VAR(data__->,SUCCESS,,broker_disconnected);
  }

  goto __end;

__end:
  return;
} // MQTT_DISCONNECT_body__() 
