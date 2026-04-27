
import { Buffer } from 'buffer';

// Simple CRC32 implementation
const CRC_TABLE: number[] = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Protocol Constants
export const PROTOCOL = {
  HEADER: 0x6B,           // Protocol header
  VERSION: 0,             // Protocol version
  MAX_PACKET_SIZE: 4500,  // Max packet size
  FRAME_HEAD_SIZE: 10,    // FrameHead size
  DEFAULT_TIMEOUT: 5000,  // Default timeout (ms)
};

// Service IDs
export const SERVICE_ID = {
  DEVICE_INFO: 1,
  FILE_TRANS: 2,
  NFT_FILE_TRANS: 3,
};

// Device Info Command IDs
export const DEVICE_INFO_CMD = {
  BASIC: 1,      // Get basic info
  RUNNING: 2,    // Get running status
};

// TLV Type Definitions
export const TLV_TYPE = {
  DEVICE_MODEL: 1,
  DEVICE_SERIAL_NUMBER: 2,
  DEVICE_HARDWARE_VERSION: 3,
  DEVICE_FIRMWARE_VERSION: 4,
  DEVICE_BOOT_VERSION: 5,
  GENERAL_RESULT_ACK: 0xFF,
  UPDATE_PUB_KEY: 0x10,
};

// EAPDU Constants
export const EAPDU = {
  HEADER: 0x00,           // CLA field
  MAX_PACKET_LENGTH: 64,  // Maximum packet size
  OFFSET_CLA: 0,
  OFFSET_INS: 1,          // Command type (2 bytes)
  OFFSET_P1: 3,           // Total packets (2 bytes)
  OFFSET_P2: 5,           // Packet index (2 bytes)
  OFFSET_LC: 7,           // Request ID (2 bytes)
  OFFSET_CDATA: 9,        // Data starts here
  RESPONSE_STATUS_LENGTH: 2,
};

// Command Types (EAPDU)
export enum CmdType {
  ECHO_TEST = 0x00000001,
  RESOLVE_UR = 0x00000002,
  CHECK_LOCK_STATUS = 0x00000003,
  EXPORT_ADDRESS = 0x00000004,
  GET_DEVICE_INFO = 0x00000005,
  GET_DEVICE_USB_PUBKEY = 0x00000006,
  GET_DEVICE_RANDOM = 0x00000007,
}

// Status Codes (Shared)
export const STATUS = {
  SUCCESS: 0x00,
  ERROR_INVALID_CMD: 0x01,
  ERROR_INVALID_LENGTH: 0x02,
  ERROR_INVALID_DATA: 0x03,
  ERROR_DEVICE_BUSY: 0x04,
  ERROR_TIMEOUT: 0x05,
  ERROR_UNKNOWN: 0xFF,
};

export const EAPDU_STATUS = {
    SUCCESS: 0x00000000,
    FAILURE: 0x00000001,
    INVALID_TOTAL_PACKETS: 0x00000002,
    INVALID_INDEX: 0x00000003,
};

function insert16BitValue(buffer: Buffer, offset: number, value: number) {
  buffer.writeUInt16BE(value, offset);
}

// --- EAPDU Functions ---

/**
 * Build EAPDU packets for sending data
 */
export function buildEapduPackets(commandType: number, data: Buffer, requestId = 0): Buffer[] {
  const maxDataPerPacket = EAPDU.MAX_PACKET_LENGTH - EAPDU.OFFSET_CDATA;
  const dataLen = data ? data.length : 0;
  const totalPackets = Math.ceil(dataLen / maxDataPerPacket) || 1;
  
  const packets: Buffer[] = [];
  let offset = 0;
  
  for (let packetIndex = 0; packetIndex < totalPackets; packetIndex++) {
    const packet = Buffer.alloc(EAPDU.MAX_PACKET_LENGTH);
    const remainingData = dataLen - offset;
    const packetDataSize = Math.min(remainingData, maxDataPerPacket);
    
    // Build EAPDU frame
    packet[EAPDU.OFFSET_CLA] = EAPDU.HEADER;                    // CLA = 0x00
    insert16BitValue(packet, EAPDU.OFFSET_INS, commandType);    // INS = command type
    insert16BitValue(packet, EAPDU.OFFSET_P1, totalPackets);    // P1 = total packets
    insert16BitValue(packet, EAPDU.OFFSET_P2, packetIndex);     // P2 = packet index
    insert16BitValue(packet, EAPDU.OFFSET_LC, requestId);       // LC = request ID
    
    // Copy data if available
    if (data && packetDataSize > 0) {
      data.copy(packet, EAPDU.OFFSET_CDATA, offset, offset + packetDataSize);
      offset += packetDataSize;
    }
    
    // Trim packet to actual size? No, usually USB packets are fixed size or aligned.
    // The reference implementation trims it.
    const actualSize = EAPDU.OFFSET_CDATA + packetDataSize;
    packets.push(packet.slice(0, actualSize));
  }
  
  return packets;
}

export interface EapduResponse {
  success: boolean;
  status: number;
  statusMessage: string;
  commandType: number;
  requestId: number;
  payload: Buffer;
  totalPackets: number;
  packetIndex: number;
}

/**
 * Parse EAPDU response packet
 */
export function parseEapduResponse(data: Buffer): EapduResponse {
  if (!data || data.length < EAPDU.OFFSET_CDATA + EAPDU.RESPONSE_STATUS_LENGTH) {
    throw new Error('Invalid EAPDU response: data too short');
  }

  // const cla = data[EAPDU.OFFSET_CLA];
  const commandType = data.readUInt16BE(EAPDU.OFFSET_INS);
  const totalPackets = data.readUInt16BE(EAPDU.OFFSET_P1);
  const packetIndex = data.readUInt16BE(EAPDU.OFFSET_P2);
  const requestId = data.readUInt16BE(EAPDU.OFFSET_LC);
  
  // Response format is: [header][payload][status(2 bytes)]
  const statusOffset = data.length - EAPDU.RESPONSE_STATUS_LENGTH;
  if (statusOffset < EAPDU.OFFSET_CDATA) {
    throw new Error('Invalid EAPDU response: missing payload/status boundary');
  }

  const status = data.readUInt16BE(statusOffset);
  const payload = data.subarray(EAPDU.OFFSET_CDATA, statusOffset);
  
  let statusMessage = 'Unknown';
  if (status === EAPDU_STATUS.SUCCESS) statusMessage = 'Success';
  else if (status === EAPDU_STATUS.FAILURE) statusMessage = 'Failure';
  
  return {
    success: status === EAPDU_STATUS.SUCCESS,
    status,
    statusMessage,
    commandType,
    requestId,
    payload,
    totalPackets,
    packetIndex
  };
}


// --- Protocol (Frame/TLV) Functions ---

function encodeTLV(type: number, value?: Buffer): Buffer {
  const length = value ? value.length : 0;
  let tlvBuffer;
  
  if (length > 127) {
    // Length > 127, use two-byte encoding
    tlvBuffer = Buffer.alloc(3 + length);
    tlvBuffer.writeUInt8(type, 0);
    tlvBuffer.writeUInt8(0x80 | (length >> 8), 1);
    tlvBuffer.writeUInt8(length & 0xFF, 2);
    if (value) {
      value.copy(tlvBuffer, 3);
    }
  } else {
    // Length <= 127, use single-byte encoding
    tlvBuffer = Buffer.alloc(2 + length);
    tlvBuffer.writeUInt8(type, 0);
    tlvBuffer.writeUInt8(length, 1);
    if (value) {
      value.copy(tlvBuffer, 2);
    }
  }
  
  return tlvBuffer;
}

export function buildPacket(serviceId: number, commandId: number, tlvArray: {type: number, value: Buffer}[] = [], packetIndex = 0): Buffer {
  // Encode TLVs
  const tlvBuffers = tlvArray.map(tlv => encodeTLV(tlv.type, tlv.value));
  const tlvData = Buffer.concat(tlvBuffers);
  
  // Build Frame Head
  const frameHead = Buffer.alloc(PROTOCOL.FRAME_HEAD_SIZE);
  frameHead.writeUInt8(PROTOCOL.HEADER, 0);           // head = 0x6B
  frameHead.writeUInt8(PROTOCOL.VERSION, 1);          // version = 0
  frameHead.writeUInt16LE(packetIndex, 2);            // packet_index (LE)
  frameHead.writeUInt8(serviceId, 4);                 // service_id (1 byte)
  frameHead.writeUInt8(commandId, 5);                 // command_id (1 byte)
  frameHead.writeUInt16LE(0x0002, 6);                 // flag: isHost=1, ack=0 (LE)
  frameHead.writeUInt16LE(tlvData.length, 8);         // data_len (LE)
  
  // Combine head and data for CRC
  const frameWithoutCrc = Buffer.concat([frameHead, tlvData]);
  
  // Calculate CRC
  const crc32Value = crc32(frameWithoutCrc);
  const crc32Buffer = Buffer.alloc(4);
  crc32Buffer.writeUInt32LE(crc32Value, 0);
  
  // Complete frame
  return Buffer.concat([frameWithoutCrc, crc32Buffer]);
}

export function parseResponse(data: Buffer) {
    if (!data || data.length < PROTOCOL.FRAME_HEAD_SIZE) {
        throw new Error("Data too short");
    }
    
    // Parse Frame Head
    const header = data.readUInt8(0);
    // const version = data.readUInt8(1);
    const packetIndex = data.readUInt16LE(2);
    const serviceId = data.readUInt8(4);
    const commandId = data.readUInt8(5);
    // const flag = data.readUInt16LE(6);
    const length = data.readUInt16LE(8);
    
    if (header !== PROTOCOL.HEADER) {
        throw new Error(`Invalid protocol header: 0x${header.toString(16)}`);
    }
    
    // Parse TLVs
    // Data starts at FRAME_HEAD_SIZE, length is `length`
    const tlvData = data.slice(PROTOCOL.FRAME_HEAD_SIZE, PROTOCOL.FRAME_HEAD_SIZE + length);
    
    const tlvArray: {type: number, value: Buffer}[] = [];
    let offset = 0;
    
    while (offset < tlvData.length) {
        if (offset + 1 > tlvData.length) break;
        
        const type = tlvData.readUInt8(offset++);
        let len = 0;
        
        if (offset >= tlvData.length) break;
        
        const firstByte = tlvData.readUInt8(offset);
        if (firstByte > 127) {
            // 2-byte length
            if (offset + 2 > tlvData.length) break;
            len = ((tlvData[offset] & 0x7F) << 8) | tlvData[offset + 1];
            offset += 2;
        } else {
            // 1-byte length
            len = tlvData.readUInt8(offset++);
        }
        
        if (offset + len > tlvData.length) break;
        const value = tlvData.slice(offset, offset + len);
        tlvArray.push({type, value});
        offset += len;
    }
    
    return {
        serviceId,
        commandId,
        packetIndex,
        tlvArray
    };
}
