import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePng, validateManifest, sample } from './check-pack.mjs';
import { encodePng, readDeclared } from './pack-lib.mjs';

// Offline authoring preview. Premultiplied bilinear sampling avoids dark edges;
// native colour management/filtering can differ, so this is not a parity oracle.
export function renderPreview(manifest, files, phase = 0) {
  const mode = manifest.id?.startsWith('diy.') ? 'local' : 'source';
  const validation = validateManifest(manifest, files, mode);
  if (validation.errors.length) throw new Error(validation.errors.join('\n'));
  if (!Number.isFinite(phase) || phase < 0 || phase > 1) throw new Error('phase 必须是 0–1');
  const width = 480, height = 340, target = new Float64Array(width * height * 4);
  for (const layer of manifest.layers) {
    const image = decodePng(files.get(layer.image)), frame = sample(layer.keyframes, phase, layer.interpolation);
    const [fx, fy, fw, fh] = layer.frame, [ax, ay] = layer.anchor;
    const sx = frame.scale ?? 1, sy = sx * (frame.scale_y ?? 1);
    const cx = fx + fw * ax, cy = fy + fh * ay;
    const angle = -(frame.rotation ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = (x + .5) / 2 - cx - (frame.x ?? 0);
      const dy = 170 - (y + .5) / 2 - cy - (frame.y ?? 0);
      const lx = (dx*c-dy*s)/sx + cx, ly = (dx*s+dy*c)/sy + cy;
      const u = (lx-fx)/fw, v = (fy+fh-ly)/fh;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const px = u*image.width-.5, py = v*image.height-.5, ix = Math.floor(px), iy = Math.floor(py);
      let a=0, r=0, g=0, b=0;
      for (let oy=0;oy<2;oy++) for(let ox=0;ox<2;ox++) {
        const xx=ix+ox, yy=iy+oy;
        if(xx<0||xx>=image.width||yy<0||yy>=image.height) continue;
        const weight=(ox ? px-ix : 1-px+ix)*(oy ? py-iy : 1-py+iy);
        const i=(yy*image.width+xx)*image.channels;
        const alpha=(image.channels===4 ? image.pixels[i+3]/255 : 1)*weight*(frame.alpha ?? 1);
        a+=alpha; r+=image.pixels[i]*alpha; g+=image.pixels[i+1]*alpha; b+=image.pixels[i+2]*alpha;
      }
      const i=(y*width+x)*4, inverse=1-a;
      target[i]=r+target[i]*inverse; target[i+1]=g+target[i+1]*inverse;
      target[i+2]=b+target[i+2]*inverse; target[i+3]=a+target[i+3]*inverse;
    }
  }
  const output = Buffer.alloc(width*height*4);
  for (let i=0;i<output.length;i+=4) {
    const a=target[i+3];
    if(a>0) { output[i]=Math.round(target[i]/a); output[i+1]=Math.round(target[i+1]/a); output[i+2]=Math.round(target[i+2]/a); }
    output[i+3]=Math.round(a*255);
  }
  return encodePng(width,height,output);
}
export function main(args=process.argv.slice(2)) {
  const [directory, output, phaseText='0'] = args;
  if(!directory || !output) throw new Error('用法：node scripts/render-preview.mjs <源目录> <新输出.png> [phase=0]');
  if(lstatSync(directory).isSymbolicLink()) throw new Error('源目录不能是符号链接');
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
  // readDeclared is only used after validating filenames against a safe empty map.
  const names=[manifest.preview,...(manifest.layers ?? []).map(l=>l?.image)];
  if(names.some(n=>typeof n!=='string'||!/^[a-z0-9][a-z0-9_-]{0,59}\.png$/.test(n))) throw new Error('图片文件名不安全');
  for(const name of ['manifest.json',...names]) if(!lstatSync(join(directory,name)).isFile()) throw new Error('仅允许普通文件');
  if(resolve(output)===resolve(directory,manifest.preview)) throw new Error('先输出到新路径；确认预览后再替换源 preview，避免覆盖唯一文件');
  writeFileSync(output,renderPreview(manifest,readDeclared(directory,manifest),Number(phaseText)),{flag:'wx'});
  console.log(`已输出 ${output}；这是制作预览，最终以原生客户端为准。`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { main(); } catch(error) { console.error(error.message); process.exitCode=1; }
}
