// Creator-facing pack checker.
//
// The platform's own gate lives in services/gongde-payments/src/creators/.
// Local authoring diagnostics, with separate source/submission modes.
// This is not the platform identity gate, signature verifier or native renderer.
//
// It deliberately reports *reasons*, not error codes: the audience is a person
// (or an agent acting for one) fixing their own artwork, not a service log.

import { createHash } from 'node:crypto';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Mirrors CREATOR_UPLOAD_LIMITS in services/gongde-payments/src/creators/policy.ts.
export const LIMITS = Object.freeze({
  archiveBytes: 8 * 1024 * 1024,
  unpackedBytes: 12 * 1024 * 1024,
  manifestBytes: 64 * 1024,
  files: 8,
  imageDimension: 2048,
  decodedImageBytes: 64 * 1024 * 1024,
  layers: 6,
  keyframesPerLayer: 8,
});

const CANVAS = Object.freeze({ width: 240, height: 250, plusY: 174, artworkTop: 170 });
const PNG_NAME = /^[a-z0-9][a-z0-9_-]{0,59}\.png$/u;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ROOT_KEYS = ['schema_version', 'id', 'version', 'name_zh', 'name_en', 'author', 'publisher',
  'review_id', 'canvas_width', 'canvas_height', 'preview', 'plus_y', 'layers'];
const LAYER_KEYS_S1 = ['image', 'frame', 'anchor', 'keyframes'];
const LAYER_KEYS_S3 = ['image', 'frame', 'anchor', 'keyframes', 'interpolation'];
const FRAME_KEYS_S1 = ['t', 'x', 'y', 'rotation', 'scale', 'alpha'];
const FRAME_KEYS_S3 = ['t', 'x', 'y', 'rotation', 'scale', 'scale_y', 'alpha'];
const PUBLISHER_FOR_PREFIX = Object.freeze({
  official: 'NiuMa Merit',
  zqscreen: 'zqscreen',
  creator: 'community',
});
// Conventional names only; names do not determine motion permissions.
const BASE_NAMES = new Set(['body', 'base', 'habitat', 'bead']);

// ---------------------------------------------------------------- PNG

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

/** Decode an 8-bit RGB/RGBA non-interlaced PNG into raw pixels. */
export function decodePng(data) {
  if (data.length < 57 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  let cursor = 8, width = 0, height = 0, colorType = 0, channels = 0;
  const idat = [];
  const problems = [];
  let sawIdat = false, idatClosed = false, ended = false;
  while (cursor < data.length) {
    if (cursor + 12 > data.length) throw new Error('PNG is truncated');
    const size = data.readUInt32BE(cursor);
    if (cursor + 12 + size > data.length) throw new Error('PNG is truncated');
    const typeBytes = data.subarray(cursor + 4, cursor + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/u.test(type) || (typeBytes[2] & 32) !== 0) {
      throw new Error(`PNG has a malformed chunk (${type})`);
    }
    const chunk = data.subarray(cursor + 8, cursor + 8 + size);
    if (crc32(data.subarray(cursor + 4, cursor + 8 + size)) !== data.readUInt32BE(cursor + 8 + size)) {
      throw new Error(`PNG chunk ${type} failed its checksum (file is corrupt)`);
    }
    if (cursor === 8 && type !== 'IHDR') throw new Error('PNG does not start with IHDR');
    if (type === 'IHDR') {
      if (cursor !== 8 || size !== 13) throw new Error('PNG header is malformed');
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const bitDepth = chunk[8];
      colorType = chunk[9];
      if (width < 1 || height < 1 || width > LIMITS.imageDimension || height > LIMITS.imageDimension) {
        throw new Error(`PNG is ${width}x${height}; each side must be 1-${LIMITS.imageDimension}`);
      }
      if (bitDepth !== 8) throw new Error(`PNG is ${bitDepth}-bit; export 8-bit`);
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`PNG color type is ${colorType}; export RGB (2) or RGBA (6)`);
      }
      if (chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) {
        throw new Error('PNG uses compression, filter or interlace settings the platform rejects');
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      if (idatClosed || ended) throw new Error('PNG has IDAT after other chunks');
      sawIdat = true;
      idat.push(chunk);
    } else if (type === 'IEND') {
      if (!sawIdat || size !== 0) throw new Error('PNG ends without image data');
      ended = true;
    } else {
      if (sawIdat) idatClosed = true;
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
        throw new Error('PNG is animated (APNG); export a single frame');
      }
      if ((typeBytes[0] & 32) === 0) { problems.push(type); }
    }
    cursor += size + 12;
  }
  if (!ended || idat.length === 0) throw new Error('PNG is truncated or has no image data');
  if (problems.length) {
    throw new Error(`PNG has chunks the platform does not allow: ${problems.join(', ')}`);
  }
  const rowBytes = width * channels + 1;
  const expected = rowBytes * height;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch {
    throw new Error('PNG image data could not be decompressed');
  }
  if (raw.length !== expected) throw new Error('PNG image data has the wrong size');
  for (let row = 0; row < height; row += 1) {
    if (raw[row * rowBytes] > 4) throw new Error('PNG uses an unknown scanline filter');
  }
  return { width, height, channels, pixels: unfilter(raw, width, height, channels) };
}

function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride);
    const current = Buffer.from(line);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upperLeft = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) current[i] = (current[i] + left) & 255;
      else if (filter === 2) current[i] = (current[i] + up) & 255;
      else if (filter === 3) current[i] = (current[i] + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        const predictor = pa <= pb && pa <= pc ? left : (pb <= pc ? up : upperLeft);
        current[i] = (current[i] + predictor) & 255;
      }
    }
    current.copy(out, row * stride);
    previous = current;
  }
  return out;
}

// ---------------------------------------------------------------- geometry

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : NaN);

export function sample(frames, phase, interpolation = 'linear') {
  if (phase <= frames[0].t) return frames[0];
  const last = frames[frames.length - 1];
  if (phase >= last.t) return last;
  for (let index = 1; index < frames.length; index += 1) {
    const right = frames[index];
    if (phase > right.t) continue;
    const left = frames[index - 1];
    const span = right.t - left.t;
    let mix = span > 0 ? (phase - left.t) / span : 0;
    if (interpolation === 'smoothstep') mix = mix * mix * (3 - 2 * mix);
    const at = (key, fallback) => {
      const a = left[key] ?? fallback, b = right[key] ?? fallback;
      return a + (b - a) * mix;
    };
    return { x: at('x', 0), y: at('y', 0), rotation: at('rotation', 0),
      scale: at('scale', 1), scale_y: at('scale_y', 1), alpha: at('alpha', 1) };
  }
  return last;
}

/**
 * Convex hull of a PNG's opaque pixels, in image space.
 *
 * A rotation+scale is affine, so the bounding box of a transformed shape is
 * determined by its convex hull alone — transforming the hull is both exact
 * and ~1000x cheaper than transforming every pixel.
 */
export function opaqueHull(image) {
  const points = [];
  const stride = image.channels * image.width;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = y * stride + x * image.channels;
      const alpha = image.channels === 4 ? image.pixels[offset + 3] : 255;
      if (alpha !== 0) points.push([x + 0.5, y + 0.5]);
    }
  }
  if (points.length === 0) return [];
  points.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Ink extent of every layer across the whole animation, in canvas coordinates.
 *
 * The app clips every pack to y=0..170 before drawing (app.mm:598), so a pose
 * that drifts above it renders as a cut-off drawing. Nothing else in the
 * pipeline checks this: the manifest validator only looks at the static
 * `frame` rect, not at where the keyframes actually travel.
 */
export function animationEnvelope(layer, image, hull = opaqueHull(image)) {
  if (hull.length === 0) return null;
  const [fx, fy, fw, fh] = layer.frame;
  const anchorX = fx + fw * layer.anchor[0];
  const anchorY = fy + fh * layer.anchor[1];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  // Visual diagnostic, not a continuous bound: include exact keyframes as well as samples.
  const steps = 96;
  const phases = new Set([...layer.keyframes.map(frame => frame.t),
    ...Array.from({ length: steps + 1 }, (_, step) => step / steps)]);
  for (const phase of phases) {
    const frame = sample(layer.keyframes, phase, layer.interpolation);
    if ((frame.alpha ?? 1) <= 0) continue;
    const radians = ((frame.rotation ?? 0) * Math.PI) / 180;
    const sx = frame.scale ?? 1;
    const sy = (frame.scale ?? 1) * (frame.scale_y ?? 1);
    const cos = Math.cos(radians), sin = Math.sin(radians);
    for (const [px, py] of hull) {
      const u = px / image.width;
      const v = 1 - py / image.height;
      const lx = u * fw - fw * layer.anchor[0];
      const ly = v * fh - fh * layer.anchor[1];
      const x = anchorX + (frame.x ?? 0) + lx * sx * cos - ly * sy * sin;
      const y = anchorY + (frame.y ?? 0) + lx * sx * sin + ly * sy * cos;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minY, maxY };
}

/** Rest-pose ink extent (keyframe 0 only) — what preview.png should show. */
export function restExtent(layer, image, hull) {
  return animationEnvelope({ ...layer, keyframes: [layer.keyframes[0]] }, image, hull);
}

// Visual authoring profile only. This must never become an import gate.
export const VISUAL_LAYOUT = Object.freeze({
  version: '2026-10-27',
  hard: Object.freeze({ minX: 0, maxX: 240, minY: 0, maxY: 170 }),
  safe: Object.freeze({ minX: 8, maxX: 232, minY: 4, maxY: 162 }),
});

/** All-layer visible bounds, not automatic semantic subject recognition.
 * Pixel centres and keyframe+96 phase samples are approximate diagnostics.
 * Fully transparent layers/images contribute no extent. Faint edges are kept
 * conservatively; this does not certify every continuous pose or visual weight.
 */
export function measureLayout(manifest, images, hulls = new Map()) {
  const merge = (a, b) => !b ? a : !a ? { ...b } : ({
    minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY),
  });
  let restBounds = null, sampledBounds = null;
  for (const layer of manifest.layers) {
    const image = images.get(layer.image);
    if (!image) continue;
    if (!hulls.has(layer.image)) hulls.set(layer.image, opaqueHull(image));
    const hull = hulls.get(layer.image);
    restBounds = merge(restBounds, restExtent(layer, image, hull));
    sampledBounds = merge(sampledBounds, animationEnvelope(layer, image, hull));
  }
  const fits = (box, region) => !box || (box.minX >= region.minX && box.maxX <= region.maxX
    && box.minY >= region.minY && box.maxY <= region.maxY);
  return {
    profile: VISUAL_LAYOUT.version,
    method: 'pixel-centres; exact-keyframes+96-uniform-phases; advisory',
    restBounds, sampledBounds,
    restCenterX: restBounds ? (restBounds.minX + restBounds.maxX) / 2 : null,
    // This is the lowest visible pixel, not an inferred foot/contact point.
    restLowestY: restBounds?.minY ?? null,
    sampledMargins: sampledBounds ? { left: sampledBounds.minX, right: 240 - sampledBounds.maxX,
      bottom: sampledBounds.minY, top: 170 - sampledBounds.maxY } : null,
    withinHardBounds: fits(sampledBounds, VISUAL_LAYOUT.hard),
    withinNewWorkSafeArea: fits(sampledBounds, VISUAL_LAYOUT.safe),
  };
}

// ---------------------------------------------------------------- manifest

/**
 * @returns {{errors: string[], warnings: string[], info: string[]}}
 */
export function validateManifest(manifest, files, mode = 'local') {
  const errors = [], warnings = [], info = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { errors: ['manifest 必须是对象'], warnings, info };
  }

  for (const key of ROOT_KEYS) {
    if (!(key in manifest)) errors.push(`manifest 缺少字段 \`${key}\``);
  }
  for (const key of Object.keys(manifest)) {
    if (!ROOT_KEYS.includes(key)) {
      errors.push(`manifest 有不允许的字段 \`${key}\`（平台只接受 ${ROOT_KEYS.length} 个固定字段）`);
    }
  }
  if ('license' in manifest) {
    errors.push('manifest 里不能有 `license`——授权和价格由平台在上传时签发，写进源包会被拒收');
  }
  const schema = manifest.schema_version;
  if (schema !== 1 && schema !== 3) {
    errors.push(`schema_version 是 ${schema}，只支持 1 或 3`);
  }
  if (manifest.canvas_width !== CANVAS.width || manifest.canvas_height !== CANVAS.height) {
    errors.push(`画布必须是 ${CANVAS.width}x${CANVAS.height}，现在是 ${manifest.canvas_width}x${manifest.canvas_height}`);
  }
  if (manifest.plus_y !== CANVAS.plusY) errors.push(`plus_y 必须是 ${CANVAS.plusY}，现在是 ${manifest.plus_y}`);
  if (schema !== 3) {
    // The +1 tip region starts at plus_y; artwork above 170 is clipped away.
    info.push('提示：运行期会把图层硬裁在 y=0..170，超出的部分装了也看不见（见下面的包络检查）');
  }

  // ---- identity
  const id = typeof manifest.id === 'string' ? manifest.id : '';
  const prefix = id.split('.')[0];
  if (!/^(?!\.)(?!.*\.$)[a-z0-9.-]{3,80}$/u.test(id)) errors.push('id 必须是 3–80 位小写字母、数字、点或连字符，不能以点开头或结尾');
  if (mode === 'submission') {
    if (!/^creator\.(?:template|[a-f0-9]{32}\.[a-z0-9-]{1,32})$/u.test(id)) errors.push('投稿源包使用 creator.template 或本人绑定的作品 ID');
    if (manifest.publisher !== 'community' || manifest.review_id !== 'pending') errors.push('投稿源包必须使用 publisher=community、review_id=pending');
    info.push('投稿目前暂停；本检查不确认作者身份，不表示投稿已开放');
  } else if (mode === 'source') {
    if (prefix in PUBLISHER_FOR_PREFIX && manifest.publisher !== PUBLISHER_FOR_PREFIX[prefix]) errors.push(`保留身份发行者应为 ${PUBLISHER_FOR_PREFIX[prefix]}`);
    info.push('制作源包检查，不代表该源包可直接导入；保留身份交付仍需合法签名');
  } else if (prefix in PUBLISHER_FOR_PREFIX) {
    errors.push('本地自制包不能使用 official./zqscreen./creator. 保留身份；请使用 diy.自己的唯一标识。官方源包检查用 --source');
  }
  if (typeof manifest.version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/u.test(manifest.version)) {
    errors.push(`version \`${manifest.version}\` 不合法：字母或数字开头，只含字母数字点下划线连字符，1–32 位`);
  } else if (manifest.version !== '1.0.0') {
    info.push(`version 是 ${manifest.version}；新包建议从 1.0.0 起`);
  }
  for (const key of ['name_zh', 'name_en', 'author', 'review_id']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim() || manifest[key].length > 80) errors.push(`${key} 必须是 1–80 位非空标签`);
    else if (/[\u0000-\u001f\u007f]/u.test(manifest[key])) errors.push(`${key} 含控制字符`);
  }
  for (const key of ['name_zh', 'name_en', 'author', 'publisher', 'review_id']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim() || /[\u0000-\u001f\u007f]/u.test(manifest[key]) || Buffer.byteLength(manifest[key], 'utf8') > 128) errors.push(`${key} 必须非空且 UTF-8 不超过 128 字节（双端共同范围）`);
  }
  if (typeof manifest.name_zh === 'string') {
    if (!/^[一-鿿]+$/u.test(manifest.name_zh)) {
      warnings.push(`name_zh「${manifest.name_zh}」不是纯中文；现有 22 个包的 name_zh 都是 3–5 个纯汉字、无空格标点`);
    } else if (manifest.name_zh.length < 3 || manifest.name_zh.length > 5) {
      warnings.push(`name_zh「${manifest.name_zh}」是 ${manifest.name_zh.length} 个字；现有包都在 3–5 字之间`);
    }
  }
  if (typeof manifest.name_en === 'string' && manifest.name_en.split(/\s+/u).length > 4) {
    warnings.push(`name_en「${manifest.name_en}」词数偏多；现有包多为 2–3 个 Title Case 词`);
  }
  if (prefix === 'creator' && manifest.review_id !== 'pending') {
    info.push('社区投稿的 review_id 由平台改写，源包写 pending 即可');
  }

  // ---- files
  const preview = manifest.preview;
  if (typeof preview !== 'string' || !PNG_NAME.test(preview)) {
    errors.push(`preview \`${preview}\` 必须是小写 PNG 文件名`);
  } else if (!files.has(preview)) {
    errors.push(`preview 指向 \`${preview}\`，但包里没有这个文件`);
  }
  if (!Array.isArray(manifest.layers) || manifest.layers.length < 1) {
    errors.push('layers 必须是 1 个以上的数组');
    return { errors, warnings, info };
  }
  if (manifest.layers.length > LIMITS.layers) {
    errors.push(`图层数 ${manifest.layers.length} 超过上限 ${LIMITS.layers}`);
  }

  // ---- layers
  const declared = new Set(['manifest.json']);
  if (typeof preview === 'string') declared.add(preview);
  const usedNames = new Map();
    let baseLayers = 0;
  let sawMoving = false;

  manifest.layers.forEach((layer, index) => {
    const at = `layers[${index}]`;
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) { errors.push(`${at} 必须是对象`); return; }
    const allowed = schema === 3 ? LAYER_KEYS_S3 : LAYER_KEYS_S1;
    for (const key of allowed) if (!(key in layer)) errors.push(`${at} 缺少 \`${key}\``);
    for (const key of Object.keys(layer)) {
      if (!allowed.includes(key)) errors.push(`${at} 有多余字段 \`${key}\`（只允许 ${allowed.join('/')}）`);
    }
    if (typeof layer.image !== 'string' || !PNG_NAME.test(layer.image)) {
      errors.push(`${at}.image \`${layer.image}\` 必须是小写 PNG 文件名`);
    } else {
      declared.add(layer.image);
      usedNames.set(layer.image, (usedNames.get(layer.image) ?? 0) + 1);
    }
    if (schema === 3 && !['linear', 'smoothstep'].includes(layer.interpolation)) errors.push(`${at}.interpolation 必须是 linear 或 smoothstep`);
    const [fx, fy, fw, fh] = Array.isArray(layer.frame) ? layer.frame : [];
    if (!Array.isArray(layer.frame) || layer.frame.length !== 4 || ![fx, fy, fw, fh].every((value) => Number.isFinite(value))) {
      errors.push(`${at}.frame 必须是四个数字 [左, 下, 宽, 高]`);
    } else {
      if (fw < 1 || fh < 1 || fw > 480 || fh > 480) errors.push(`${at}.frame 的宽高必须在 1–480`);
      if (fx < -240 || fx > 480 || fy < -250 || fy > 480) errors.push(`${at}.frame 的原点超出允许范围`);
      if (schema !== 3 && (fy < 0 || fy + fh > CANVAS.artworkTop)) {
        errors.push(`${at}.frame 的 y=${fy} 高=${fh} 越出形象区 y=0..170（Schema ${schema} 不允许；要越界请用 schema 3）`);
      }
    }
    const [ax, ay] = Array.isArray(layer.anchor) ? layer.anchor : [];
    if (!Array.isArray(layer.anchor) || layer.anchor.length !== 2 || ![ax, ay].every(Number.isFinite) || !(ax >= 0 && ax <= 1 && ay >= 0 && ay <= 1)) {
      errors.push(`${at}.anchor 必须是 0–1 的两个数`);
    }
    const frames = layer.keyframes;
    if (!Array.isArray(frames) || frames.length < 1) {
      errors.push(`${at}.keyframes 至少要有 1 帧`);
      return;
    }
    if (frames.length > LIMITS.keyframesPerLayer) {
      errors.push(`${at} 有 ${frames.length} 帧，超过上限 ${LIMITS.keyframesPerLayer}`);
    }
    const frameKeys = schema === 3 ? FRAME_KEYS_S3 : FRAME_KEYS_S1;
    let previous = -1;
    frames.forEach((frame, frameIndex) => {
      const fat = `${at}.keyframes[${frameIndex}]`;
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { errors.push(`${fat} 必须是对象`); return; }
      for (const key of frameKeys) if (!(key in frame)) errors.push(`${fat} 缺少 \`${key}\``);
      for (const key of Object.keys(frame)) {
        if (!frameKeys.includes(key)) errors.push(`${fat} 有多余字段 \`${key}\``);
      }
      const t = num(frame.t);
      if (!Number.isFinite(t) || t < 0 || t > 1) errors.push(`${fat}.t 必须在 0–1`);
      else {
        if (frameIndex === 0 && t !== 0) errors.push(`${fat}.t 必须是 0（首帧固定 t=0）`);
        if (Math.fround(t) <= previous) errors.push(`${fat}.t=${t} 没有严格递增（上一帧是 ${previous}）`);
        previous = Math.fround(t);
      }
      for (const [key, low, high] of [['x', -480, 480], ['y', -480, 480],
        ['rotation', -180, 180], ['scale', 0.1, 4], ['alpha', 0, 1]]) {
        const value = num(frame[key]);
        if (!Number.isFinite(value)) errors.push(`${fat}.${key} 不是有限数字`);
        else if (value < low || value > high) errors.push(`${fat}.${key}=${value} 超出 ${low}..${high}`);
      }
      if (schema === 3) {
        const value = num(frame.scale_y);
        if (!Number.isFinite(value) || value < 0.1 || value > 4) errors.push(`${fat}.scale_y 超出 0.1..4`);
      }
    });
    if (frames.some(frame => !frame || typeof frame !== 'object' || Array.isArray(frame))) return;
    const stem = typeof layer.image === 'string' ? layer.image.replace(/\.png$/u, '') : '';
    const isBase = BASE_NAMES.has(stem);
    if (isBase) baseLayers += 1;
    const rest = frames[0];
    const defaults = { x: 0, y: 0, rotation: 0, scale: 1, scale_y: 1, alpha: 1 };
    const moves = frames.some(frame => Object.entries(defaults).some(([key, fallback]) =>
      Math.abs((frame[key] ?? fallback) - (rest[key] ?? fallback)) > 1e-9));
    if (moves) sawMoving = true;
    if (isBase && moves) info.push(`${at} \`${stem}\` 存在相对静止姿态的变化；请按实际角色检查，不根据文件名判定底座`);
    if (!isBase && frames.length === 1) {
      warnings.push(`${at} \`${stem}\` 只有 1 帧——可动部件通常写 3–7 帧；如果它不该动，名字里不该是肢体/道具`);
    }
    if (!isBase && frames.length === 2) {
      warnings.push(`${at} \`${stem}\` 有 2 帧；核对这是否足以表达预期动作`);
    }
    if (frames.length >= 3) {
      const first = frames[0];
      const last = frames[frames.length - 1];
      const differ = ['x', 'y', 'rotation', 'scale', 'alpha'].filter((key) => {
        const a = first[key] ?? (key === 'scale' ? 1 : 0);
        const b = last[key] ?? (key === 'scale' ? 1 : 0);
        return Math.abs(a - b) > 1e-9 || (schema === 3 && Math.abs((first.scale_y ?? 1) - (last.scale_y ?? 1)) > 1e-9);
      });
      if (differ.length && first.alpha !== 0) {
        warnings.push(`${at} \`${stem}\` 首末帧没有回到同一姿态（${differ.join('/')} 不一致）；只有 alpha=0 收尾的飞散粒子可以这样`);
      }
    }
  });

  if (baseLayers === 0) {
    warnings.push(`没有任何图层用底座名（${[...BASE_NAMES].join('/')}）；名称仅为制作建议`);
  } else if (baseLayers > 1) {
    info.push(`有 ${baseLayers} 个常用主体命名图层；名称不决定角色，也不限制数量`);
  }
  // duplicate image use: only legitimate for repeated particles
  for (const [name, count] of usedNames) {
    if (count < 2) continue;
    const stems = manifest.layers.filter((layer) => layer?.image === name)
      .map((layer) => name.replace(/\.png$/u, ''));
    const stem = stems[0];
    if (BASE_NAMES.has(stem)) {
      info.push(`\`${name}\` 被 ${count} 个图层复用`);
    } else {
      const phases = manifest.layers.filter((layer) => layer?.image === name)
        .map((layer) => layer.keyframes.find((frame) => Math.abs((frame.x ?? 0)) + Math.abs((frame.y ?? 0)) > 0
          || Math.abs((frame.scale ?? 1) - 1) > 1e-9)?.t ?? 0);
      const gaps = [];
      for (let i = 1; i < phases.length; i += 1) gaps.push(+(phases[i] - phases[i - 1]).toFixed(3));
      info.push(`\`${name}\` 被复用 ${count} 次（${stem}），首动作相位 ${phases.join(' / ')}${gaps.length ? `，间隔 ${gaps.join(' / ')}` : ''}`);
    }
  }

  // ---- file set
  for (const name of declared) {
    if (!files.has(name)) errors.push(`manifest 引用了 \`${name}\`，但包里没有这个文件`);
  }
  for (const name of files.keys()) {
    if (!declared.has(name)) errors.push(`包里有未被引用的文件 \`${name}\`（平台只接受 manifest 及其实际引用的 PNG）`);
  }
  if (files.size > LIMITS.files) errors.push(`文件数 ${files.size} 超过上限 ${LIMITS.files}`);
  if (!sawMoving) {
    warnings.push('所有图层相对静止姿态均无变化；静态包允许通过');
  }
  return { errors, warnings, info };
}

// ---------------------------------------------------------------- preview

/**
 * Compare `preview` with a re-composition of keyframe 0.
 *
 * Editing a keyframe without re-rendering the preview is invisible by eye and
 * is the single most common way a published thumbnail stops matching the
 * animation. Returns null when the two cannot be compared (unusual framing).
 */
export function comparePreview(manifest, files) {
  const previewName = manifest.preview;
  if (!previewName || !files.has(previewName)) return null;
  let sheet;
  try {
    sheet = decodePng(files.get(previewName));
  } catch {
    return null;
  }
  const scale = sheet.width / CANVAS.width;
  // Previews cover the artwork band (170), not the whole 250 canvas. The one
  // pack published on the full canvas is flagged rather than silently accepted.
  if (!Number.isInteger(scale) || scale < 1) return null;
  if (sheet.height !== CANVAS.artworkTop * scale && sheet.height !== CANVAS.height * scale) {
    return null;
  }
  if (sheet.height !== CANVAS.artworkTop * scale) {
    return { compared: 0, mismatched: 0, ratio: 0, scale, wrongCanvas: true };
  }
  const W = CANVAS.width, H = CANVAS.artworkTop;
  const composed = new Float32Array(W * H);
  for (const layer of manifest.layers) {
    const data = files.get(layer.image);
    if (!data) continue;
    let image;
    try {
      image = decodePng(data);
    } catch {
      continue;
    }
    const frame = layer.keyframes[0];
    if (!frame || (frame.alpha ?? 1) <= 0) continue;
    const [fx, fy, fw, fh] = layer.frame;
    const anchorX = fx + fw * layer.anchor[0];
    const anchorY = fy + fh * layer.anchor[1];
    const radians = ((frame.rotation ?? 0) * Math.PI) / 180;
    const sx = frame.scale ?? 1, sy = (frame.scale ?? 1) * (frame.scale_y ?? 1);
    const cos = Math.cos(-radians), sin = Math.sin(-radians);
    const stride = image.channels * image.width;
    for (let py = 0; py < H; py += 1) {
      const wy = (H - 1 - py) + 0.5;
      for (let px = 0; px < W; px += 1) {
        const wx = px + 0.5;
        const dx = wx - (anchorX + (frame.x ?? 0));
        const dy = wy - (anchorY + (frame.y ?? 0));
        let rx = (dx * cos - dy * sin) / sx;
        let ry = (dx * sin + dy * cos) / sy;
        rx += anchorX;
        ry += anchorY;
        const u = (rx - fx) / fw;
        const v = (fy + fh - ry) / fh;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const tx = Math.min(image.width - 1, Math.floor(u * image.width));
        const ty = Math.min(image.height - 1, Math.floor(v * image.height));
        const offset = ty * stride + tx * image.channels;
        const alpha = (image.channels === 4 ? image.pixels[offset + 3] : 255) / 255 * (frame.alpha ?? 1);
        if (alpha <= 0) continue;
        const index = py * W + px;
        composed[index] = composed[index] + alpha * (1 - composed[index]);
      }
    }
  }
  let compared = 0, mismatched = 0;
  for (let py = 0; py < H; py += 1) {
    for (let px = 0; px < W; px += 1) {
      const row = py * scale, column = px * scale;
      const offset = (row * sheet.width + column) * sheet.channels;
      const alpha = (sheet.channels === 4 ? sheet.pixels[offset + 3] : 255) / 255;
      compared += 1;
      if (Math.abs(alpha - composed[py * W + px]) > 0.5) mismatched += 1;
    }
  }
  return { compared, mismatched, ratio: compared ? mismatched / compared : 0, scale };
}

// ---------------------------------------------------------------- driver

function readDirectory(directory) {
  const files = new Map();
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (!lstatSync(path).isFile()) throw new Error(`源目录只允许普通文件，不允许目录或符号链接：${name}`);
    if (statSync(path).size > LIMITS.unpackedBytes) throw new Error(`文件超出制作预算：${name}`);
    files.set(name, readFileSync(path));
  }
  return files;
}

function readArchive(path) {
  if (statSync(path).size > LIMITS.archiveBytes) throw new Error('ZIP 超过 8 MiB');
  const archive = readFileSync(path);
  const range = (offset, size) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > archive.length) throw new Error('ZIP 截断');
    return archive.subarray(offset, offset + size);
  };
  const end = archive.length - 22;
  const eocd = range(end, 22);
  if (eocd.readUInt32LE(0) !== 0x06054b50 || eocd.readUInt16LE(20) || eocd.readUInt16LE(4) || eocd.readUInt16LE(6)) throw new Error('不支持的 ZIP 目录');
  const count = eocd.readUInt16LE(10), centralOffset = eocd.readUInt32LE(16);
  if (count < 2 || count > LIMITS.files || eocd.readUInt16LE(8) !== count || centralOffset + eocd.readUInt32LE(12) !== end) throw new Error('ZIP 文件数或目录无效');
  let cursor = centralOffset, total = 0;
  const entries = [], names = new Set();
  for (let i = 0; i < count; i++) {
    const h = range(cursor, 46);
    if (h.readUInt32LE(0) !== 0x02014b50) throw new Error('ZIP 中央目录签名无效');
    const flags = h.readUInt16LE(8), method = h.readUInt16LE(10), crc = h.readUInt32LE(16);
    const compressed = h.readUInt32LE(20), original = h.readUInt32LE(24);
    const n = h.readUInt16LE(28), extra = h.readUInt16LE(30), comment = h.readUInt16LE(32);
    const attributes = h.readUInt32LE(38), kind = (attributes >>> 16) & 0xf000;
    const nameBytes = range(cursor + 46, n), name = nameBytes.toString('ascii');
    if (nameBytes.some(v => v < 32 || v > 126) || (name !== 'manifest.json' && !PNG_NAME.test(name)) || names.has(name)) throw new Error('ZIP 文件名无效或重复');
    if ((flags & ~0x0800) || ![0, 8].includes(method) || h.readUInt16LE(34) || (attributes & 0x10) || (kind && kind !== 0x8000) || original < 1 || compressed === 0xffffffff || original === 0xffffffff) throw new Error('不支持的 ZIP 条目');
    total += original;
    if (total > LIMITS.unpackedBytes || (name === 'manifest.json' && original > LIMITS.manifestBytes)) throw new Error('ZIP 解压预算超限');
    names.add(name);
    entries.push({ name, nameBytes, flags, method, crc, compressed, original, offset: h.readUInt32LE(42) });
    cursor += 46 + n + extra + comment;
    if (cursor > end) throw new Error('ZIP 目录越界');
  }
  if (cursor !== end || !names.has('manifest.json')) throw new Error('ZIP 目录不完整');
  entries.sort((a, b) => a.offset - b.offset);
  let localEnd = 0;
  const files = new Map();
  for (const e of entries) {
    if (e.offset !== localEnd) throw new Error('ZIP 条目重叠或包含额外数据');
    const h = range(e.offset, 30), n = h.readUInt16LE(26), extra = h.readUInt16LE(28);
    if (h.readUInt32LE(0) !== 0x04034b50 || h.readUInt16LE(6) !== e.flags || h.readUInt16LE(8) !== e.method || h.readUInt32LE(14) !== e.crc || h.readUInt32LE(18) !== e.compressed || h.readUInt32LE(22) !== e.original || !range(e.offset + 30, n).equals(e.nameBytes)) throw new Error('ZIP 本地头与目录不一致');
    const start = e.offset + 30 + n + extra;
    const body = range(start, e.compressed);
    const bytes = e.method === 0 ? Buffer.from(body) : inflateRawSync(body, { maxOutputLength: e.original });
    if (bytes.length !== e.original || crc32(bytes) !== e.crc) throw new Error('ZIP 长度或 CRC 校验失败');
    localEnd = start + e.compressed;
    files.set(e.name, bytes);
  }
  if (localEnd !== centralOffset) throw new Error('ZIP 存在额外数据');
  return files;
}

/**
 * @param {string|Map<string, Buffer>} target
 *   a pack directory, a .nmgpack / .zip file, or an in-memory name→bytes map
 *   (so a skill can validate before anything is written to disk)
 * @returns {{ok: boolean, lines: string[], payload: object}}
 */
export function check(target, { mode = 'local' } = {}) {
  const lines = [];
  const isArchive = typeof target === 'string' && /\.(nmgpack|zip)$/iu.test(target);
  const files = target instanceof Map ? target : (isArchive ? readArchive(target) : readDirectory(target));
  if (!files.has('manifest.json')) {
    return { ok: false, lines: ['✗ 找不到 manifest.json（ZIP 的根目录必须是 manifest.json + 被引用的 PNG）'], payload: {} };
  }
  if (files.get('manifest.json').length > LIMITS.manifestBytes) {
    lines.push(`✗ manifest.json ${(files.get('manifest.json').length / 1024).toFixed(0)} KB 超过 ${LIMITS.manifestBytes / 1024} KB`);
  }
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get('manifest.json')));
  } catch (error) {
    return { ok: false, lines: [`✗ manifest.json 不是合法的 UTF-8 JSON：${error.message}`], payload: {} };
  }

  const { errors, warnings, info } = validateManifest(manifest, files, mode);
  if (errors.length) return { ok: false, lines: errors.map(line => `✗ ${line}`), payload: { manifest } };

  // images
  const images = new Map();
  let decodedBytes = 0;
  for (const [name, bytes] of files) {
    if (name === 'manifest.json') continue;
    try {
      const image = decodePng(bytes);
      images.set(name, image);
      decodedBytes += image.width * image.height * 4;
    } catch (error) {
      errors.push(`\`${name}\` 图片无效：${error.message}`);
    }
  }
  if (errors.length) return { ok: false, lines: errors.map(line => `✗ ${line}`), payload: { manifest } };
  if (decodedBytes > LIMITS.decodedImageBytes) {
    errors.push(`图片解码后约 ${(decodedBytes / 1048576).toFixed(0)} MB，超过 ${LIMITS.decodedImageBytes / 1048576} MB 内存预算`);
  }

  // animation envelope: the check nothing else performs
  //
  // app.mm:598 clips every pack to y=0..170 before drawing, so anything above
  // that is silently cut off. Schema 1 already forbids frames outside the band
  // statically, so an overshoot there means the animation itself drifts. Schema
  // 3 exists to allow artwork that extends past the band (lucky-cat's native
  // geometry is [5,-35,230,230]), so there it is a note, not a failure.
  // A sub-pixel overshoot is invisible (0.5% of the band); a real one is not.
  const OVERSHOOT_TOLERANCE = 2;
  const strictEnvelope = manifest.schema_version !== 3;
  const envelopeNotes = [];
  const hulls = new Map();
  for (const [index, layer] of (manifest.layers ?? []).entries()) {
    const image = images.get(layer.image);
    if (!image) continue;
    if (!hulls.has(layer.image)) hulls.set(layer.image, opaqueHull(image));
    const box = animationEnvelope(layer, image, hulls.get(layer.image));
    if (!box) continue;
    const overshoot = box.maxY - CANVAS.artworkTop;
    if (overshoot > OVERSHOOT_TOLERANCE) {
      const line = `layers[${index}] \`${layer.image}\` 的动作包络最高到 y=${box.maxY.toFixed(1)}，`
        + `超出形象区 ${overshoot.toFixed(1)}px`;
      if (strictEnvelope) {
        warnings.push(`${line}——采样提示可能被裁切，需播放器核对`);
      } else {
        envelopeNotes.push(`${line}（schema 3 允许越界，但超出的部分仍会被切掉）`);
      }
    } else if (overshoot > 0) {
      envelopeNotes.push(`layers[${index}] \`${layer.image}\` 越界 ${overshoot.toFixed(2)}px，肉眼不可见，可忽略`);
    }
    const below = -box.minY;
    if (below > OVERSHOOT_TOLERANCE) {
      envelopeNotes.push(`layers[${index}] \`${layer.image}\` 动作时有 ${below.toFixed(1)}px 落到 y<0（画布下沿以外，会被裁）`);
    }
    if (box.minX < -OVERSHOOT_TOLERANCE || box.maxX > CANVAS.width + OVERSHOOT_TOLERANCE) {
      envelopeNotes.push(`layers[${index}] \`${layer.image}\` 动作时横向到 x=${box.minX.toFixed(0)}..${box.maxX.toFixed(0)}，超出 0–${CANVAS.width}`);
    }
  }
  warnings.push(...envelopeNotes);
  const layout = measureLayout(manifest, images, hulls);
  const describe = box => box ? `x=${box.minX.toFixed(1)}..${box.maxX.toFixed(1)}, y=${box.minY.toFixed(1)}..${box.maxY.toFixed(1)}` : '无可见像素';
  info.push(`形制 ${layout.profile}：静止联合边界 ${describe(layout.restBounds)}；动作采样联合边界 ${describe(layout.sampledBounds)}`);
  if (layout.sampledMargins) {
    const m = layout.sampledMargins;
    info.push(`动作采样留白：左 ${m.left.toFixed(1)}、右 ${m.right.toFixed(1)}、下 ${m.bottom.toFixed(1)}、上 ${m.top.toFixed(1)}；联合边界不代表主体体量或真实脚底`);
  }
  if (!layout.withinHardBounds) warnings.push('形制：采样发现形象越过 240×170 硬边界；新作需修正并播放核对，不改变旧包导入规则');
  else if (!layout.withinNewWorkSafeArea) warnings.push('形制：动作采样进入新作安全留白（x=8..232、y=4..162）；核对完整动作，勿以静止图判断');


  // preview
  const preview = comparePreview(manifest, files);
  if (!preview) {
    warnings.push(`preview \`${manifest.preview}\` 不是 240×170 的整数倍，无法自动比对；`
      + '确认它是第 0 帧渲染而不是某个图层图片');
  } else if (preview.wrongCanvas) {
    warnings.push(`preview 是整张 250 画布（${preview.scale}×），不是 240×170 的形象区——`
      + '现有包里只有 wealth-button 这样，它的缩略图会带上本不该出现的下方留白');
  } else if (preview.ratio > 0.01) {
    warnings.push(`preview 与第 0 帧合成对不上（${(preview.ratio * 100).toFixed(1)}% 像素不同）——`
      + '多半是改了关键帧却没重渲预览。这正是现有 wealth-button 的状态');
  } else {
    info.push(`preview 与第 0 帧一致（差异 ${(preview.ratio * 100).toFixed(2)}%，${preview.scale}× 采样）`);
  }

  // budgets
  let unpacked = 0;
  for (const data of files.values()) unpacked += data.length;
  if (unpacked > LIMITS.unpackedBytes) {
    errors.push(`解压后 ${(unpacked / 1048576).toFixed(1)} MB，超过 ${LIMITS.unpackedBytes / 1048576} MB`);
  }
  if (isArchive && statSync(target).size > LIMITS.archiveBytes) {
    errors.push(`压缩包 ${(statSync(target).size / 1048576).toFixed(1)} MB，超过 ${LIMITS.archiveBytes / 1048576} MB`);
  }
  info.push(`文件 ${files.size} 个，解压 ${(unpacked / 1024).toFixed(0)} KB，图层 ${manifest.layers?.length ?? 0} 个`);

  // report
  for (const line of errors) lines.push(`✗ ${line}`);
  for (const line of warnings) lines.push(`! ${line}`);
  for (const line of info) lines.push(`· ${line}`);
  return { ok: errors.length === 0, lines, payload: { manifest, files, images, preview, layout } };
}

// ---------------------------------------------------------------- cli

export function main(args = process.argv.slice(2)) {
  const mode = args.includes('--submission') ? 'submission' : args.includes('--source') ? 'source' : 'local';
  const target = args.find(arg => !arg.startsWith('--'));
  if (!target) {
    console.error('用法: node scripts/check-pack.mjs [--source|--submission] <形象包目录 | 包.nmgpack>');
    process.exit(2);
  }
  let result;
  try {
    result = check(target, { mode });
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
  for (const line of result.lines) console.log(line);
  console.log(result.ok ? '\n✓ 本地静态检查通过；仍需客户端预览验收，投稿当前暂停' : '\n✗ 还有问题要先解决');
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
