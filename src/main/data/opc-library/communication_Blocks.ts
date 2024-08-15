const communication_Blocks = {
    fileHeader: {
      companyName: "OpenPLC",
      productName: "Communication Blocks Library",
      productVersion: "1.0",
      creationDateTime: "2022-11-11T02:33:11",
    },
    contentHeader: {
      name: "Communication Blocks",
      author: "Thiago Alves",
      modificationDateTime: "2022-11-11T02:33:11",
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
          name: "TCP_CONNECT",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              { name: "CONNECT", type: { BOOL: {} } },
              { name: "IP_ADDRESS", type: { string: {} } },
              { name: "PORT", type: { INT: {} } },
            ],
            outputVars: [
              { name: "SOCKET_ID", type: { INT: {} } },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "SOCKET_ID := 0;",
              },
            },
          },
          documentation: {
            xhtml: {
              p: "Connect to a remote TCP server when CONNECT is TRUE. Upon success, this block returns the connection ID on SOCKET_ID. If SOCKET_ID is less than zero, then the connection was not successfull",
            },
          },
        },
        {
          name: "TCP_SEND",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              { name: "SEND", type: { BOOL: {} } },
              { name: "SOCKET_ID", type: { INT: {} } },
              { name: "MSG", type: { string: {} } },
            ],
            outputVars: [
              { name: "BYTES_SENT", type: { INT: {} } },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "BYTES_SENT := 0;",
              },
            },
          },
          documentation: {
            xhtml: {
              p: "Send a message to a remote device using TCP/IP when SEND is TRUE. SOCKET_ID must receive a connection ID from a successfull connection using the TCP_Connect block. BYTES_SENT returns the number of bytes sent to the remote device. If BYTES_SENT is less than zero then an error occurred while trying to send the message",
            },
          },
        },
        {
          name: "TCP_RECEIVE",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              { name: "RECEIVE", type: { BOOL: {} } },
              { name: "SOCKET_ID", type: { INT: {} } },
            ],
            outputVars: [
              { name: "BYTES_RECEIVED", type: { INT: {} } },
              { name: "MSG", type: { string: {} } },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "BYTES_RECEIVED := 0;",
              },
            },
          },
          documentation: {
            xhtml: {
              p: "Send a message to a remote device using TCP/IP when SEND is TRUE. SOCKET_ID must receive a connection ID from a successfull connection using the TCP_Connect block. BYTES_RECEIVED returns the number of bytes received from the remote device. MSG is a String containing the message received",
            },
          },
        },
        {
          name: "TCP_CLOSE",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              { name: "CLOSE", type: { BOOL: {} } },
              { name: "SOCKET_ID", type: { INT: {} } },
            ],
            outputVars: [
              { name: "SUCCESS", type: { INT: {} } },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: "SUCCESS := 0;",
              },
            },
          },
          documentation: {
            xhtml: {
              p: "Close the TCP connection with the remote server. If SUCCESS is less than zero, then the connection was not successfully closed, or the connection does not exist anymore.",
            },
          },
        },
      ],
    },
    instances: {
      configurations: {},
    },
  };

  export default communication_Blocks;
