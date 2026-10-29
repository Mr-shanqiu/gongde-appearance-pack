import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newPack } from './new-pack.mjs';
import { buildPack } from './build-pack.mjs';
import { check, decodePng } from './check-pack.mjs';
import { renderPreview } from './render-preview.mjs';
const sandbox=mkdtempSync(join(tmpdir(),'gongde-skill-'));
try {
  const dir=join(sandbox,'my-pack');newPack(dir,{id:'diy.smoke.waving-bell',author:'Local Maker'});
  const initial=check(dir);assert.equal(initial.ok,true,initial.lines.join('\n'));
  assert.equal(initial.payload.layout.withinNewWorkSafeArea,true);
  const archive=join(sandbox,'bell.nmgpack');buildPack(dir,archive);
  assert.equal(check(archive).payload.manifest.id,'diy.smoke.waving-bell');
  assert.throws(()=>buildPack(dir,archive),/EEXIST/);
  assert.throws(()=>newPack(dir),/不覆盖/);
  const m=JSON.parse(readFileSync(join(dir,'manifest.json')));
  const preview=decodePng(renderPreview(m,check(dir).payload.files,.28));
  assert.equal(preview.width,480);assert.equal(preview.height,340);
  const first=renderPreview(m,check(dir).payload.files,0);
  assert.ok(!first.equals(renderPreview(m,check(dir).payload.files,.28)),'animation peak must change the picture');
  // Also build the common schema1 path using the same author-owned artwork.
  m.schema_version=1;
  for(const layer of m.layers){delete layer.interpolation;for(const f of layer.keyframes)delete f.scale_y;}
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(m));
  const second=join(sandbox,'bell-schema1.nmgpack');buildPack(dir,second);
  assert.equal(check(second).payload.manifest.schema_version,1);
  m.id='official.cannot-impersonate';writeFileSync(join(dir,'manifest.json'),JSON.stringify(m));
  assert.equal(check(dir).ok,false);
  console.log('PASS standalone: init, schema3/schema1 ZIP roundtrip, preview/animation, safety bounds, no overwrite, reserved identity rejection');
} finally {rmSync(sandbox,{recursive:true,force:true});}
