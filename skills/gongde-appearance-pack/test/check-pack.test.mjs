// Guards for the creator-facing checker in creator-kit/check-pack.mjs.
//
// Every case here is a real defect this checker exists to catch. If one of
// these stops failing, the checker has quietly stopped protecting creators.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { check as inspect, animationEnvelope, sample, measureLayout } from '../../creator-kit/check-pack.mjs';
const check = target => inspect(target, { mode: 'submission' });

// ---- a tiny PNG writer, so fixtures stay readable

const crcTable = Uint32Array.from({ length: 256 }, (_, input) => {
  let value = input;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, body.length + 8)), body.length + 8);
  return out;
}
/** `ink` is a predicate over (x, y) in a width×height image. */
function png(width, height, ink) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = ink(x, y) ?? [0, 0, 0, 0];
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b; raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const square = (color) => (x, y) => (x >= 200 && x < 400 && y >= 200 && y < 400 ? color : [0, 0, 0, 0]);
const full = () => [200, 120, 40, 255];

function fixture(manifest, images) {
  const files = new Map();
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  for (const [name, data] of Object.entries(images)) files.set(name, data);
  return files;
}

const baseManifest = (over = {}) => ({
  schema_version: 1,
  id: 'creator.template',
  version: '1.0.0',
  name_zh: '测试形象',
  name_en: 'Test Figure',
  author: 'tester',
  publisher: 'community',
  review_id: 'pending',
  canvas_width: 240,
  canvas_height: 250,
  preview: 'preview.png',
  plus_y: 174,
  layers: [{
    image: 'body.png', frame: [35, 0, 170, 170], anchor: [0.5, 0.5],
    keyframes: [{ t: 0, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 }],
  }],
  ...over,
});

/** Build a files map whose preview is a faithful render of keyframe 0. */
function withPreview(manifest, images) {
  // preview is 240x170; a body of full ink at [35,0,170,170] fills x=35..205.
  const preview = png(240, 170, (x, y) => (x >= 35 && x < 205 ? [200, 120, 40, 255] : [0, 0, 0, 0]));
  return fixture(manifest, { ...images, 'preview.png': preview });
}

test('a minimal valid pack passes', () => {
  const manifest = baseManifest();
  const result = check(withPreview(manifest, { 'body.png': png(600, 600, full) }));
  assert.equal(result.ok, true, result.lines.join('\n'));
});

test('id prefix must match publisher', () => {
  const manifest = baseManifest({ id: 'official.bad', publisher: 'official' });
  const result = check(withPreview(manifest, { 'body.png': png(600, 600, full) }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /community/u);
});

test('a license field is rejected', () => {
  const manifest = baseManifest({ license: { kind: 'free' } });
  const result = check(withPreview(manifest, { 'body.png': png(600, 600, full) }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /license/u);
});

test('schema 1 frames may not leave the artwork band', () => {
  const manifest = baseManifest();
  manifest.layers[0].frame = [35, -10, 170, 170];
  const result = check(withPreview(manifest, { 'body.png': png(600, 600, full) }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /形象区/u);
});

test('an animation that drifts above y=170 is caught', () => {
  // static frame is legal, but the second keyframe lifts it past the band
  const manifest = baseManifest();
  manifest.layers[0].keyframes = [
    { t: 0, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 },
    { t: 0.5, x: 0, y: 20, rotation: 0, scale: 1, alpha: 1 },
    { t: 1, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 },
  ];
  const result = check(withPreview(manifest, { 'body.png': png(600, 600, full) }));
  assert.equal(result.ok, true, 'visual sampling is advisory, not a format gate');
  assert.match(result.lines.join('\n'), /超出形象区/u);
});

test('a sub-2px overshoot is a note, not a failure', () => {
  const manifest = baseManifest();
  manifest.layers[0].keyframes = [
    { t: 0, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 },
    { t: 0.5, x: 0, y: 1, rotation: 0, scale: 1, alpha: 1 },
    { t: 1, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 },
  ];
  const result = check(withPreview(manifest, { 'body.png': png(600, 600, full) }));
  assert.equal(result.ok, true, result.lines.join('\n'));
});

test('a stale preview produces a visual warning', () => {
  const manifest = baseManifest();
  const stale = png(240, 170, (x) => (x < 100 ? [200, 120, 40, 255] : [0, 0, 0, 0]));
  const result = check(fixture(manifest, { 'body.png': png(600, 600, full), 'preview.png': stale }));
  assert.equal(result.ok, true);
  assert.match(result.lines.join('\n'), /preview 与第 0 帧合成对不上/u);
});

test('an unreferenced file is rejected', () => {
  const manifest = baseManifest();
  const result = check(fixture(manifest, {
    'body.png': png(600, 600, full),
    'preview.png': png(240, 170, (x) => (x >= 35 && x < 205 ? [200, 120, 40, 255] : [0, 0, 0, 0])),
    'extra.png': png(10, 10, full),
  }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /未被引用/u);
});

test('two commonly named body layers are allowed', () => {
  const manifest = baseManifest();
  manifest.layers.push({ ...manifest.layers[0], image: 'base.png' });
  const result = check(withPreview(manifest, {
    'body.png': png(600, 600, full), 'base.png': png(600, 600, square([200, 120, 40, 255])),
  }));
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.match(result.lines.join('\n'), /名称不决定角色/u);
});

test('keyframe t must start at 0 and end at 1', () => {
  const manifest = baseManifest();
  manifest.layers[0].keyframes = [
    { t: 0.1, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 },
    { t: 1, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 },
  ];
  const result = check(withPreview(manifest, { 'body.png': png(600, 600, full) }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /首帧固定 t=0/u);
});

test('a PNG that is not 8-bit RGBA is rejected with a readable reason', () => {
  const manifest = baseManifest();
  // Rebuild a real 16-bit PNG: IHDR with bitDepth=16 and a matching checksum,
  // so the failure is the format itself, not a corrupt file.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 16;   // bit depth
  ihdr[9] = 6;    // RGBA
  const sixteenBit = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(8 * 8 * 8 + 8))),
    chunk('IEND', Buffer.alloc(0))]);
  const files = fixture(manifest, {
    'body.png': sixteenBit,
    'preview.png': png(240, 170, () => [0, 0, 0, 0]),
  });
  const result = check(files);
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /16-bit/u);
});

test('an uppercase filename is rejected', () => {
  const manifest = baseManifest();
  manifest.layers[0].image = 'Body.png';
  const result = check(withPreview(manifest, { 'Body.png': png(600, 600, full) }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /小写 PNG/u);
});

test('the checker reports rather than throws on a broken manifest', () => {
  const result = check(fixture({ schema_version: 1 }, {}));
  assert.equal(result.ok, false);
  assert.ok(result.lines.length > 0);
});


test('local DIY is accepted while unsigned platform identities are refused', () => {
  const local = baseManifest({ id: 'diy.tester.cat', publisher: 'tester', review_id: 'local' });
  assert.equal(inspect(withPreview(local, { 'body.png': png(60, 60, full) })).ok, true);
  assert.equal(inspect(withPreview(baseManifest(), { 'body.png': png(60, 60, full) })).ok, false);
});

test('constant rest offset is not animation movement', () => {
  const m = baseManifest();
  m.layers[0].frame = [35, 30, 140, 140];
  m.layers[0].keyframes = [{ t: 0, x: 0, y: -29, rotation: 0, scale: 1, alpha: 1 },
    { t: 1, x: 0, y: -29, rotation: 0, scale: 1, alpha: 1 }];
  const r = check(withPreview(m, { 'body.png': png(60, 60, full) }));
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.ok(!r.lines.some(x => x.includes('存在相对静止姿态的变化')));
});

test('nonuniform scale is applied before rotation', () => {
  const layer = { frame: [0, 0, 10, 20], anchor: [0, 0],
    keyframes: [{ t: 0, x: 0, y: 0, rotation: 90, scale: 2, scale_y: 0.5, alpha: 1 }] };
  const box = animationEnvelope(layer, { width: 10, height: 20 }, [[10, 0]]);
  assert.ok(Math.abs(box.minX + 20) < 1e-8);
  assert.ok(Math.abs(box.maxY - 20) < 1e-8);
});

test('short keyframe peak is included and smoothstep matches the selected curve', () => {
  const frames = [{ t: 0, x: 0 }, { t: 0.50001, x: 400 }, { t: 0.50002, x: 0 }, { t: 1, x: 0 }];
  const layer = { frame: [0, 0, 1, 1], anchor: [0, 0], keyframes: frames };
  assert.ok(animationEnvelope(layer, { width: 1, height: 1 }, [[0, 1]]).maxX >= 400);
  const curve = [{ t: 0, x: 0 }, { t: 1, x: 100 }];
  assert.equal(sample(curve, 0.25, 'smoothstep').x, 15.625);
});

test('invalid list entries, tuples and float-collapsed timestamps are rejected without throwing', () => {
  for (const layers of [[null], [{ ...baseManifest().layers[0], keyframes: [null] }],
    [{ ...baseManifest().layers[0], anchor: [0, 0, 9] }],
    [{ ...baseManifest().layers[0], keyframes: [0, 0.5, 0.5000000001].map(t => ({ t, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 })) }]]) {
    const result = check(fixture(baseManifest({ layers }), { 'body.png': png(2, 2, full), 'preview.png': png(2, 2, full) }));
    assert.equal(result.ok, false);
  }
});

test('standalone preview PNG is validated, not silently skipped', () => {
  const result = check(fixture(baseManifest(), { 'body.png': png(2, 2, full), 'preview.png': Buffer.from('broken') }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /preview.png.*图片无效/u);
});


test('deflated ZIP uses compressed lengths and rejects corrupted entries', async t => {
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../../services/gongde-payments/package.json', import.meta.url));
  const { zipSync } = require('fflate');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'gongde-checker-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const m = baseManifest({ id: 'diy.tester.cat', publisher: 'tester', review_id: 'local' });
  const files = withPreview(m, { 'body.png': png(60, 60, full) });
  const zip = Buffer.from(zipSync(Object.fromEntries(files), { level: 6 }));
  const file = join(dir, 'pack.nmgpack');
  writeFileSync(file, zip);
  assert.equal(inspect(file).ok, true);
  const damaged = Buffer.from(zip);
  damaged[14] ^= 1; // local CRC no longer matches directory
  writeFileSync(file, damaged);
  assert.throws(() => inspect(file), /本地头与目录不一致/u);
});


test('layout measures ink rather than transparent PNG borders and ignores invisible layers', () => {
  const layer = { image: 'part.png', frame: [0, 0, 240, 170], anchor: [0, 0],
    keyframes: [{ t: 0, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 }] };
  const images = new Map([['part.png', { width: 240, height: 170 }]]);
  const hull = new Map([['part.png', [[40, 30], [200, 30], [40, 160], [200, 160]]]]);
  const invisible = { ...layer, keyframes: [{ ...layer.keyframes[0], x: 500, alpha: 0 }] };
  const r = measureLayout({ layers: [layer, invisible] }, images, hull);
  for (const [key, expected] of Object.entries({ minX: 40, maxX: 200, minY: 10, maxY: 140 })) {
    assert.ok(Math.abs(r.restBounds[key] - expected) < 1e-8, key);
  }
  assert.equal(r.restCenterX, 120);
  assert.equal(r.withinNewWorkSafeArea, true);
});

test('layout checks the moving hand at its peak, not just the static body', () => {
  const frame = { t: 0, x: 0, y: 0, rotation: 0, scale: 1, alpha: 1 };
  const layer = { image: 'hand.png', frame: [0, 0, 240, 170], anchor: [0, 0],
    keyframes: [frame, { ...frame, t: 0.40001, y: 40 }, { ...frame, t: 1 }] };
  const images = new Map([['hand.png', { width: 240, height: 170 }]]);
  const r = measureLayout({ layers: [layer] }, images, new Map([['hand.png', [[40, 30], [200, 160]]]]));
  assert.equal(r.restBounds.maxY, 140);
  assert.equal(r.sampledBounds.maxY, 180);
  assert.equal(r.withinHardBounds, false);
  assert.equal(r.sampledMargins.top, -10);
});

test('layout distinguishes reserved safety margin from actual clipping without rejecting old packages', () => {
  const r = check(withPreview(baseManifest(), { 'body.png': png(60, 60, full) }));
  assert.equal(r.ok, true);
  assert.equal(r.payload.layout.withinHardBounds, true);
  assert.equal(r.payload.layout.withinNewWorkSafeArea, false);
  assert.ok(r.lines.some(line => line.includes('进入新作安全留白')));
});


test('portable local labels are byte-bounded and IDs obey the Windows edge-dot rule', () => {
  const m=baseManifest({id:'diy.author.cat',publisher:'作者',review_id:'local'});
  const images={'body.png':png(60,60,full)};
  assert.equal(inspect(withPreview(m,images)).ok,true);
  for(const patch of [{author:'字'.repeat(50)},{publisher:'bad\nname'},{id:'.diy.cat'},{id:'diy.cat.'}]) {
    assert.equal(inspect(withPreview({...m,...patch},images)).ok,false);
  }
});
