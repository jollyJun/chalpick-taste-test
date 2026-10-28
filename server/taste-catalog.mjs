import { readFile } from 'node:fs/promises';
import { buildCatalog } from './catalog-model.mjs';
import { readBoundedJSON } from './security.mjs';
const FRESH_MS=300000,STALE_MS=60000;
export function createTasteCatalogLoader(){
 let cached,inFlight,retryAt=0;
 return async function loadTasteCatalog({env=process.env,fetchImpl=fetch,now=Date.now,allowStale=false}={}) {
 const requestedAt=now();
 if(cached&&cached.until>requestedAt)return cached.value;
 const canUseStale=allowStale&&cached&&requestedAt<cached.until+STALE_MS;
 if(canUseStale&&requestedAt<retryAt)return cached.value;
 if(!inFlight)inFlight=(async()=>{
  const base=new URL(env.SUPABASE_URL||'https://invalid.invalid'), key=env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY;
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||!key)throw new Error('catalog_not_configured');
  if(!key.startsWith('sb_publishable_')){let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));}catch{}if(claims?.role!=='anon')throw new Error('public_key_required');}
  async function page(table,params={}) {
   const url=new URL('/rest/v1/'+table,base);url.search=new URLSearchParams(params);
   const r=await fetchImpl(url,{headers:{apikey:key,Prefer:'count=exact'},redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw new Error('catalog_unavailable');
   return {rows:await readBoundedJSON(r,8_000_000),count:Number(r.headers.get('content-range')?.split('/')[1])};
  }
  const params={select:'id,ip_id,title,media,release_year,thumbnail_url,origin_image_url,poster_url,tempo,mood,resolve,unusual,story_engine_primary,story_engine_secondary,world_model,fantasy_presence,tag_slugs_cache,recommendation_status',order:'id.asc',limit:'1000'};
  const [first,d,e]=await Promise.all([page('contents',{...params,offset:'0'}),page('tag_dictionary',{select:'tag_slug,display_name,category,status',limit:'1000'}),page('story_engine_dictionary',{select:'engine_slug,status',limit:'1000'})]);
  if(!Number.isSafeInteger(first.count)||first.count>200000)throw new Error('invalid_catalog_count');
  const rows=[...first.rows];
  for(let offset=1000;offset<first.count;offset+=4000){
   const offsets=[offset,offset+1000,offset+2000,offset+3000].filter(n=>n<first.count);
   const pages=await Promise.all(offsets.map(n=>page('contents',{...params,offset:String(n)})));
   for(const p of pages){if(p.count!==first.count)throw new Error('catalog_changed'); rows.push(...p.rows);}
  }
  if(rows.length!==first.count||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('incomplete_catalog');
  const ageRatings=JSON.parse(await readFile(new URL('./catalog-age-ratings.json',import.meta.url),'utf8'));
  const normalized=buildCatalog({contents:rows,tag_dictionary:d.rows},{ageRatings});
  const safeImages=new Map(normalized.items.filter(w=>w.adult!==true).map(w=>[w.id,w.image]));
  const dictionary=d.rows.filter(t=>t.status==='KEEP');
  const allowed=new Set(dictionary.map(t=>t.tag_slug)),engines=new Set(e.rows.filter(x=>['KEEP','RENAME'].includes(x.status)).map(x=>x.engine_slug));
  const works=rows.filter(w=>safeImages.has(w.id)&&w.recommendation_status!=='HOLD').map(w=>({id:w.id,title:w.title,media:w.media,year:w.release_year,image:safeImages.get(w.id),ip:w.ip_id,tags:[...new Set(w.tag_slugs_cache||[])].filter(t=>allowed.has(t)),tempo:w.tempo,mood:w.mood,resolve:w.resolve,unusual:w.unusual,engine:engines.has(w.story_engine_primary)?w.story_engine_primary:null,secondary:engines.has(w.story_engine_secondary)?w.story_engine_secondary:null,world:w.world_model}));
  const value={works,dictionary,sourceCount:rows.length,loadedAt:new Date(now()).toISOString()};cached={value,until:now()+FRESH_MS};retryAt=0;return value;
 })().catch(error=>{retryAt=now()+10000;throw error;}).finally(()=>{inFlight=null;});
 // Persistent servers opt in; serverless handlers await refresh unless they support background work.
 // Public catalog only: refresh once in the background, with a strict 60-second stale limit.
 // Catch background errors explicitly; after the limit the caller must await a fresh snapshot.
 if(canUseStale){inFlight.catch(()=>{});return cached.value;}
 return inFlight;
 };
}
export const loadTasteCatalog=createTasteCatalogLoader();
