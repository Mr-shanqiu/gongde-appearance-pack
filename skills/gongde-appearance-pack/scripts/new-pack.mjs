import { cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { check } from './check-pack.mjs';
export function newPack(directory, {id=`diy.local.${randomUUID()}`,author='DIY Maker'}={}) {
  if(!directory || existsSync(directory)) throw new Error('输出目录必须不存在，不覆盖已有作品');
  const template=fileURLToPath(new URL('../assets/template/',import.meta.url));
  const manifest=JSON.parse(readFileSync(join(template,'manifest.json'),'utf8'));
  manifest.id=id; manifest.author=author; manifest.publisher=author; manifest.review_id='local';
  // Validate metadata before making any output directory.
  const files=new Map(['manifest.json',manifest.preview,...manifest.layers.map(l=>l.image)]
    .map(name=>[name,name==='manifest.json'?Buffer.from(JSON.stringify(manifest)):readFileSync(join(template,name))]));
  const result=check(files);
  if(!result.ok) throw new Error(result.lines.join('\n'));
  cpSync(template,directory,{recursive:true,errorOnExist:true,force:false});
  writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {directory,id,publisher:author};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [directory,...args]=process.argv.slice(2), options={};
    for(let i=0;i<args.length;i+=2) {
      if(!['--id','--author'].includes(args[i])||!args[i+1]) throw new Error('用法：node scripts/new-pack.mjs <新目录> [--id diy.author.unique] [--author 作者]');
      options[args[i].slice(2)]=args[i+1];
    }
    console.log(JSON.stringify(newPack(directory,options),null,2));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
