interface FileHeader {
    companyName: string;
    productName: string;
    productVersion: string;
    creationDateTime: string;
  }

  interface CoordinateScaling {
    x: number;
    y: number;
  }

  interface CoordinateInfo {
    fbd: {
      scaling: CoordinateScaling;
    };
    ld: {
      scaling: CoordinateScaling;
    };
    sfc: {
      scaling: CoordinateScaling;
    };
  }

  interface Variable {
    name: string;
    type: string; // Usando 'string' para tipos como 'BOOL', 'string', 'UINT'
    documentation?: string; // 'documentation' é opcional e pode ser uma string
  }

  interface Interface {
    inputVars: Variable[];
    localVars?: Variable[];
    outputVars: Variable[];
  }

  interface Body {
    ST: {
      xhtml: {
        p: string;
      };
    };
  }

  interface Pou {
    name: string;
    pouType: string;
    interface: Interface;
    body: Body;
    documentation?: string; // 'documentation' é opcional e pode ser uma string
  }

  interface Types {
    dataTypes: object; // Especificar tipos se disponíveis
    pous: Pou[];
  }

  interface Instances {
    configurations: object; // Especificar configurações se disponíveis
  }

  interface MqttProject {
    fileHeader: FileHeader;
    contentHeader: {
      name: string;
      author: string;
      modificationDateTime: string;
      coordinateInfo: CoordinateInfo;
    };
    types: Types;
    instances: Instances;
  }

  // Exemplo de uso com base no XML fornecido
  const mqttProject: MqttProject = {
    fileHeader: {
      companyName: "OpenPLC",
      productName: "MQTT",
      productVersion: "1.0",
      creationDateTime: "2023-04-26T04:54:00",
    },
    contentHeader: {
      name: "MQTT",
      author: "OpenPLC Lib Writter",
      modificationDateTime: "2023-04-26T04:54:00",
      coordinateInfo: {
        fbd: {
          scaling: {
            x: 0,
            y: 0,
          },
        },
        ld: {
          scaling: {
            x: 0,
            y: 0,
          },
        },
        sfc: {
          scaling: {
            x: 0,
            y: 0,
          },
        },
      },
    },
    types: {
      dataTypes: {},
      pous: [
        {
          name: "MQTT_RECEIVE",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "RECEIVE",
                type: "BOOL",
                documentation: "RECEIVE",
              },
              {
                name: "TOPIC",
                type: "string",
                documentation: "TOPIC",
              },
            ],
            outputVars: [
              {
                name: "RECEIVED",
                type: "BOOL",
                documentation: "RECEIVED",
              },
              {
                name: "MESSAGE",
                type: "string",
                documentation: "MESSAGE",
              },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "RECEIVED := 0;",
              },
            },
          },
          documentation: "Receive MQTT messages for a particular TOPIC when RECEIVE is active. You must subscribe to a topic first before you can start receiving messages for that particular topic. Once a message is received, RECEIVED output is triggered, and MESSAGE will contain the received message as a STRING.",
        },
        {
          name: "MQTT_SEND",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "SEND",
                type: "BOOL",
                documentation: "SEND",
              },
              {
                name: "TOPIC",
                type: "string",
                documentation: "TOPIC",
              },
              {
                name: "MESSAGE",
                type: "string",
                documentation: "MESSAGE",
              },
            ],
            outputVars: [
              {
                name: "SUCCESS",
                type: "BOOL",
                documentation: "SUCCESS",
              },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "SUCCESS := 0;",
              },
            },
          },
          documentation: "Sends a MESSAGE to a particular TOPIC when SEND input is triggered. Keep in mind that SEND is not configured as a rising edge input, which means that MQTT_SEND will continuously send messages every scan cycle while SEND is TRUE. If the message was sent without errors, SUCCESS will be TRUE.",
        },
        {
          name: "MQTT_CONNECT",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "CONNECT",
                type: "BOOL",
                documentation: "CONNECT",
              },
              {
                name: "BROKER",
                type: "string",
                documentation: "BROKER",
              },
              {
                name: "PORT",
                type: "UINT",
                documentation: "PORT",
              },
            ],
            outputVars: [
              {
                name: "SUCCESS",
                type: "BOOL",
                documentation: "SUCCESS",
              },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "SUCCESS := 0;",
              },
            },
          },
          documentation: "Connect to a BROKER at a given PORT when CONNECT is triggered. If a successful connection is made, SUCCESS is set to TRUE.",
        },
        {
          name: "MQTT_CONNECT_AUTH",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "CONNECT",
                type: "BOOL",
                documentation: "CONNECT",
              },
              {
                name: "BROKER",
                type: "string",
                documentation: "BROKER",
              },
              {
                name: "PORT",
                type: "UINT",
                documentation: "PORT",
              },
              {
                name: "USER",
                type: "string",
                documentation: "USER",
              },
              {
                name: "PASSWORD",
                type: "string",
                documentation: "PASSWORD",
              },
            ],
            outputVars: [
              {
                name: "SUCCESS",
                type: "BOOL",
                documentation: "SUCCESS",
              },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "SUCCESS := 0;",
              },
            },
          },
          documentation: "Connect to an authenticated BROKER at a given PORT using the credentials from USER and PASSWORD when CONNECT is triggered. If a successful connection is made, SUCCESS is set to TRUE.",
        },
        {
          name: "MQTT_SUBSCRIBE",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "SUBSCRIBE",
                type: "BOOL",
                documentation: "SUBSCRIBE",
              },
              {
                name: "TOPIC",
                type: "string",
                documentation: "TOPIC",
              },
            ],
            outputVars: [
              {
                name: "SUCCESS",
                type: "BOOL",
                documentation: "SUCCESS",
              },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "SUCCESS := 0;",
              },
            },
          },
          documentation: "Subscribe to a given TOPIC when SUBSCRIBE input is triggered. Upon a successful subscription, SUCCESS is set to TRUE. Keep in mind that once you subscribe to a topic, OpenPLC will start receiving messages sent to that topic and storing them in a message pool. You must use the MQTT_RECEIVE block to retrieve messages from the pool and free up space to receive more messages. The maximum pool size is currently limited to 10 messages. If you let messages accumulate in the pool you will start losing messages once the pool is full.",
        },
        {
          name: "MQTT_UNSUBSCRIBE",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "UNSUBSCRIBE",
                type: "BOOL",
                documentation: "UNSUBSCRIBE",
              },
              {
                name: "TOPIC",
                type: "string",
                documentation: "TOPIC",
              },
            ],
            outputVars: [
              {
                name: "SUCCESS",
                type: "BOOL",
                documentation: "SUCCESS",
              },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "SUCCESS := 0;",
              },
            },
          },
          documentation: "Unsubscribe to a given TOPIC when UNSUBSCRIBE input is triggered. Upon a successful unsubscription, SUCCESS is set to TRUE. Keep in mind that once you unsubscribe to a topic, OpenPLC will stop storing messages sent to that topic in the message pool. However, messages received previously and not captured with an MQTT_RECEIVE block will remain in the pool using up pool space.",
        },
        {
          name: "MQTT_DISCONNECT",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "DISCONNECT",
                type: "BOOL",
                documentation: "DISCONNECT",
              },
            ],
            outputVars: [
              {
                name: "SUCCESS",
                type: "BOOL",
                documentation: "SUCCESS",
              },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "SUCCESS := 0;",
              },
            },
          },
          documentation: "Disconnects from the current broker when DISCONNECT is set to TRUE. Upon a successful disconnection, SUCCESS is set to TRUE.",
        },
      ],
    },
    instances: {
      configurations: {},
    },
  };
