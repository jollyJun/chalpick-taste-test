import {MEDIA,AXES,GROUPS,profiles} from './core.mjs';
import {AVOID_TAGS} from './avoid-tags.mjs';
const KEY='chalpick-taste-v19-draft',PENDING='chalpick-taste-v17-pending';
const app=document.getElementById('app'),toast=document.getElementById('toast');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=m=>m==='OTT'?'드라마·OTT':m;
const fresh=()=>({version:19,stage:'media',media:[],tags:[],ratings:{},works:{},preferences:{},confirmed:{},answers:{},seed:Math.floor(Math.random()*2e9)+1,requestId:crypto.randomUUID(),resultMedia:null,pivot:null,reviewSelection:false});
const mediaText=()=>state.media.length?state.media.map(label).join(' · '):'모든 분야';
let optionsData,optionsTask;
async function preloadOptions(){if(optionsData)return optionsData;if(optionsTask)return optionsTask;optionsTask=fetch('/api/taste?action=options').then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{optionsData=d;return d;}).finally(()=>optionsTask=null);return optionsTask;}
let state=fresh(),catalog=null,result=null,mode='match',query='',offset=0,loading=false,sequence=0,timer,expanded={},abort;
const url=new URL(location.href);
if(url.searchParams.has('start')){localStorage.removeItem(KEY);url.searchParams.delete('start');history.replaceState(null,'',url);}
else {try{const s=JSON.parse(localStorage.getItem(KEY));if(s?.version===19&&['media','tags','works','preferences','result'].includes(s.stage)&&s.ratings&&s.works)state={...fresh(),...s};}catch{}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{notify('브라우저 저장 공간이 부족해요. 이 화면을 닫기 전에 결과를 저장해주세요.');}}
function notify(text,center=false){toast.classList.toggle('center',center);toast.textContent=text;clearTimeout(timer);timer=setTimeout(()=>toast.textContent='',4000);}
const liked=()=>Object.entries(state.ratings).filter(([,r])=>r==='LIKE').map(([id])=>state.works[id]).filter(Boolean);
const selectedMedia=()=>MEDIA.filter(m=>liked().some(w=>w.media===m));
function steps(n){return '<div class="steps" aria-label="총 4단계 중 '+n+'단계">'+[1,2,3,4].map(i=>'<i class="'+(i<=n?'on':'')+'"></i>').join('')+' '+n+' / 4</div>';}
function move(stage){state.stage=stage;save();render();window.scrollTo({top:0,behavior:'smooth'});}
function button(text,action,extra='',cls=''){return '<button type="button" class="'+cls+'" data-action="'+action+'" '+extra+'>'+text+'</button>';}
function actions(next,text,disabled=false){return '<div class="actions">'+button('이전','back','','back')+button(text,next,disabled?'disabled':'','primary')+'</div>';}
async function api(action,body){const r=await fetch('/api/taste?action='+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Chalpick-Taste':'1'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}
function render(){
 if(state.stage==='media'){
  const art={ '전체':['✦','모든 이야기에 열려 있어요'], '웹툰':['▧','한 컷씩 빠져드는 즐거움'], '웹소설':['≋','상상으로 펼쳐지는 세계'], 'OTT':['▷','다음 화가 궁금한 순간'], '영화':['◉','한 편으로 오래 남는 여운'] };
  app.innerHTML='<section class="intro">'+steps(1)+'<div class="intro-heading"><div><h1>어떤 분야를<br>좋아하세요?</h1><p class="muted">좋아하는 분야를 모두 골라주세요.</p></div><div class="story-art" aria-hidden="true"><span class="art-orbit"></span><img class="art-card art-one" src="/taste/assets/taste-cards/type-12.webp" alt=""><img class="art-card art-two" src="/taste/assets/taste-cards/type-01.webp" alt=""><span class="art-star">✦</span></div></div><div class="media-grid">'+['전체',...MEDIA].map((m,i)=>{const on=m==='전체'?!state.media.length:state.media.includes(m);return button('<span class="media-art media-art-'+i+'" aria-hidden="true">'+art[m][0]+'</span><span class="media-copy"><strong>'+label(m)+'</strong><small>'+art[m][1]+'</small></span><span class="media-tick" aria-hidden="true">'+(on?'✓':'+')+'</span>','media','data-media="'+m+'" aria-pressed="'+on+'"',on?'chosen':'');}).join('')+'</div><div class="actions">'+button('취향 태그 고르기 <span aria-hidden="true">→</span>','to-tags',optionsData?'':'disabled','primary wide')+'</div></section>';
  preloadOptions().then(()=>{const next=app.querySelector('[data-action=to-tags]');if(next)next.disabled=false;}).catch(()=>{const next=app.querySelector('[data-action=to-tags]');if(next){next.disabled=false;next.textContent='태그 다시 불러오기 →';}});
 }else if(state.stage==='tags'){
  app.innerHTML=steps(2)+'<div class="tag-heading"><h1>어떤 이야기가 끌리세요?</h1><p class="muted">'+mediaText()+' · 끌리는 만큼 골라주세요.</p></div><div class="tag-toolbar"><span id="tag-selection">선택한 태그</span>'+button('초기화','clear-tags','','text-button')+'</div><div id="tags-body"><div class="loading">태그를 준비하고 있어요.</div></div>'+actions('to-works','이제 작품 고르기 →');
  if(optionsData)renderTags();else preloadOptions().then(()=>{if(state.stage==='tags')renderTags();}).catch(()=>{if(state.stage==='tags')document.getElementById('tags-body').innerHTML='<p class="empty">태그를 불러오지 못했어요. '+button('다시 시도','retry-tags')+'</p>';});
 }else if(state.stage==='works'){
  app.innerHTML=steps(3)+'<h1 id="works-top">재미있게 본 작품을 골라주세요</h1><p class="muted">'+mediaText()+'<span id="count"></span></p><div id="selected"></div><div id="works-browse"><label for="search" class="small">작품 검색</label><input class="search" id="search" type="search" placeholder="전체 분야에서 작품 제목 검색" autocomplete="off"><p class="search-note">찾는 작품이 없나요? 검색하면 모든 분야에서 찾아드려요.</p><div id="grid" class="work-grid"></div><div id="page-actions"></div></div><div class="sticky"><p id="selection-hint"></p>'+button('다음','to-preferences','','primary')+'</div><dialog id="selection-dialog" class="selection-dialog" aria-labelledby="selection-dialog-title"><span class="dialog-check" aria-hidden="true">✓</span><h2 id="selection-dialog-title">다음으로 이동하시겠습니까?</h2><p>좋아하는 작품 10편을 모두 골랐어요.</p><div class="dialog-actions">'+button('다음으로 이동','to-preferences','','primary')+button('좋아하는 작품 다시 고르기','review-selection')+'</div></dialog>';
  const search=document.getElementById('search');search.value=query;
  let composing=false,searchTimer;
  const searchNow=()=>{query=search.value;offset=0;clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadCatalog(),180);};
  search.addEventListener('compositionstart',()=>composing=true);search.addEventListener('compositionend',()=>{composing=false;searchNow();});search.addEventListener('input',e=>{if(!composing&&!e.isComposing)searchNow();});
  document.getElementById('selection-dialog').addEventListener('cancel',e=>{e.preventDefault();reviewSelected();});
  updateSelection();loadCatalog();if(liked().length===10&&!state.reviewSelection)showSelectionPrompt();
 }else if(state.stage==='preferences')renderPreferences();
 else if(state.stage==='result'){app.innerHTML='<div class="loading">취향을 정리하고 있어요.</div>';loadResult();}
}
const pageCache=new Map();
function catalogParams(page=offset){return new URLSearchParams({media:state.media.join(',')||'전체',tags:state.tags.join(','),q:query,offset:String(page),seed:String(state.seed)});}
function fetchPage(params){
 const key=params.toString(),existing=pageCache.get(key);
 if(existing&&Date.now()-existing.at<120000){pageCache.delete(key);pageCache.set(key,existing);return existing.promise;}
 const entry={at:Date.now()};entry.promise=fetch('/api/taste?'+params).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}).catch(e=>{if(pageCache.get(key)===entry)pageCache.delete(key);throw e;});
 pageCache.set(key,entry);while(pageCache.size>6)pageCache.delete(pageCache.keys().next().value);return entry.promise;
}
function prefetchNext(data,params){
 if(data.nextOffset==null)return;
 const next=new URLSearchParams(params);next.set('offset',String(data.nextOffset));
 fetchPage(next).then(d=>{for(const w of d.items.slice(0,8)){if(w.image){const img=new Image();img.referrerPolicy='no-referrer';img.src=w.image;}}}).catch(()=>{});
}
async function loadCatalog(){
 const seq=++sequence;loading=true;const params=catalogParams();
 const refresh=app.querySelector('[data-action="refresh"]');if(refresh){refresh.disabled=true;refresh.textContent='작품을 준비하고 있어요…';}
 try{
  const d=await fetchPage(params);if(seq!==sequence||state.stage!=='works')return;catalog=d;
  const keep=new Set([...Object.keys(state.ratings),...d.items.map(w=>String(w.id))]);
  for(const id of Object.keys(state.works))if(!keep.has(id))delete state.works[id];
  for(const w of d.items)state.works[w.id]=w;
  renderGrid();save();prefetchNext(d,params);
 }catch(e){if(seq!==sequence)return;const target=document.getElementById('grid');if(target)target.innerHTML='<div class="empty error">작품을 불러오지 못했어요. '+button('다시 시도','retry')+'</div>';}
 finally{if(seq===sequence){loading=false;if(refresh?.isConnected){refresh.disabled=false;refresh.textContent='↻ 작품 새로고침';}}}
}
function renderTags(){
 const root=document.getElementById('tags-body');if(!root||!optionsData)return;
 const rows=state.media.length?optionsData.dictionary.filter(t=>state.media.some(m=>optionsData.facetsByMedia[m].some(f=>f.tag_slug===t.tag_slug))):optionsData.facetsByMedia['전체'];
 const counts=new Map();for(const m of state.media.length?state.media:['전체'])for(const t of optionsData.facetsByMedia[m])counts.set(t.tag_slug,(counts.get(t.tag_slug)||0)+t.count);rows.sort((a,b)=>(counts.get(b.tag_slug)||0)-(counts.get(a.tag_slug)||0));
 root.innerHTML=Object.entries(GROUPS).map(([key,name],index)=>{
  const group=rows.filter(t=>t.category===key),shown=expanded[key]?group:group.slice(0,14),selected=state.tags.filter(t=>!shown.some(r=>r.tag_slug===t)).map(t=>optionsData.dictionary.find(r=>r.tag_slug===t)).filter(t=>t?.category===key);
  return '<section class="panel tag-panel"><div class="tag-panel-heading"><span class="category-icon" aria-hidden="true">'+['✦','⌂','♡'][index]+'</span><h2>'+name+'</h2></div><div class="chips">'+[...shown,...selected].map(t=>button(esc(t.display_name),'tag','data-slug="'+t.tag_slug+'" aria-pressed="'+state.tags.includes(t.tag_slug)+'"')).join('')+'</div>'+(group.length>14?button(expanded[key]?'접기':'태그 더 보기 +','expand','data-group="'+key+'"','text-button'):'')+'</section>';
 }).join('');
 document.getElementById('tag-selection').textContent=state.tags.length?'선택한 태그 '+state.tags.length+'개':'마음에 드는 태그를 골라보세요';
}

function cover(w,interactive=true){
 const selected=state.ratings[w.id]==='LIKE';
 const image=w.image?'<img src="'+esc(w.image)+'" alt="'+esc(w.title)+' 표지" loading="lazy" referrerpolicy="no-referrer"><span class="fallback" hidden>'+esc(w.title)+'</span>':'<span class="fallback">'+esc(w.title)+'</span>';
 return '<article class="work" data-id="'+w.id+'">'+(interactive?'<button type="button" class="cover-button '+(selected?'selected':'')+'" data-action="like" data-id="'+w.id+'" aria-label="'+esc(w.title)+(selected?' 선택 취소':' 좋아요')+'" aria-pressed="'+selected+'">':'<div class="cover-button">')+image+(interactive?'<span class="check">'+(selected?'✓':'+')+'</span></button>':'</div>')+'<div class="meta"><span>'+label(w.media)+'</span>'+(w.year?'<span> · '+w.year+'</span>':'')+'</div><h3>'+esc(w.title)+'</h3>'+(!interactive?'<p class="reason">'+esc(w.reason)+'</p>':'')+'</article>';
}
function renderGrid(){
 const root=document.getElementById('grid');if(!root||!catalog)return;
 root.innerHTML=catalog.items.length?catalog.items.map(w=>cover(w)).join(''):'<div class="empty">조건에 맞는 작품이 없어요. '+button('태그 다시 고르기','edit-tags')+'</div>';
 document.getElementById('count').textContent=query?' · 전체 분야 검색 결과 '+catalog.total.toLocaleString()+'편':state.tags.length?' · 고른 태그가 많이 겹치는 작품부터':' · 다양한 이야기부터';
 document.getElementById('page-actions').innerHTML=catalog.total>24?button('↻ 작품 새로고침','refresh','','refresh'):'';updateSelection();
}
function updateSelection(){
 const n=liked().length,summary=document.getElementById('selected');if(!summary)return;
 summary.innerHTML='<section class="selection-summary '+(state.reviewSelection?'reviewing':'')+'" tabindex="-1" aria-label="고른 작품"><div class="selection-heading"><strong>고른 작품 <span>'+n+' / 10</span></strong><small>누르면 선택을 취소해요</small></div><div class="chips">'+liked().map(w=>button(esc(w.title)+' ×','like','data-id="'+w.id+'"')).join('')+(n?'':'<p class="selection-empty">아래에서 재미있게 본 작품을 골라주세요.</p>')+'</div></section>';
 document.getElementById('selection-hint').textContent=n<5?'5편부터 결과를 볼 수 있어요.':n<10?'5편으로도 충분해요. 10편이면 취향이 더 또렷해져요.':'10편을 골랐어요. 취향을 확인해볼까요?';
 for(const next of app.querySelectorAll('[data-action="to-preferences"]'))next.disabled=n<5;
 const browse=document.getElementById('works-browse');if(browse){browse.inert=n===10;browse.classList.toggle('selection-locked',n===10);}
 if(n===10&&state.reviewSelection)document.getElementById('selection-hint').textContent='고른 작품을 하나 빼면 다른 작품을 고를 수 있어요.';
}
function showSelectionPrompt(){const dialog=document.getElementById('selection-dialog');if(dialog&&!dialog.open)dialog.showModal();}
function reviewSelected(){
 document.getElementById('selection-dialog')?.close();state.reviewSelection=true;save();updateSelection();
 const selected=app.querySelector('.selection-summary');selected?.focus({preventScroll:true});selected?.scrollIntoView({behavior:'smooth',block:'center'});
}
function toggleRating(id,rating){
 const before=liked().length;
 if(rating!=='LIKE')return;
 if(state.ratings[id]!=='LIKE'&&before>=10){showSelectionPrompt();return;}
 if(state.ratings[id]===rating)delete state.ratings[id];else state.ratings[id]=rating;
 state.reviewSelection=false;state.requestId=crypto.randomUUID();state.confirmed={};result=null;save();
 for(const b of app.querySelectorAll('.cover-button[data-action="like"]')){const id=Number(b.dataset.id),on=state.ratings[id]==='LIKE';b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',state.works[id].title+(on?' 선택 취소':' 좋아요'));b.querySelector('.check').textContent=on?'✓':'+';}
 updateSelection();if(before<10&&liked().length===10)showSelectionPrompt();
}
function renderPreferences(){
 const dict=optionsData?.dictionary||catalog?.dictionary||[], selected=liked(), byMedia=profiles(Object.values(state.works),state.ratings,dict);
 app.innerHTML=steps(4)+'<h1>좋아하는 이야기와<br>피하고 싶은 내용을 골라주세요</h1><p class="muted">특별한 선호가 없다면 바로 결과를 확인해도 좋아요.</p>'+selectedMedia().map(media=>{
  const p=byMedia[media],pref=state.preferences[media]||={liked:[],excluded:[]};
  return '<section class="panel"><h2>'+label(media)+'</h2>'+[['liked','이런 이야기가 좋아요',p.liked_tag_counts],['excluded','이런 내용은 피하고 싶어요',p.disliked_tag_counts]].map(([kind,title,counts])=>{
   const suggestions=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]);
   const source=kind==='excluded'?AVOID_TAGS.filter(slug=>dict.some(t=>t.tag_slug===slug)):suggestions;
   const slugs=[...new Set([...source.slice(0,12),...pref[kind]])];
   return '<div class="pref-group"><h2>'+title+'</h2><div class="chips">'+slugs.map(slug=>button(esc(dict.find(t=>t.tag_slug===slug)?.display_name||slug),'preference','data-media="'+media+'" data-kind="'+kind+'" data-slug="'+slug+'" aria-pressed="'+pref[kind].includes(slug)+'"')).join('')+'</div>'+button('특별히 없어요','none','data-media="'+media+'" data-kind="'+kind+'" aria-pressed="'+Boolean(state.confirmed[media+kind]&&pref[kind].length===0)+'"','none '+(state.confirmed[media+kind]&&pref[kind].length===0?'chosen':''))+'</div>';
  }).join('')+'</section>';
 }).join('')+actions('to-result','내 취향 보기');
}
async function loadResult(){
 const seq=++sequence;
 try{const d=await api('result',{requestId:state.requestId,ratings:state.ratings,preferences:state.preferences,pivot:state.pivot||liked()[0]?.id,resultMedia:state.resultMedia||selectedMedia()[0]});if(seq!==sequence)return;result=d;state.resultMedia=selectedMedia().includes(state.resultMedia)?state.resultMedia:selectedMedia()[0];renderResult();save();}
 catch{if(seq===sequence)app.innerHTML='<div class="empty error">결과를 불러오지 못했어요. '+button('다시 시도','retry-result')+'</div>';}
}
function renderResult(){
 const media=state.resultMedia,p=result.profiles[media],answers=state.answers[media]||{},bits=AXES.map(k=>p?.[k]===null||p?.[k]===undefined?answers[k]??null:Number(p[k]>=(['tempo','mood'].includes(k)?55:50)));
 const type=bits.includes(null)?null:window.CHALPICK_TYPES[bits.reduce((n,b)=>n*2+b,0)];
 const axisLabels={tempo:['천천히 쌓이는 이야기','빠르게 전개되는 이야기'],mood:['밝고 가벼운 분위기','진지하고 묵직한 분위기'],resolve:['여운이 남는 흐름','시원하게 풀리는 흐름'],unusual:['익숙한 일상','낯선 세계']};
 app.innerHTML='<p class="muted">나의 이야기 취향</p><h1>'+esc(type?.label||label(media)+' 취향')+'</h1><div class="tabs">'+selectedMedia().map(m=>button(label(m),'result-media','data-media="'+m+'" aria-selected="'+(m===media)+'"')).join('')+'</div><div class="result-layout"><div>'+(type?'<img class="taste-card" src="/taste/'+type.card+'" alt="'+esc(type.label)+' 취향 카드">':'<section class="panel"><h2>카드 완성하기</h2><p class="muted">작품 정보만으로 알기 어려운 부분이에요.</p>'+AXES.filter((k,i)=>bits[i]===null).map(k=>'<div class="missing-axis">'+axisLabels[k].map((text,i)=>button(text,'axis','data-axis="'+k+'" data-bit="'+i+'"')).join('')+'</div>').join('')+'</section>')+'</div><section><div class="tabs">'+[['match','찰떡픽'],['similar','유사픽'],['discover','발견픽']].map(([key,text])=>button(text,'mode','data-mode="'+key+'" aria-selected="'+(mode===key)+'"')).join('')+'</div>'+(mode==='similar'?'<p><label for="pivot">기준 작품 </label><select id="pivot">'+liked().filter(w=>w.media===media).map(w=>'<option value="'+w.id+'" '+(Number(state.pivot)===w.id?'selected':'')+'>'+esc(w.title)+'</option>').join('')+'</select></p>':'')+'<div class="work-grid">'+(result.recommendations[mode].filter(w=>w.media===media).map(w=>cover(w,false)).join('')||'<p class="empty">현재 조건에서 충분히 가까운 작품을 찾지 못했어요.</p>')+'</div></section></div><div class="result-actions">'+(type?button('이미지 저장','download'):'')+button('테스트 공유하기','share')+button('찰픽에서 더 살펴보기','finish','','primary')+'</div>'+(location.hostname==='127.0.0.1'||location.hostname==='localhost'?'<p class="preview-note">이 컴퓨터에서 확인하는 미리보기입니다.</p>':'')+'<div class="actions">'+button('선호·제외 수정','edit-preferences','','text-button')+button('고른 작품 수정','edit-works','','text-button')+'</div>';
 document.getElementById('pivot')?.addEventListener('change',e=>{state.pivot=Number(e.target.value);loadResult();});
}
app.addEventListener('error',e=>{if(e.target.tagName==='IMG'&&e.target.closest('.cover-button')){e.target.hidden=true;const fallback=e.target.nextElementSibling;if(fallback)fallback.hidden=false;}},true);
app.addEventListener('click',async e=>{
 const b=e.target.closest('button[data-action]');if(!b||b.disabled)return;const a=b.dataset.action;
 if(a==='media'){const m=b.dataset.media;state.media=m==='전체'?[]:state.media.includes(m)?state.media.filter(x=>x!==m):[...state.media,m];if(state.media.length===4)state.media=[];offset=0;save();render();}
 else if(a==='to-tags'||a==='edit-tags')move('tags');
 else if(a==='tag'){const t=b.dataset.slug;if(!state.tags.includes(t)&&state.tags.length>=30){notify('태그는 30개까지 고를 수 있어요.');return;}state.tags=state.tags.includes(t)?state.tags.filter(x=>x!==t):[...state.tags,t];offset=0;save();renderTags();}
 else if(a==='clear-tags'){state.tags=[];save();renderTags();}
 else if(a==='retry-tags'){move('tags');}
 else if(a==='expand'){expanded[b.dataset.group]=!expanded[b.dataset.group];renderTags();}
 else if(a==='to-works'){offset=0;query='';move('works');}
 else if(a==='retry')loadCatalog(state.stage==='tags');
 else if(a==='like')toggleRating(Number(b.dataset.id),'LIKE');
 else if(a==='review-selection')reviewSelected();
 else if(a==='refresh'){if(loading)return;offset=catalog.nextOffset??0;await loadCatalog();document.getElementById('works-top')?.scrollIntoView({behavior:'smooth',block:'start'});}
 else if(a==='to-preferences'){if(liked().length>=5)move('preferences');}
 else if(a==='preference'||a==='none'){
  const {media,kind,slug}=b.dataset,pref=state.preferences[media];
  pref[kind]=a==='none'?[]:pref[kind].includes(slug)?pref[kind].filter(t=>t!==slug):[...pref[kind],slug];
  if(slug)pref[kind==='liked'?'excluded':'liked']=pref[kind==='liked'?'excluded':'liked'].filter(t=>t!==slug);
  state.confirmed[media+kind]=true;state.requestId=crypto.randomUUID();save();renderPreferences();
 }else if(a==='to-result'){for(const m of selectedMedia()){const pref=state.preferences[m]||={liked:[],excluded:[]};for(const kind of ['liked','excluded']){if(!state.confirmed[m+kind]&&!pref[kind]?.length)pref[kind]=[];state.confirmed[m+kind]=true;}}state.pivot=liked()[0]?.id;move('result');}
 else if(a==='retry-result')loadResult();
 else if(a==='result-media'){state.resultMedia=b.dataset.media;state.pivot=liked().find(w=>w.media===state.resultMedia)?.id;loadResult();}
 else if(a==='mode'){mode=b.dataset.mode;renderResult();}
 else if(a==='axis'){(state.answers[state.resultMedia]||={})[b.dataset.axis]=Number(b.dataset.bit);save();renderResult();}
 else if(a==='share'){
  const link=new URL('/taste/?start=1',location.origin).href;
  try{await navigator.clipboard.writeText(link);notify('공유 링크를 복사했어요.',true);}catch{notify('주소를 복사해주세요: '+link,true);}
 }else if(a==='download'){await downloadCard(b);
 }else if(a==='finish'){
  b.disabled=true;
  try{await preloadOptions();}catch{b.disabled=false;notify('취향 정보를 준비하지 못했어요. 다시 눌러주세요.');return;}
  const pending={version:17,createdAt:Date.now(),preview:{media:state.resultMedia,selected:liked().map(w=>({id:w.id,title:w.title,media:w.media})),recommendations:result.recommendations.match.map(w=>({id:w.id,title:w.title})),tagLabels:Object.values(state.preferences).flatMap(p=>[...p.liked,...p.excluded]).map(t=>({slug:t,label:(optionsData?.dictionary||catalog?.dictionary||[]).find(d=>d.tag_slug===t)?.display_name||t}))},submission:{requestId:state.requestId,ratings:state.ratings,preferences:state.preferences,conflictPolicy:'preserve'}};
  try{localStorage.setItem(PENDING,JSON.stringify(pending));location.assign('/?taste=save');}catch{b.disabled=false;notify('결과를 임시 저장하지 못했어요. 브라우저 저장 설정을 확인해주세요.');}
 }else if(a==='edit-preferences')move('preferences');else if(a==='edit-works'){state.reviewSelection=liked().length===10;move('works');}
 else if(a==='back'){if(state.stage==='tags')move('media');else if(state.stage==='works')move('tags');else move('works');}
});
if(['preferences','result'].includes(state.stage)&&liked().length<5)state.stage='works';
// Restored preferences require current dictionary; old demo IDs are never imported.
async function downloadCard(button){const img=app.querySelector('.taste-card');if(!img)return;button.disabled=true;try{await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.90));if(!blob)throw new Error();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='찰픽_'+img.alt.replace(' 취향 카드','')+'.jpg';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);notify('취향 카드 이미지를 저장했어요.');}catch{notify('이미지를 저장하지 못했어요. 다시 시도해주세요.');}finally{button.disabled=false;}}
if(state.stage==='preferences'){await preloadOptions().then(()=>{const next=app.querySelector('[data-action=to-tags]');if(next)next.disabled=false;}).catch(()=>{const next=app.querySelector('[data-action=to-tags]');if(next){next.disabled=false;next.textContent='태그 다시 불러오기 →';}});render();}else render();
