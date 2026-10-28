import { Readable } from 'node:stream';
import { readAuthenticatedSession } from './auth.mjs';
import { SECURITY_HEADERS,readBoundedJSON } from './security.mjs';
import { loadTasteCatalog } from './taste-catalog.mjs';
import { MEDIA,facets,profiles,recommend,validateSubmission } from '../public/taste/core.mjs';
const catalogIndexes=new WeakMap(),MAX_RANKED_QUERIES=16;
const searchText=value=>value.normalize('NFC').replace(/\s+/g,'').toLocaleLowerCase();
function catalogIndex(catalog){
 let index=catalogIndexes.get(catalog);
 // A refreshed DB snapshot gets its own index. Never retain the previous snapshot's order.
 if(!index||index.works!==catalog.works||index.dictionary!==catalog.dictionary||index.loadedAt!==catalog.loadedAt){
  index={works:catalog.works,dictionary:catalog.dictionary,loadedAt:catalog.loadedAt,allowedTags:new Set(catalog.dictionary.map(t=>t.tag_slug)),rows:null,ranked:new Map(),options:null};
  catalogIndexes.set(catalog,index);
 }
 return index;
}
function rankedWorks(index,media,tags,term,seed){
 const all=media.includes('전체'),mediaSet=new Set(media);
 const key=JSON.stringify([all?['전체']:[...mediaSet].sort(),[...tags].sort(),term,seed]);
 const hit=index.ranked.get(key);
 if(hit){index.ranked.delete(key);index.ranked.set(key,hit);return hit;}
 index.rows??=index.works.map(work=>({work,title:searchText(work.title),tags:new Set(work.tags)}));
 const hash=id=>{let n=(id^seed)>>>0;n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return (n^(n>>>16))>>>0;};
 const rows=[];
 for(const row of index.rows){
  const preferred=all||mediaSet.has(row.work.media);
  if(term?!row.title.includes(term):!preferred)continue;
  rows.push({work:row.work,preferred:Number(preferred),titleRank:term?(row.title===term?2:row.title.startsWith(term)?1:0):0,matched:tags.reduce((n,t)=>n+Number(row.tags.has(t)),0),hash:hash(row.work.id)});
 }
 rows.sort((a,b)=>(term?b.titleRank-a.titleRank||b.preferred-a.preferred:0)||b.matched-a.matched||a.hash-b.hash||a.work.id-b.work.id);
 const ranked=rows.map(row=>row.work);index.ranked.set(key,ranked);
 if(index.ranked.size>MAX_RANKED_QUERIES)index.ranked.delete(index.ranked.keys().next().value);
 return ranked;
}
export async function tasteRPC(name,args,{env=process.env,fetchImpl=fetch}={}){
 const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 if(!secret)throw Object.assign(new Error('not_configured'),{status:503});
 const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co'))throw new Error('invalid_config');
 const headers={apikey:secret,'Content-Type':'application/json'};if(!secret.startsWith('sb_secret_'))headers.Authorization='Bearer '+secret;
 const r=await fetchImpl(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers,body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(15000)});
 const data=await readBoundedJSON(r,1_000_000);
 if(!r.ok)throw Object.assign(new Error(data.code==='P0409'?'conflict':data.code==='P0404'?'member_required':data.code==='22023'?'invalid_payload':'save_unavailable'),{status:data.code==='P0409'?409:data.code==='P0404'?409:data.code==='22023'?400:503});
 return data;
}
export function verifiedOwner(user){
 if(!user||!['naver','kakao'].includes(user.provider)||!user.id?.startsWith(user.provider+':'))return null;
 const external=user.id.slice(user.provider.length+1);if(!external||external.length>128||/[\x00-\x1f\x7f]/.test(external))return null;
 return {p_provider:user.provider.toUpperCase(),p_external_id:external};
}
export async function handleTaste(request,options={}){
 const reply=(body,status=200)=>Response.json(body,{status,headers:{...SECURITY_HEADERS,'Cache-Control':'no-store',Vary:'Cookie'}});
 try{
  const url=new URL(request.url),action=url.searchParams.get('action')||'catalog';
  if(!['GET','POST'].includes(request.method))return reply({error:'method_not_allowed'},405);
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if(origin&&origin!==url.origin||site==='cross-site')return reply({error:'origin_not_allowed'},403);
  if(request.method==='POST'&&(origin!==url.origin||request.headers.get('x-chalpick-taste')!=='1'||!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||'')))return reply({error:'origin_not_allowed'},403);
  if(['import','profile'].includes(action)){
   const owner=verifiedOwner((options.readSession||readAuthenticatedSession)(request,options));
   if(!owner)return reply({error:'not_authenticated'},401);
   const rpc=options.rpc||tasteRPC;
   if(action==='profile'&&request.method==='GET')return reply(await rpc('cp_v17_taste_profile',owner,options));
   if(action!=='import'||request.method!=='POST')return reply({error:'method_not_allowed'},405);
   let body;try{body=validateSubmission(await readBoundedJSON(request,50000));}catch{return reply({error:'invalid_payload'},400);}
   return reply(await rpc('cp_v17_import_taste',{...owner,p_payload:body},options));
  }
  if(!['catalog','options','result'].includes(action))return reply({error:'not_found'},404);
  const catalog=await (options.loadCatalog||loadTasteCatalog)(options),{works,dictionary}=catalog;
  if(action==='result'){
   if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
   const body=await readBoundedJSON(request,50000);let input;
   try{input=validateSubmission({requestId:body.requestId,ratings:body.ratings,preferences:body.preferences,conflictPolicy:'preserve'});}catch{return reply({error:'invalid_payload'},400);}
   const ids=new Set(works.map(w=>w.id));if(Object.keys(input.ratings).some(id=>!ids.has(Number(id))))return reply({error:'content_changed'},409);
   const media=MEDIA.includes(body.resultMedia)?body.resultMedia:works.find(w=>input.ratings[w.id]==='LIKE')?.media;
   return reply({profiles:profiles(works,input.ratings,dictionary),recommendations:recommend(works.filter(w=>w.media===media),dictionary,{...input,pivot:body.pivot}),selected:works.filter(w=>input.ratings[w.id]==='LIKE')});
  }
  if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
  const index=catalogIndex(catalog);
  if(action==='options'){
   index.options??={dictionary,facetsByMedia:Object.fromEntries(['전체',...MEDIA].map(m=>[m,facets(works,dictionary,m,[])]))};
   return reply(index.options);
  }
  const media=(url.searchParams.get('media')||'전체').split(','),tags=[...new Set((url.searchParams.get('tags')||'').split(',').filter(Boolean))],q=(url.searchParams.get('q')||'').trim();
  const offset=Number(url.searchParams.get('offset')||0),seed=Number(url.searchParams.get('seed')||1);
  if(media.length>4||media.some(m=>!['전체',...MEDIA].includes(m))||tags.length>30||tags.some(t=>!index.allowedTags.has(t))||q.length>100||!Number.isSafeInteger(offset)||offset<0||offset>200000||!Number.isSafeInteger(seed)||seed<1||seed>2147483647)return reply({error:'invalid_query'},400);
  const candidates=rankedWorks(index,media,tags,searchText(q),seed);
  const page=candidates.slice(offset,offset+24);
  return reply({items:page,total:candidates.length,nextOffset:offset+page.length<candidates.length?offset+page.length:null,dictionary,searchScope:q?'all':'preferred',sourceCount:catalog.sourceCount,loadedAt:catalog.loadedAt});

 }catch(e){return reply({error:e.status?e.message:'unavailable'},e.status||503);}
}
export async function handleNodeTaste(req,res){
 const init={method:req.method,headers:req.headers};if(req.method!=='GET'&&req.method!=='HEAD'){init.body=Readable.toWeb(req);init.duplex='half';}
 const result=await handleTaste(new Request(new URL(req.url,'http://'+req.headers.host),init),{allowStale:true});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());
}
