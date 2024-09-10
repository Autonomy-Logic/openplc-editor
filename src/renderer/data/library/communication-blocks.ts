import {
  BaseLibraryPouSchema,
  BaseLibrarySchema,
  BaseLibraryVariableSchema,
} from '@root/types/PLC/library'
import { z } from 'zod'

const CommunicationBlocksVariableSchema = BaseLibraryVariableSchema

const CommunicationBlocksPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(CommunicationBlocksVariableSchema),
})

const CommunicationBlocksLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(CommunicationBlocksPouSchema),
})

type CommunicationBlocksLibrary = z.infer<typeof CommunicationBlocksLibrarySchema>

const CommunicationBlocks: CommunicationBlocksLibrary = {
  name: 'Communication Blocks',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'src/renderer/data/library/communication-blocks/st',
  cPath: 'src/renderer/data/library/communication-blocks/c',
  pous: [
    {
      name: 'TCP_CONNECT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CONNECT', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'IP_ADDRESS', class: 'input', type: { definition: 'base-type', value: 'STRING' } },
        { name: 'PORT', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'SOCKET_ID', class: 'output', type: { definition: 'base-type', value: 'INT' } },
      ],
      body: 'SOCKET_ID := 0;',
      documentation: 'Connect to a remote TCP server when CONNECT is TRUE. Upon success, this block returns the connection ID on SOCKET_ID. If SOCKET_ID is less than zero, then the connection was not successfull',
    },
    {
      name: 'TCP_SEND',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'SEND', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'SOCKET_ID', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'MSG', class: 'input', type: { definition: 'base-type', value: 'STRING' } },
        { name: 'BYTES_SENT', class: 'output', type: { definition: 'base-type', value: 'INT' } },
      ],
      body: 'BYTES_SENT := 0;',
      documentation: 'Send a message to a remote device using TCP/IP when SEND is TRUE. SOCKET_ID must receive a connection ID from a successfull connection using the TCP_Connect block. BYTES_SENT returns the number of bytes sent to the remote device. If BYTES_SENT is less than zero then an error occurred while trying to send the message',
    },
    {
      name: 'TCP_RECEIVE',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'RECEIVE', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'SOCKET_ID', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'BYTES_RECEIVED', class: 'output', type: { definition: 'base-type', value: 'INT' } },
        { name: 'MSG', class: 'output', type: { definition: 'base-type', value: 'STRING' } },
      ],
      body: 'BYTES_RECEIVED := 0;',
      documentation: 'Send a message to a remote device using TCP/IP when SEND is TRUE. SOCKET_ID must receive a connection ID from a successfull connection using the TCP_Connect block. BYTES_RECEIVED returns the number of bytes received from the remote device. MSG is a String containing the message received',
    },
    {
      name: 'TCP_CLOSE',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CLOSE', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'SOCKET_ID', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'SUCCESS', class: 'output', type: { definition: 'base-type', value: 'INT' } },
      ],
      body: 'SUCCESS := 0;',
      documentation: 'Close the TCP connection with the remote server. If SUCCESS is less than zero, then the connection was not successfully closed, or the connection does not exist anymore.',
    },
  ],
}

export { CommunicationBlocks }