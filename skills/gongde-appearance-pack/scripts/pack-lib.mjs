import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type), head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([head, t, data, tail]);
}
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    .copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Stored ZIP: deterministic, no extra fields, paths, comments or data descriptors.
export function zipFiles(files) {
  const locals = [], central = []; let offset = 0;
  for (const [name, value] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const data = Buffer.from(value), n = Buffer.from(name, 'ascii'), crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20,4);
    l.writeUInt16LE(0x5021,12); l.writeUInt32LE(crc,14); l.writeUInt32LE(data.length,18);
    l.writeUInt32LE(data.length,22); l.writeUInt16LE(n.length,26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6);
    c.writeUInt16LE(0x5021,14); c.writeUInt32LE(crc,16); c.writeUInt32LE(data.length,20);
    c.writeUInt32LE(data.length,24); c.writeUInt16LE(n.length,28); c.writeUInt32LE(offset,42);
    locals.push(l,n,data); central.push(c,n); offset += l.length+n.length+data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size,8); end.writeUInt16LE(files.size,10);
  end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals, directory, end]);
}
export function readDeclared(directory, manifest) {
  return new Map(['manifest.json', manifest.preview, ...manifest.layers.map(l => l.image)]
    .filter((name, i, names) => names.indexOf(name) === i)
    .map(name => [name, readFileSync(join(directory, name))]));
}
