import { cp, mkdir, readFile, rm, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadCatalogPage } from '../server/catalog.mjs';
import { readCatalogRelease, refreshCatalogRelease } from './catalog-release.mjs';
const root = new URL('../', import.meta.url);
const projectPath=path.resolve(fileURLToPath(root));
const publicPath=path.resolve(projectPath,'public');
const excludedFiles=new Set(['recommendation.js','data/catalog.json','data/catalog-manifest.json','data/taxonomy.json','data/context-tags.json','assets/promo-wide.webp','assets/promo-sidebar.webp','assets/promo-abstract-v7.webp','assets/promo-logo-v9.webp']);
const hasConfiguration=Boolean(process.env.SUPABASE_URL || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
if(process.env.VERCEL && !hasConfiguration) throw new Error('Vercel 배포에는 SUPABASE_URL과 공개 키를 등록해야 합니다. 이전 DB 파일로 배포를 우회하지 않습니다.');
if(!hasConfiguration){
  try{await readFile(path.join(publicPath,'data/catalog-release.json'));}
  catch(error){if(error.code==='ENOENT')throw new Error('업로드용 묶음은 큰 DB 파일을 포함하지 않습니다. SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 배포 환경변수에 설정한 뒤 빌드해주세요. 자세한 내용: ENVIRONMENT_SETUP.txt');throw error;}
}
const {catalog,manifest,sourceCatalog}=hasConfiguration
  ? await refreshCatalogRelease({publicPath,readPage:offset=>loadCatalogPage(offset)})
  : await readCatalogRelease(publicPath);
console.log(`${hasConfiguration?'Refreshed live DB':'Verified local release'}: ${manifest.total} records, ${manifest.available} visible, generated ${manifest.generatedAt}.`);
if(sourceCatalog){
  const privateDirectory=path.join(projectPath,'server/data');
  await mkdir(privateDirectory,{recursive:true});
  await writeFile(path.join(privateDirectory,'recommendation-catalog.json.gz'),gzipSync(JSON.stringify({schemaVersion:1,catalogVersion:manifest.hash,items:sourceCatalog.items}),{level:6}));
  await rm(path.join(privateDirectory,'recommendation-catalog.json'),{force:true});
}
const html=await readFile(path.join(publicPath,'index.html'),'utf8');
const popular=JSON.parse(await readFile(path.join(publicPath,'data/popular.json'),'utf8'));
const {prerenderHome}=await import('./prerender-home.mjs');
const renderedHTML=await prerenderHome({html,catalog,popular,publicPath,release:manifest});
if(typeof renderedHTML!=='string' || !renderedHTML.includes('<html')) throw new Error('Homepage prerender failed');
const outputPath=path.resolve(projectPath,'dist');
if (path.dirname(outputPath)!==projectPath || path.basename(outputPath)!=='dist') throw new Error('Invalid output directory');
const existing=await lstat(outputPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(existing?.isSymbolicLink()) throw new Error('Output directory must not be a symbolic link');
await rm(outputPath,{recursive:true,force:true});
await mkdir(outputPath, { recursive:true });
await cp(publicPath, outputPath, { recursive:true, filter:source=>{
  const relative=path.relative(publicPath,source).split(path.sep).join('/');
  const releases=new Set([...(manifest.parts||[]).map(part=>part.url),manifest.metadataUrl,...(manifest.parts?[]:[manifest.catalogUrl])]);
  return !relative.endsWith('.map') && !excludedFiles.has(relative) && !relative.endsWith('.pending') && (!/^data\/(?:live-catalog|catalog-part|catalog-meta)\./.test(relative) || releases.has('/'+relative));
} });
await writeFile(path.join(outputPath,'index.html'),renderedHTML);
console.log(`Build complete: pre-rendered homepage and verified CDN catalog (${manifest.bytes} bytes raw, ${manifest.brotliBytes} bytes Brotli). DB updates appear after a successful new deployment.`);
