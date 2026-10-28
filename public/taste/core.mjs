export const MEDIA = ['웹툰','웹소설','OTT','영화'];
export const AXES = ['tempo','mood','resolve','unusual'];
export const GROUPS = {genre:'장르',setting_premise:'소재·배경',character_relationship:'인물·관계'};
export const MODEL = 'taste-v17-media-v3-20261028';
export const axis = n => typeof n==='number' && Number.isFinite(n) && n>=0 && n<=100 ? n : null;
const unique = a => [...new Set(a)];
export function profiles(works, ratings, dictionary) {
 const byId=new Map(works.map(w=>[w.id,w])), allowed=new Set(dictionary.filter(t=>t.status==='KEEP').map(t=>t.tag_slug));
 const result={};
 for(const [id,rating] of Object.entries(ratings)) {
  const w=byId.get(Number(id)); if(!w||!MEDIA.includes(w.media)||!['LIKE','DISLIKE','NEUTRAL'].includes(rating)) continue;
  const p=result[w.media] ||= {sample_count:0,liked_count:0,disliked_count:0,neutral_count:0,liked_tag_counts:{},disliked_tag_counts:{},liked_primary_engine_counts:{},disliked_primary_engine_counts:{},model_version:'media-v3-rating-like-mean-1'};
  p.sample_count++; p[{LIKE:'liked_count',DISLIKE:'disliked_count',NEUTRAL:'neutral_count'}[rating]]++;
  for(const k of AXES) { p[k+'_sum']??=0; p[k+'_valid_count']??=0; if(rating==='LIKE'&&axis(w[k])!==null){p[k+'_sum']+=w[k];p[k+'_valid_count']++;} }
  if(rating==='NEUTRAL') continue;
  const prefix=rating==='LIKE'?'liked':'disliked';
  for(const tag of unique(w.tags||[]).filter(t=>allowed.has(t))) p[prefix+'_tag_counts'][tag]=(p[prefix+'_tag_counts'][tag]||0)+1;
  if(w.engine) p[prefix+'_primary_engine_counts'][w.engine]=(p[prefix+'_primary_engine_counts'][w.engine]||0)+1;
 }
 for(const p of Object.values(result)) for(const k of AXES) p[k]=p[k+'_valid_count']?p[k+'_sum']/p[k+'_valid_count']:null;
 return result;
}
export function filtered(works, media, tags, query='') {
 const term=query.normalize('NFC').replace(/\s+/g,'').toLocaleLowerCase();
 return works.filter(w=>(media==='전체'||w.media===media)&&tags.every(t=>w.tags.includes(t))&&(!term||w.title.normalize('NFC').replace(/\s+/g,'').toLocaleLowerCase().includes(term)));
}
export function facets(works,dictionary,media,tags=[]) {
 const base=filtered(works,media,tags), counts={};
 for(const w of base) for(const tag of unique(w.tags)) counts[tag]=(counts[tag]||0)+1;
 return dictionary.filter(t=>GROUPS[t.category]&&t.status==='KEEP'&&(counts[t.tag_slug]||tags.includes(t.tag_slug))).map(t=>({...t,count:counts[t.tag_slug]||0})).sort((a,b)=>b.count-a.count||a.display_name.localeCompare(b.display_name,'ko'));
}
function pair(a,b,dict) {
 const common=a.tags.filter(t=>b.tags.includes(t)), genre=common.filter(t=>dict.get(t)?.category==='genre');
 const specific=common.filter(t=>['setting_premise','character_relationship'].includes(dict.get(t)?.category));
 const engine=Boolean(a.engine&&(a.engine===b.engine||a.engine===b.secondary||a.secondary&&a.secondary===b.engine));
 const world=Boolean(a.world&&a.world===b.world);
 const murim=w=>w.tags.some(t=>['murim','murim-world'].includes(t));
 const compatible=murim(a)===murim(b);
 const strict=compatible&&engine&&specific.length>=1&&(world||specific.length>=2)&&genre.length>0;
 const fallback=compatible&&genre.length>0&&(specific.length>=2||engine&&specific.length>=1);
 const score=(engine?0.38:0)+(world?0.17:0)+Math.min(.25,specific.length*.08)+Math.min(.15,genre.length*.06);
 return {score,strict,fallback,common,specific,engine,world,genre};
}
export function recommend(works,dictionary,input) {
 const dict=new Map(dictionary.map(t=>[t.tag_slug,t])), byId=new Map(works.map(w=>[w.id,w]));
 const liked=Object.entries(input.ratings).filter(([,r])=>r==='LIKE').map(([id])=>byId.get(Number(id))).filter(Boolean);
 const ps=profiles(works,input.ratings,dictionary), prefs=input.preferences||{}, candidates=works.filter(w=>!input.ratings[w.id]&&liked.some(a=>a.media===w.media)&&!liked.some(a=>a.media===w.media&&a.ip&&a.ip===w.ip)&&!(prefs[w.media]?.excluded||[]).some(t=>w.tags.includes(t)));
 const all=[];
 for(const w of candidates) {
  const anchors=liked.filter(a=>a.media===w.media).map(a=>({a,...pair(a,w,dict)})).sort((a,b)=>b.score-a.score);
  const p=ps[w.media], pref=prefs[w.media]||{};
  let signal=0;
  for(const t of w.tags) {
   const pos=p.liked_tag_counts[t]||0,neg=p.disliked_tag_counts[t]||0;
   // Evidence is media-scoped. Mixed reactions and broad tags never become hard exclusions.
   signal+=Math.max(-.025,Math.min(.025,(pos/(p.liked_count+2)-neg/(p.disliked_count+2))*.035));
   if(pref.liked?.includes(t)) signal+=.035;
  }
  const valid=AXES.filter(k=>axis(w[k])!==null&&axis(p[k])!==null);
  const axesScore=valid.length?valid.reduce((n,k)=>n+(1-Math.abs(w[k]-p[k])/100),0)/valid.length*.08:0;
  const strong=anchors.filter(a=>a.strict||a.fallback);
  const match=strong.length?strong[0].score*.7+strong.slice(0,3).reduce((n,a)=>n+a.score,0)/Math.min(3,liked.filter(a=>a.media===w.media).length)*.3+signal+axesScore:0;
  const pivot=anchors.find(a=>a.a.id===Number(input.pivot));
  // Discovery changes the setting or main narrative, while preserving two concrete connections.
  const discovery=anchors.find(a=>a.specific.length>=2&&a.score>=.35&&((a.engine&&!a.world&&a.a.world&&w.world)||(a.world&&!a.engine&&a.genre.length>0)));
  all.push({w,anchors,strong,match,pivot,discovery,signal});
 }
 const pick=(rows,reason)=>{
  const seen=new Set(),out=[];
  for(const row of rows){const key=row.w.media+':'+(row.w.ip||row.w.id);if(seen.has(key))continue; seen.add(key); out.push({...row.w,reason:reason(row)});if(out.length===3)break;}return out;
 };
 const names=a=>a.specific.slice(0,2).map(t=>dict.get(t)?.display_name).filter(Boolean).join(' · ');
 return {
  match:pick(all.filter(r=>r.match>.25).sort((a,b)=>b.match-a.match||a.w.id-b.w.id),r=>r.strong.length>1?'좋아한 '+r.strong.length+'편과 이야기의 결이 이어져요.':r.strong[0].a.title+'의 '+(names(r.strong[0])||'이야기 구조')+'와 연결돼요.'),
  similar:pick(all.filter(r=>r.pivot&&(r.pivot.strict||r.pivot.fallback)).sort((a,b)=>Number(b.pivot.strict)-Number(a.pivot.strict)||b.pivot.score-a.pivot.score||a.w.id-b.w.id),r=>(r.pivot.strict?'가까운 이야기 · ':'범위를 넓힌 추천 · ')+(names(r.pivot)||r.pivot.genre.map(t=>dict.get(t)?.display_name).join(' · '))),
  discover:pick(all.filter(r=>r.discovery).sort((a,b)=>(b.discovery.score+b.signal)-(a.discovery.score+a.signal)||a.w.id-b.w.id),r=>r.discovery.a.title+'의 '+names(r.discovery)+'를 다른 '+(r.discovery.engine?'배경':'이야기 흐름')+'에서 만나보세요.')
 };
}
export function validateSubmission(value) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['requestId','ratings','preferences','conflictPolicy'].includes(k))) throw new Error('invalid_payload');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId||''))throw new Error('invalid_request_id');
 if(!value.ratings||Array.isArray(value.ratings)||typeof value.ratings!=='object') throw new Error('invalid_ratings');
 const entries=Object.entries(value.ratings), likes=entries.filter(([,r])=>r==='LIKE').length;
 if(likes<5||likes>10||entries.length>300||entries.some(([id,r])=>!/^[1-9]\d*$/.test(id)||Number(id)<1||Number(id)>2147483647||!['LIKE','DISLIKE','NEUTRAL'].includes(r)))throw new Error('invalid_ratings');
 if(!['preserve','replace'].includes(value.conflictPolicy))throw new Error('invalid_conflict_policy');
 if(!value.preferences||typeof value.preferences!=='object'||Array.isArray(value.preferences)||Object.keys(value.preferences).some(m=>!MEDIA.includes(m)))throw new Error('invalid_preferences');
 for(const pref of Object.values(value.preferences)) {
  if(!pref||typeof pref!=='object'||Object.keys(pref).some(k=>!['liked','excluded'].includes(k)))throw new Error('invalid_preferences');
  for(const k of ['liked','excluded']) if(!Array.isArray(pref[k])||pref[k].length>50||pref[k].some(t=>typeof t!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(t)))throw new Error('invalid_preferences');
  if(pref.liked.some(t=>pref.excluded.includes(t)))throw new Error('conflicting_preferences');
 }
 return value;
}
