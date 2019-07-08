// All code in this folder is heavily based on the node project ntlm-client.
// https://github.com/clncln1/node-ntlm-client
// ----------------------------------------------------------------------------
// Original license statement:

// Copyright (c) 2015 Nico Haller

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
// ----------------------------------------------------------------------------

'use strict';

const os = require('os'),
	flags = require('./flags'),
	hash = require('./hash');

const NTLMSIGNATURE = "NTLMSSP\0";

function createType1MessageRaw(ntlm_version, workstation, target) {
  let dataPos = 40;
	let pos = 0;
	let buf = Buffer.alloc(256);

  target = target === undefined ? '' : target;
  workstation = workstation === undefined ? '' : workstation;

	//signature
	buf.write(NTLMSIGNATURE, pos, NTLMSIGNATURE.length, 'ascii');
	pos += NTLMSIGNATURE.length;

	//message type
	buf.writeUInt32LE(1, pos);
	pos += 4;

  //flags
  let messageFlags = flags.NTLMFLAG_NEGOTIATE_OEM |
    flags.NTLMFLAG_NEGOTIATE_ALWAYS_SIGN |
    flags.NTLMFLAG_NEGOTIATE_TARGET_INFO |
    flags.NTLMFLAG_NEGOTIATE_VERSION;

  if (ntlm_version == 1) {
    messageFlags |= flags.NTLMFLAG_NEGOTIATE_NTLM_KEY |
      flags.NTLMFLAG_NEGOTIATE_LM_KEY;
  } else {
    messageFlags |= flags.NTLMFLAG_NEGOTIATE_NTLM2_KEY;
  }

  if (target.length > 0) {
    messageFlags |= flags.NTLMFLAG_NEGOTIATE_DOMAIN_SUPPLIED;
  }
  if (workstation.length > 0) {
    messageFlags |= flags.NTLMFLAG_NEGOTIATE_WORKSTATION_SUPPLIED;
  }

	buf.writeUInt32LE(messageFlags, pos);
	pos += 4;

  //domain security buffer
  buf.writeUInt16LE(target.length, pos);
  pos += 2;
  buf.writeUInt16LE(target.length, pos);
  pos += 2;
  buf.writeUInt32LE(dataPos, pos);
  pos += 4;

  if (target.length > 0) {
    dataPos += buf.write(target, dataPos, 'ascii');
  }

  //workstation security buffer
  buf.writeUInt16LE(workstation.length, pos);
  pos += 2;
  buf.writeUInt16LE(workstation.length, pos);
  pos += 2;
  buf.writeUInt32LE(dataPos, pos);
  pos += 4;

  if (workstation.length > 0) {
    dataPos += buf.write(workstation, dataPos, 'ascii');
  }

  addVersionStruct(buf, pos);
  return buf.slice(0, dataPos);
}

function createType1Message(ntlm_version, workstation, target) {
  let buf = createType1MessageRaw(ntlm_version, workstation, target);
	return 'NTLM ' + buf.toString('base64');
}

  // Version - hard-coded to
  // Major version 10, minor version 0 (Windows 10)
  // build number 18362 (1903 update), NTLM revision 15
function addVersionStruct(buf, pos) {
  buf.writeUInt8(10, pos);
  pos++;
  buf.writeUInt8(0, pos);
  pos++;
  buf.writeUInt16LE(18362, pos);
  pos += 2;
  buf.writeUInt32LE(0x0F000000, pos);
  pos += 4;
  return pos;
}

function decodeType2Message(str) {
	if (str === undefined) {
		throw new Error('Invalid argument');
	}

	//convenience
	if (Object.prototype.toString.call(str) !== '[object String]') {
		if (str.hasOwnProperty('headers') && str.headers.hasOwnProperty('www-authenticate')) {
			str = str.headers['www-authenticate'];
		} else {
			throw new Error('Invalid argument');
		}
	}

	let ntlmMatch = /^NTLM ([^,\s]+)/.exec(str);

	if (ntlmMatch) {
		str = ntlmMatch[1];
	}

	let buf = Buffer.from(str, 'base64');
  let obj = {};
  obj.raw = buf;

	//check signature
	if (buf.toString('ascii', 0, NTLMSIGNATURE.length) !== NTLMSIGNATURE) {
		throw new Error('Invalid message signature');
	}

	//check message type
	if (buf.readUInt32LE(NTLMSIGNATURE.length) !== 2) {
		throw new Error('Invalid message type (no type 2)');
	}

	//read flags
	obj.flags = buf.readUInt32LE(20);

	obj.encoding = (obj.flags & flags.NTLMFLAG_NEGOTIATE_OEM) ? 'ascii' : 'ucs2';

	obj.version = (obj.flags & flags.NTLMFLAG_NEGOTIATE_NTLM2_KEY) ? 2 : 1;

	obj.challenge = buf.slice(24, 32);

	//read target name
	obj.targetName = (function(){
		let length = buf.readUInt16LE(12);
		//skipping allocated space
		let offset = buf.readUInt32LE(16);

		if (length === 0) {
			return '';
		}

		if ((offset + length) > buf.length || offset < 32) {
			throw new Error('Bad type 2 message');
		}

		return buf.toString(obj.encoding, offset, offset + length);
	})();

	//read target info
	if (obj.flags & flags.NTLMFLAG_NEGOTIATE_TARGET_INFO) {
		obj.targetInfo = (function(){
			let info = {};

			let length = buf.readUInt16LE(40);
			//skipping allocated space
			let offset = buf.readUInt32LE(44);

			let targetInfoBuffer = Buffer.alloc(length);
			buf.copy(targetInfoBuffer, 0, offset, offset + length);

			if (length === 0) {
				return info;
			}

			if ((offset + length) > buf.length || offset < 32) {
				throw new Error('Bad type 2 message');
			}

			let pos = offset;

			while (pos < (offset + length)) {
				let blockType = buf.readUInt16LE(pos);
				pos += 2;
				let blockLength = buf.readUInt16LE(pos);
				pos += 2;

				if (blockType === 0) {
					//reached the terminator subblock
					break;
				}

        let blockTypeStr;
        let blockTypeOutput = 'string';

				switch (blockType) {
					case 0x01:
						blockTypeStr = 'SERVER';
						break;
					case 0x02:
						blockTypeStr = 'DOMAIN';
						break;
					case 0x03:
						blockTypeStr = 'FQDN';
						break;
					case 0x04:
						blockTypeStr = 'DNS';
						break;
					case 0x05:
						blockTypeStr = 'PARENT_DNS';
						break;
          case 0x06:
            blockTypeStr = 'FLAGS';
            blockTypeOutput = 'hex';
            break;
          case 0x07:
            blockTypeStr = 'SERVER_TIMESTAMP';
            blockTypeOutput = 'hex';
            break;
          case 0x08:
            blockTypeStr = 'SINGLE_HOST';
            blockTypeOutput = 'hex';
            break;
          case 0x09:
            blockTypeStr = 'TARGET_NAME';
            break;
          case 0x0A:
            blockTypeStr = 'CHANNEL_BINDING';
            blockTypeOutput = 'hex';
            break;
          default:
						blockTypeStr = '';
						break;
				}

				if (blockTypeStr) {
          if (blockTypeOutput === 'string') {
            info[blockTypeStr] = buf.toString('ucs2', pos, pos + blockLength);
          } else {
            // Output as hex in little endian order
            info[blockTypeStr] = buf.toString('hex', pos, pos + blockLength).match(/.{2}/g).reverse().join("");
          }
				}

				pos += blockLength;
			}

			return {
				parsed: info,
				buffer: targetInfoBuffer
			};
		})();
	}

	return obj;
}

function createType3Message(type2Message, username, password, workstation, target, client_nonce, timestamp) {
	let dataPos = 72;
  let buf = Buffer.alloc(1024);

	if (workstation === undefined) {
		workstation = os.hostname();
	}

	if (target === undefined) {
		target = type2Message.targetName;
	}

	//signature
	buf.write(NTLMSIGNATURE, 0, NTLMSIGNATURE.length, 'ascii');

	//message type
	buf.writeUInt32LE(3, 8);

  let targetLen = type2Message.encoding === 'ascii' ? target.length : target.length * 2;
  let usernameLen = type2Message.encoding === 'ascii' ? username.length : username.length * 2;
  let workstationLen = type2Message.encoding === 'ascii' ? workstation.length : workstation.length * 2;
  let dataPosOffset = targetLen + usernameLen + workstationLen;
  let withMic = false;
  let withServerTimestamp = false;
  if (type2Message.version === 2 &&
      type2Message.targetInfo &&
      type2Message.targetInfo.parsed['SERVER_TIMESTAMP']) { // Must include MIC, add room for it
    withServerTimestamp = true;
    withMic = true;
    dataPos += 16;
  }
  let hashDataPos = dataPos + dataPosOffset;
  let ntlmHash = hash.createNTLMHash(password);

	if (type2Message.version === 2) {
    client_nonce = client_nonce || hash.createPseudoRandomValue(16);
    if (withServerTimestamp) { // Use server timestamp if provided
      timestamp = type2Message.targetInfo.parsed['SERVER_TIMESTAMP'];
    } else {
      timestamp = timestamp || hash.createTimestamp();
    }

    let	lmv2;
    if (withServerTimestamp) {
      lmv2 = Buffer.alloc(24); // zero-filled
    } else {
      lmv2 = hash.createLMv2Response(type2Message, username, target, ntlmHash, client_nonce);
    }

		//lmv2 security buffer
		buf.writeUInt16LE(lmv2.length, 12);
		buf.writeUInt16LE(lmv2.length, 14);
		buf.writeUInt32LE(hashDataPos, 16);

		lmv2.copy(buf, hashDataPos);
		hashDataPos += lmv2.length;

		let	ntlmv2 = hash.createNTLMv2Response(type2Message, username, target, ntlmHash, client_nonce, timestamp, withMic);

    //ntlmv2 security buffer
		buf.writeUInt16LE(ntlmv2.length, 20);
		buf.writeUInt16LE(ntlmv2.length, 22);
		buf.writeUInt32LE(hashDataPos, 24);

		ntlmv2.copy(buf, hashDataPos);
		hashDataPos += ntlmv2.length;
	} else {
		let lmHash = hash.createLMHash(password);
		let	lm = hash.createLMResponse(type2Message.challenge, lmHash);
		let	ntlm = hash.createNTLMResponse(type2Message.challenge, ntlmHash);

		//lm security buffer
		buf.writeUInt16LE(lm.length, 12);
		buf.writeUInt16LE(lm.length, 14);
		buf.writeUInt32LE(hashDataPos, 16);

		lm.copy(buf, hashDataPos);
		hashDataPos += lm.length;

		//ntlm security buffer
		buf.writeUInt16LE(ntlm.length, 20);
		buf.writeUInt16LE(ntlm.length, 22);
		buf.writeUInt32LE(hashDataPos, 24);

		ntlm.copy(buf, hashDataPos);
		hashDataPos += ntlm.length;
  }

	//target name security buffer
	buf.writeUInt16LE(targetLen, 28);
	buf.writeUInt16LE(targetLen, 30);
	buf.writeUInt32LE(dataPos, 32);

	dataPos += buf.write(target, dataPos, type2Message.encoding);

	//user name security buffer
	buf.writeUInt16LE(usernameLen, 36);
	buf.writeUInt16LE(usernameLen, 38);
	buf.writeUInt32LE(dataPos, 40);

	dataPos += buf.write(username, dataPos, type2Message.encoding);

	//workstation name security buffer
	buf.writeUInt16LE(workstationLen, 44);
	buf.writeUInt16LE(workstationLen, 46);
	buf.writeUInt32LE(dataPos, 48);

	dataPos += buf.write(workstation, dataPos, type2Message.encoding);

  //session key security buffer
  buf.writeUInt16LE(0, 52);
  buf.writeUInt16LE(0, 54);
  buf.writeUInt32LE(hashDataPos, 56);

  //flags
  buf.writeUInt32LE(type2Message.flags, 60);

  addVersionStruct(buf, 64);

  if (withMic) {
    // Calculate and add MIC
    let t1 = createType1MessageRaw(type2Message.version, workstation, target);
    let mic = hash.createMIC(t1, type2Message, buf.slice(0, hashDataPos), username, target, ntlmHash, client_nonce, timestamp);
    mic.copy(buf, 72);
  }

	return 'NTLM ' + buf.toString('base64', 0, hashDataPos);
}

module.exports = {
	createType1Message,
	decodeType2Message,
	createType3Message
};
