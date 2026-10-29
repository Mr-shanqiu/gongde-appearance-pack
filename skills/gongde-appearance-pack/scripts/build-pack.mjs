import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { check, LIMITS } from './check-pack.mjs';
import { zipFiles } from './pack-lib.mjs';
export function buildPack(directory, output) {
  if(!output?.endsWith('.nmgpack')) throw new Error('输出扩展名必须是 .nmgpack');
  const result=check(directory);
  if(!result.ok) throw new Error(result.lines.join('\n'));
  const bytes=zipFiles(result.payload.files);
  if(bytes.length>LIMITS.archiveBytes) throw new Error('封装后超过制作工具 8MiB 预算');
  writeFileSync(output,bytes,{flag:'wx'});
  const roundtrip=check(output);
  if(!roundtrip.ok) throw new Error(roundtrip.lines.join('\n'));
  return { bytes:bytes.length, warnings:result.lines.filter(line=>line.startsWith('!')), layout:result.payload.layout };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(buildPack(...process.argv.slice(2)),null,2)); }
  catch(error) {console.error(error.message);process.exitCode=1;}
}
