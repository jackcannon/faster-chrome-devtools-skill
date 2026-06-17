import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cli = resolve('scripts/cdp.mjs');

function encodeFrame(text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const masked = Boolean(buffer[1] & 0x80);
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { opcode: buffer[0] & 0x0f, text: payload.toString(), bytes: offset + length };
}

let browserServer;
let endpoint;
const seenMethods = [];

before(async () => {
  browserServer = http.createServer();
  browserServer.on('upgrade', (request, socket) => {
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Connection: Upgrade',
      'Upgrade: websocket',
      `Sec-WebSocket-Accept: ${accept}`,
      '', '',
    ].join('\r\n'));

    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const frame = decodeFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.bytes);
        if (frame.opcode === 0x8) {
          socket.end(Buffer.from([0x88, 0x00]));
          return;
        }
        if (frame.opcode !== 0x1) continue;
        const request = JSON.parse(frame.text);
        seenMethods.push(request.method);
        let result = {};
        if (request.method === 'Target.getTargets') {
          result = {
            targetInfos: [{
              targetId: 'ABCDEF0123456789',
              type: 'page',
              title: 'Mock Browser Page',
              url: 'https://example.test/',
            }],
          };
        } else if (request.method === 'Target.attachToTarget') {
          result = { sessionId: 'mock-session' };
        } else if (request.method === 'Accessibility.getFullAXTree') {
          result = {
            nodes: [{
              nodeId: '1',
              role: { value: 'button' },
              name: { value: 'Submit' },
              backendDOMNodeId: 42,
            }],
          };
        } else if (request.method === 'DOM.getBoxModel') {
          result = { model: { border: [10, 20, 30, 20, 30, 40, 10, 40] } };
        }
        const response = { id: request.id, result };
        if (request.sessionId) response.sessionId = request.sessionId;
        socket.write(encodeFrame(JSON.stringify(response)));
      }
    });
  });
  await new Promise(resolveListen => browserServer.listen(0, '127.0.0.1', resolveListen));
  endpoint = `ws://127.0.0.1:${browserServer.address().port}/devtools/browser/mock`;
});

after(async () => {
  try { await execFileAsync(process.execPath, [cli, '--ws-endpoint', endpoint, 'stop']); } catch {}
  await new Promise(resolveClose => browserServer.close(resolveClose));
});

test('CLI connects directly, lists targets, and reuses its daemon', async () => {
  const first = await execFileAsync(process.execPath, [cli, '--ws-endpoint', endpoint, 'list']);
  assert.match(first.stdout, /^ABCDEF01\s+Mock Browser Page/m);

  const second = await execFileAsync(process.execPath, [cli, '--ws-endpoint', endpoint, 'list']);
  assert.equal(second.stdout, first.stdout);

  const snapshot = await execFileAsync(process.execPath, [
    cli, '--ws-endpoint', endpoint, 'snapshot', 'ABCDEF01',
  ]);
  assert.match(snapshot.stdout, /\[button ref=42\] "Submit"/);

  const click = await execFileAsync(process.execPath, [
    cli, '--ws-endpoint', endpoint, 'click', 'ABCDEF01', 'ref:42',
  ]);
  assert.match(click.stdout, /Clicked element at \(20, 30\)/);
  assert.equal(seenMethods.filter(method => method === 'Target.attachToTarget').length, 1);
  assert.equal(seenMethods.filter(method => method === 'Input.dispatchMouseEvent').length, 3);
});
