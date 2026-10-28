import test from 'node:test';
import assert from 'node:assert/strict';
import {profiles,recommend,validateSubmission,filtered} from '../public/taste/core.mjs';
import {handleTaste,verifiedOwner} from '../server/taste.mjs';
import {handleTasteRegister} from '../server/taste-register.mjs';
import {createTasteCatalogLoader} from '../server/taste-catalog.mjs';
const dict=[['action','genre'],['murim','setting_premise'],['team','character_relationship'],['romance','genre']].map(([tag_slug,category])=>({tag_slug,category,status:'KEEP',display_name:tag_slug}));
const w=(id,extra={})=>({id,title:'작품'+id,media:'웹툰',tags:['action','murim','team'],engine:'power',world:'murim',tempo:80,mood:70,resolve:90,unusual:80,...extra});
const base=()=>({requestId:'11111111-1111-4111-8111-111111111111',ratings:{1:'LIKE',2:'LIKE',3:'LIKE',4:'LIKE',5:'LIKE'},preferences:{},conflictPolicy:'preserve'});
test('매체별 좋아요만 집계하며 0과 null을 구분한다',()=>{const p=profiles([w(1,{tempo:0,mood:null}),w(2,{tempo:100,mood:null}),w(3,{media:'영화',tempo:90}),w(4,{tempo:100})],{1:'LIKE',2:'LIKE',3:'LIKE',4:'DISLIKE'},dict);assert.equal(p.웹툰.tempo,50);assert.equal(p.웹툰.mood,null);assert.equal(p.영화.tempo,90);assert.equal(p.웹툰.liked_tag_counts.murim,2);});
test('장르만 같은 작품은 유사픽에 포함하지 않는다',()=>{const a=Array.from({length:5},(_,i)=>w(i+1));const r=recommend([...a,w(6),w(7,{tags:['action'],engine:'love',world:'modern'})],dict,{...base(),pivot:1});assert.deepEqual(r.similar.map(x=>x.id),[6]);});
test('1순위가 없어도 구체적인 공통점이 있는 2순위는 나온다',()=>{const a=Array.from({length:5},(_,i)=>w(i+1));const r=recommend([...a,w(6,{engine:'revenge',world:'other'})],dict,{...base(),pivot:1});assert.equal(r.similar[0].id,6);assert.match(r.similar[0].reason,/범위를 넓힌/);});
test('명시적 제외는 세 추천 모두에 적용',()=>{const r=recommend(Array.from({length:9},(_,i)=>w(i+1)),dict,{...base(),preferences:{웹툰:{liked:[],excluded:['team']}},pivot:1});assert.equal(r.match.length+r.similar.length+r.discover.length,0);});
test('같은 IP라도 다른 매체의 평가를 지우지 않는다',()=>{const p=profiles([w(1,{ip:'same'}),w(2,{ip:'same',media:'영화'})],{1:'LIKE',2:'DISLIKE'},dict);assert.equal(p.웹툰.liked_count,1);assert.equal(p.영화.disliked_count,1);});
test('중복 ID 별칭과 임의 축 점수 입력을 거절',()=>{assert.throws(()=>validateSubmission({...base(),ratings:{...base().ratings,'01':'LIKE'}}));assert.throws(()=>validateSubmission({...base(),tempo:100}));assert.throws(()=>validateSubmission({...base(),preferences:null}));});
test('선택 분야와 태그 모두를 적용하고 한글 검색을 유지',()=>{assert.equal(filtered([w(1,{title:'천하제일 대사형'}),w(2,{media:'영화'})],'웹툰',['murim'],'천하제일대사형').length,1);});
const opts={loadCatalog:async()=>({works:Array.from({length:55},(_,i)=>w(i+1)),dictionary:dict,sourceCount:55})};
test('새로고침 페이지는 미노출 작품을 계속 제공',async()=>{const get=async offset=>(await handleTaste(new Request('http://localhost/api/taste?offset='+offset+'&seed=123'),opts)).json();const a=await get(0),b=await get(24);assert.equal(a.items.length,24);assert.equal(b.items.length,24);assert.equal(a.items.some(x=>b.items.some(y=>x.id===y.id)),false);});
const req=(action,body,origin='http://localhost')=>new Request('http://localhost/api/taste?action='+action,{method:'POST',headers:{origin,'content-type':'application/json','x-chalpick-taste':'1'},body:JSON.stringify(body)});
test('인증 없는 저장과 외부 사이트의 요청을 차단',async()=>{assert.equal((await handleTaste(req('import',base()),{readSession:()=>null})).status,401);assert.equal((await handleTaste(req('import',base(),'https://evil.invalid'),{})).status,403);});
test('저장 주인은 요청 본문이 아니라 검증된 세션에서 결정',async()=>{let args;const r=await handleTaste(req('import',base()),{readSession:()=>({provider:'naver',id:'naver:actual'}),rpc:async(n,a)=>{args=a;return {status:'ready'}}});assert.equal(r.status,200);assert.equal(args.p_external_id,'actual');assert.equal(verifiedOwner({provider:'naver',id:'kakao:fake'}),null);});
test('이메일 인증 이전에는 회원 연결을 진행하지 않는다',async()=>{const r=await handleTasteRegister(new Request('http://localhost/api/taste-register?action=verify',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','x-chalpick-taste':'1'},body:'{}'}),{env:{AUTH_SESSION_SECRET:Buffer.alloc(32).toString('base64url'),SUPABASE_PUBLISHABLE_KEY:'test',SUPABASE_URL:'https://test.supabase.co'},readSession:()=>({provider:'naver',id:'naver:qa'})});assert.equal(r.status,400);assert.equal((await r.json()).error,'verification_expired');});
test('이메일 인증 성공값만 기존 소셜 계정에 연결한다',async()=>{
 const env={AUTH_SESSION_SECRET:Buffer.alloc(32,1).toString('base64url'),SUPABASE_PUBLISHABLE_KEY:'test',SUPABASE_URL:'https://test.supabase.co'};let linked;
 const opt={env,readSession:()=>({provider:'kakao',id:'kakao:verified'}),fetchImpl:async url=>Response.json(String(url).endsWith('/otp')?{}:{user:{id:'11111111-1111-4111-8111-111111111111',email:'qa@example.invalid',email_confirmed_at:new Date().toISOString()}}),rpc:async(n,a)=>{linked=a;return {status:'ready'}}};
 const request=(action,body,cookie='')=>new Request('http://localhost/api/taste-register?action='+action,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','x-chalpick-taste':'1',cookie},body:JSON.stringify(body)});
 const sent=await handleTasteRegister(request('send',{email:'qa@example.invalid'}),opt);assert.equal(sent.status,200);const cookie=sent.headers.get('set-cookie').split(';')[0];
 const saved=await handleTasteRegister(request('verify',{token:'123456',nickname:'시험',gender:'OTHER',ageGroup:'30S'},cookie),opt);assert.equal(saved.status,200);assert.equal(linked.p_external_id,'verified');assert.equal(linked.p_auth_user,'11111111-1111-4111-8111-111111111111');
 const wrong=await handleTasteRegister(request('verify',{token:'123456',nickname:'시험',gender:'OTHER',ageGroup:'30S'},cookie),{...opt,readSession:()=>({provider:'kakao',id:'kakao:different'})});assert.equal(wrong.status,400);
});
test('복수 분야 목록에서 태그 전체 일치 → 일부 일치 → 나머지 순서',async()=>{const works=[w(1,{tags:['action'],media:'웹툰'}),w(2,{tags:['action','team'],media:'웹소설'}),w(3,{tags:['team'],media:'영화'}),w(4,{tags:[],media:'웹툰'})];const r=await handleTaste(new Request('http://localhost/api/taste?media='+encodeURIComponent('웹툰,웹소설')+'&tags=action,team'),{loadCatalog:async()=>({works,dictionary:dict})});const data=await r.json();assert.equal(r.status,200);assert.deepEqual(data.items.map(x=>x.id),[2,1,4]);});
test('검색은 선택 분야와 태그 밖의 작품도 찾고 정확한 제목을 먼저 표시',async()=>{const works=[w(1,{title:'무빙',media:'OTT',tags:[]}),w(2,{title:'무빙의 전설',media:'웹툰'})];const data=await(await handleTaste(new Request('http://localhost/api/taste?media='+encodeURIComponent('웹툰')+'&tags=murim&q='+encodeURIComponent('무빙')),{loadCatalog:async()=>({works,dictionary:dict})})).json();assert.deepEqual(data.items.map(x=>x.id),[1,2]);assert.equal(data.searchScope,'all');});
test('첫 화면의 미리 불러오기는 태그만 보내고 전체 작품을 보내지 않는다',async()=>{const data=await(await handleTaste(new Request('http://localhost/api/taste?action=options'),opts)).json();assert.ok(data.facetsByMedia.웹툰.length);assert.equal(data.items,undefined);assert.equal(data.works,undefined);});
test('다음 페이지는 정렬을 재사용하며 검색·분야·태그 조건별 목록은 섞이지 않는다',async()=>{
 let tagReads=0;
 const works=Array.from({length:60},(_,i)=>{
  const tags=i%2?['romance']:['action','murim','team'];
  Object.defineProperty(tags,Symbol.iterator,{value:function*(){tagReads++;yield* Array.prototype.values.call(this);}});
  return w(i+1,{title:(i%2?'로맨스 ':'무협 ')+(i+1),media:i%3?'웹툰':'영화',tags});
 });
 const catalog={works,dictionary:dict,loadedAt:'one'},options={loadCatalog:async()=>catalog};
 const get=async query=>(await(await handleTaste(new Request('http://localhost/api/taste?'+query),options)).json());
 const a=await get('seed=123&tags=action'),reads=tagReads,b=await get('seed=123&tags=action&offset=24');
 assert.equal(tagReads,reads);assert.equal(a.items.length,24);assert.equal(a.items.some(x=>b.items.some(y=>x.id===y.id)),false);
 assert.ok(a.items.every(x=>x.tags.includes('action')));
 const c=await get('seed=123&tags=romance');assert.ok(c.items.every(x=>x.tags.includes('romance')));
 const d=await get('seed=123&media='+encodeURIComponent('영화'));assert.ok(d.items.every(x=>x.media==='영화'));
 const e=await get('seed=123&media='+encodeURIComponent('영화')+'&q='+encodeURIComponent('무협 3'));assert.equal(e.items[0].title,'무협 3');assert.equal(e.items[0].media,'웹툰');
 const again=await get('seed=123&tags=action');assert.deepEqual(again.items.map(x=>x.id),a.items.map(x=>x.id));
});
test('DB 스냅샷 버전이 바뀌면 이전 목록과 태그 옵션 캐시를 버린다',async()=>{
 const catalog={works:[w(1)],dictionary:dict,loadedAt:'one'},options={loadCatalog:async()=>catalog};
 const get=async query=>(await(await handleTaste(new Request('http://localhost/api/taste?'+query),options)).json());
 assert.equal((await get('q='+encodeURIComponent('작품'))).items.length,1);
 assert.equal((await get('action=options')).facetsByMedia.웹툰.find(t=>t.tag_slug==='murim').count,1);
 catalog.works[0]=w(1,{title:'새 제목',tags:['romance']});catalog.loadedAt='two';
 assert.equal((await get('q='+encodeURIComponent('작품'))).items.length,0);
 assert.equal((await get('q='+encodeURIComponent('새 제목'))).items[0].title,'새 제목');
 assert.equal((await get('action=options')).facetsByMedia.웹툰.some(t=>t.tag_slug==='murim'),false);
});
const catalogEnv={SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
function catalogResponse(url,title='이전 작품'){
 const table=new URL(url).pathname.split('/').pop();
 return table==='contents'?Response.json([{id:900001,title,media:'웹툰',tag_slugs_cache:['action']}],{headers:{'content-range':'0-0/1'}}):Response.json(table==='tag_dictionary'?dict:[]);
}
test('공개 목록의 만료 후 60초 동안 한 번만 갱신하고 그 이후에는 최신 목록을 기다린다',async()=>{
 const load=createTasteCatalogLoader();let time=0,calls=0,release;
 const gate=new Promise(resolve=>release=resolve);
 const fetchImpl=async url=>{calls++;if(time>0)await gate;return catalogResponse(url,time?'새 작품':'이전 작품');};
 const options={env:catalogEnv,fetchImpl,now:()=>time,allowStale:true};
 const first=await load(options);assert.equal(first.works[0].title,'이전 작품');assert.equal(calls,3);
 time=300001;assert.equal(await load(options),first);assert.equal(calls,6);
 assert.equal(await load(options),first);assert.equal(calls,6);
 time=360001;let done=false;const latest=load(options).then(value=>{done=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.equal(calls,6);
 release();const next=await latest;assert.equal(next.works[0].title,'새 작품');assert.notEqual(next,first);assert.equal(await load(options),next);
});
test('백그라운드 갱신 실패는 처리하고 60초를 넘긴 오래된 목록은 계속 제공하지 않는다',async()=>{
 const load=createTasteCatalogLoader();let time=0,calls=0;
 const options={env:catalogEnv,now:()=>time,allowStale:true,fetchImpl:async url=>{calls++;if(time)throw new Error('network unavailable');return catalogResponse(url);}};
 const first=await load(options);time=300001;assert.equal(await load(options),first);
 await new Promise(resolve=>setImmediate(resolve));
 const failedCalls=calls;assert.equal(await load(options),first);assert.equal(calls,failedCalls);
 time=360001;await assert.rejects(load(options),/network unavailable/);
});
test('백그라운드 실행을 보장하지 않는 서버에서는 만료된 목록을 바로 반환하지 않는다',async()=>{
 const load=createTasteCatalogLoader();let time=0,release;
 const gate=new Promise(resolve=>release=resolve);
 const options={env:catalogEnv,now:()=>time,fetchImpl:async url=>{if(time)await gate;return catalogResponse(url,time?'새 작품':'이전 작품');}};
 await load(options);time=300001;let done=false;
 const next=load(options).then(value=>{done=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
 release();assert.equal((await next).works[0].title,'새 작품');
});
