import {themeById,matchesTheme} from './context.js';
import {createVisitContextLoader} from './context-session.js';
import {orderedItems,createRecommendationRequest} from './recommendation-client.js';
import {initAuth} from './auth.js';
import './taste-bridge.js';
import {initMyPage} from './my-page.js';
import {matchesSelectedTags,facetCounts,sortFacetLabels,PLATFORM_FILTERS,displayPlatforms} from './facets.js';
import {preparePopularLists,detailConnections,popularCoverSymbol,popularCoverItem} from './catalog-display.js';
import {readNavigation,writeNavigation} from './navigation.js';
import {loadFastCatalog,normalizeCatalogItem,safePublicURL,safeImageURL} from './catalog-client.js';
import {officialPlatformURL,installPlatformLinks} from './platform-links.js';
import './performance.js';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=safePublicURL;
const norm=v=>String(v||'').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g,'');
const getStorage=()=>{try{return globalThis.localStorage;}catch{return null;}},heroPageSize=()=>window.innerWidth<=600?1:window.innerWidth<=850?2:3;
const TYPES=['웹툰','웹소설','드라마·OTT','영화'];
const GROUPS=[{id:'genre',label:'장르'},{id:'setting',label:'소재·배경'},{id:'relationship',label:'인물·관계'}],actorRoles=new Set(['LEAD_ACTOR','SUPPORT_ACTOR']);
let items=[],byId=new Map(),taxonomy={groups:[]},popular={lists:[]},results=[],visibleCount=12,heroPage=0,heroItems=[],renderedHeroPageSize=heroPageSize(),toastTimer,previousFocus,popularTab='',visitContext=null,weatherContext=null,contextPromise=null;
let recommendations=null,baselineRecommendations=null,catalogVersion='',authGeneration=0,isSignedIn=false;
const homeRequest=createRecommendationRequest(),similarRequest=createRecommendationRequest(),visitLoader=createVisitContextLoader();
let myPage=null,disposeActivity=null;
let catalogMeta=null,catalogLoading=false,coverImages=[],currentWorkId=null;
let startupAnchor=location.hash==='#discover'?'discover':'';
const getSessionStorage=()=>{try{return globalThis.sessionStorage;}catch{return null;}};
const dialogStack=[];
const state={types:[],platforms:[],tags:{genre:[],setting:[],relationship:[]},query:'',sort:'taste',tab:'genre',expanded:false,theme:'',mode:'all',person:''};
const media=item=>['드라마','OTT'].includes(item.type)?'드라마·OTT':item.type, format=v=>Number(v).toLocaleString('ko-KR'), groupTags=(item,g)=>item.tagGroups?.[g]||[];
function uniqueIPs(list){const seen=new Set();return list.filter(item=>{const key=item.ipId||norm(item.title.replace(/\(소설\)$/,''));if(seen.has(key))return false;seen.add(key);return true;});}
function notify(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2600);}
function readLocation(historyState=history.state,restoreSession=true){const restored=readNavigation({href:location.href,historyState,storage:restoreSession?getSessionStorage():null});Object.assign(state,restored.filters);state.theme=themeById(state.theme)?.id||'';currentWorkId=restored.workId;}
function syncLocation(workId=null,replace=false){currentWorkId=workId;writeNavigation({filters:state,workId,history,location,storage:getSessionStorage(),replace});}
function image(item,className='cover-image',eager=false){const src=safeImageURL(item.image);return src?`<img class="${className}" src="${E(src)}" alt="${E(item.title)} 표지" loading="${eager?'eager':'lazy'}" decoding="async" ${className==='hero-art'?'fetchpriority="high"':''} referrerpolicy="no-referrer">`:'';}
function card(item,{badge='',tags=false,eager=false}={}){return `<article class="work-card" data-card-id="${item.id}"><button class="cover-button" data-work="${item.id}" aria-label="${E(item.title)} 상세 보기"><span class="cover-fallback" aria-hidden="true"><span class="fallback-mark">✦</span>${E(item.title)}</span>${image(item,'cover-image',eager)}<span class="cover-badge ${badge?'editor':''}">${E(badge||item.type)}</span></button><button class="card-title" data-work="${item.id}" title="${E(item.title)}">${E(item.title)}</button><p class="card-meta">${E(item.type)} · ${E(item.creators.slice(0,2).join(' / ')||item.genre||'')}</p>${tags?`<p class="card-tags">${item.tags.slice(0,2).map(t=>'#'+E(t)).join(' ')}</p>`:''}</article>`;}
function renderHero(){
  heroItems=(recommendations?.heroIds||[]).map(id=>byId.get(id)).filter(Boolean).slice(0,10);renderedHeroPageSize=heroPageSize();
  if(!heroItems.length)return;
  const pages=Math.max(1,Math.ceil(heroItems.length/renderedHeroPageSize));heroPage%=pages;
  const visible=heroItems.slice(heroPage*renderedHeroPageSize,(heroPage+1)*renderedHeroPageSize),existing=$$('#hero-grid .hero-card');
  const textFor=(item,index)=>({kicker:item.genre,title:item.title.replace(/\(소설\)$/,''),subtitle:index===0?(item.description||'').slice(0,72)+((item.description||'').length>72?'…':''):`${item.type} · ${item.genre}`});
  if(existing.length>=visible.length&&existing.slice(0,visible.length).every((element,index)=>Number(element.dataset.work)===visible[index].id&&$('.hero-art',element)?.getAttribute('src')===safeImageURL(visible[index].image))){
    existing.slice(0,visible.length).forEach((element,index)=>{const text=textFor(visible[index],index);for(const [selector,value]of [['.hero-kicker',text.kicker],['h2',text.title],['.hero-subtitle',text.subtitle]]){const target=$(selector,element);if(target.textContent!==value)target.textContent=value;}});
    existing.slice(visible.length).forEach(element=>element.remove());
  }else $('#hero-grid').innerHTML=visible.map((item,index)=>{const text=textFor(item,index);return `<button class="hero-card ${['featured','rose','teal'][index]}" data-work="${item.id}" aria-label="${E(item.title)} 상세 보기"><span class="hero-backdrop" aria-hidden="true">${image(item,'hero-backdrop-image',true)}</span><span class="hero-text"><span class="hero-kicker">${E(text.kicker)}</span><h2>${E(text.title)}</h2><span class="hero-subtitle">${E(text.subtitle)}</span><span class="hero-cta">작품 만나보기 <span class="arrow" aria-hidden="true">↗</span></span></span>${image(item,'hero-art',true)}</button>`;}).join('');
  $('#hero-page').innerHTML=`<b>${String(heroPage+1).padStart(2,'0')}</b> / ${String(pages).padStart(2,'0')}`;
}
function renderShelves(){$('#discovery-grid').innerHTML=(recommendations?.discoveryIds||[]).map(id=>byId.get(id)).filter(Boolean).slice(0,6).map(item=>card(item,{badge:'발견 PICK'})).join('');}
function baseCandidates(){return state.mode==='discovery'?(recommendations?.discoveryIds||[]).map(id=>byId.get(id)).filter(Boolean):items;}
function matches(item){
  if(item.adult===true)return false;
  if(state.types.length&&!state.types.includes(media(item)))return false;
  if(state.platforms.length&&!displayPlatforms(item).some(p=>state.platforms.includes(p.name)))return false;
  if(!matchesSelectedTags(item,state.tags))return false;
  if(state.theme&&!matchesTheme(item,themeById(state.theme)))return false;
  if(state.person&&!item.credits.some(c=>actorRoles.has(c.role)&&norm(c.name)===norm(state.person)))return false;
  return !state.query||item.searchText.includes(norm(state.query));
}
function chip(label,count,dimension,selected){const unavailable=count===0&&!selected;return `<button class="facet-chip ${selected?'active':''} ${count===0?'is-empty':''}" data-facet="${dimension}" data-value="${E(label)}" aria-pressed="${selected}" ${unavailable?'disabled':''} title="${E(label)} · ${format(count)}개 작품${unavailable?' · 다른 조건을 해제하면 선택할 수 있어요.':''}">${E(label)} <span class="facet-count">${format(count)}</span></button>`;}
function renderFilters(pool=baseCandidates()){
  if(!catalogMeta)return;
  const matchedItems=pool.filter(i=>matches(i));
  const counts=Object.fromEntries(GROUPS.map(g=>[g.id,facetCounts(g.id,matchedItems)]));
  $('#facet-tabs').innerHTML=GROUPS.map(g=>{return `<button role="tab" id="facet-tab-${g.id}" aria-controls="facet-tag-panel" aria-selected="${state.tab===g.id}" tabindex="${state.tab===g.id?0:-1}" data-tab="${g.id}">${g.label}${state.tags[g.id].length?`<b>${state.tags[g.id].length}</b>`:''}</button>`;}).join('');
  $('#facet-tag-panel').setAttribute('aria-labelledby',`facet-tab-${state.tab}`);
  const tags=sortFacetLabels((taxonomy.groups.find(g=>g.id===state.tab)?.tags||[]).map(tag=>tag.label),counts[state.tab]);
  $('#facet-chips').innerHTML=(state.expanded?tags:tags.slice(0,16)).map(label=>chip(label,counts[state.tab].get(label)||0,state.tab,state.tags[state.tab].includes(label))).join('');
  $('#facet-more').hidden=tags.length<=16;$('#facet-more').textContent=state.expanded?'접기':'더 보기';$('#facet-more').setAttribute('aria-expanded',String(state.expanded));
  const pc=facetCounts('platform',matchedItems);
  const platforms=sortFacetLabels(PLATFORM_FILTERS,pc);
  $('#platform-chips').innerHTML=platforms.map(t=>chip(t,pc.get(t)||0,'platform',state.platforms.includes(t))).join('');
  $('#search').value=state.query;$('#catalog-search').value=state.query;$('#sort').value=state.sort;
  $('#sort option[value="taste"]').textContent=state.mode==='discovery'?'발견픽 추천순':'취향순';
  const active=[...state.types.map(v=>['type',v]),...state.platforms.map(v=>['platform',v]),...GROUPS.flatMap(g=>state.tags[g.id].map(v=>[g.id,v])),...(state.query?[['query',state.query]]:[]),...(state.person?[['person',state.person+' 출연']]:[]),...(state.theme?[['theme',themeById(state.theme).title]]:[]),...(state.mode!=='all'?[['mode',state.mode==='discovery'?'발견픽':'몰입 추천']]:[])];
  $('#active-filters').innerHTML=active.map(([k,v])=>`<button data-clear="${k}" data-value="${E(v)}" aria-label="${E(v)} 필터 해제">${E(v)} <span>×</span></button>`).join('');$('#reset-filters').disabled=!active.length;$('#reset-filters').textContent=active.length?`필터 초기화 (${active.length}) ↺`:'필터 초기화 ↺';
  document.body.classList.toggle('filtered',Boolean(state.query||state.theme||state.person||state.mode!=='all'));
  $('#discover-title').textContent=state.theme?themeById(state.theme).title:state.person?`${state.person} 출연작`:state.query?`‘${state.query}’ 검색 결과`:state.mode==='discovery'?'발견픽 · 취향의 다음 장':state.mode==='immersive'?'한번 시작하면, 멈출 수 없는':'취향이 닿는 곳';
  $$('#media-tabs [data-media]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.media===(state.types[0]||'전체'))));
  $('#theme-banner').hidden=!state.theme&&!state.person;
  $('#theme-banner').textContent=state.theme?themeById(state.theme).description:state.person?'출연진 이름이 같은 작품입니다. 인물 식별 정보가 없는 경우 동명이인이 포함될 수 있어요.':'';
}
function renderResults(candidates=baseCandidates()){
  if(!catalogMeta)return;
  const pool=candidates.filter(i=>matches(i));
  results=state.sort==='latest'?[...pool].sort((a,b)=>(b.year||0)-(a.year||0)||a.id-b.id):state.sort==='title'?[...pool].sort((a,b)=>a.title.localeCompare(b.title,'ko')):state.mode==='discovery'?pool:orderedItems(pool,recommendations?.rankingIds);
  $('#results-count').textContent=results.length?'작품 목록을 업데이트했어요.':'검색 조건에 맞는 작품이 없어요.';
  $('#browse-grid').innerHTML=results.slice(0,visibleCount).map(i=>card(i,{tags:true,discovery:state.mode==='discovery'})).join('');
  $('#empty-state').hidden=!!results.length;$('#empty-state').innerHTML='<h3>아직 꼭 맞는 이야기를 찾지 못했어요</h3><p>키워드나 필터를 조금 넓혀보세요.</p><button class="primary-button" data-action="reset">필터 초기화</button>';
  $('#browse-next').hidden=visibleCount>=results.length;
}
function appendNextWorks(focus=false){
  if(!catalogMeta||visibleCount>=results.length)return;
  const previous=visibleCount;
  visibleCount=Math.min(visibleCount+12,results.length);
  $('#browse-grid').insertAdjacentHTML('beforeend',results.slice(previous,visibleCount).map(item=>card(item,{tags:true})).join(''));
  $('#browse-next').hidden=visibleCount>=results.length;
  $('#results-count').textContent='다음 작품을 불러왔어요.';
  if(focus)$$('#browse-grid .cover-button')[previous]?.focus({preventScroll:true});
}
function renderBrowsing(scroll=false){if(!catalogMeta){setCatalogStatus('화면은 바로 볼 수 있어요. 전체 검색을 준비하고 있습니다.');return;}const pool=baseCandidates();renderFilters(pool);renderResults(pool);if(scroll)$('#discover').scrollIntoView({behavior:'instant',block:'start'});}
function resetState(){Object.assign(state,{types:[],platforms:[],tags:{genre:[],setting:[],relationship:[]},query:'',sort:'taste',tab:'genre',theme:'',mode:'all',person:'',expanded:false});visibleCount=12;}
function goHome(){closeAllDialogs();resetState();startupAnchor='';heroPage=0;syncLocation();if(items.length)renderHero();renderBrowsing();$('#hero-title').focus({preventScroll:true});window.scrollTo({top:0,left:0,behavior:'instant'});}
function changeFilter(key,value){const values=key==='type'?state.types:key==='platform'?state.platforms:state.tags[key];const index=values.indexOf(value);if(index<0)values.push(value);else values.splice(index,1);visibleCount=12;syncLocation();renderBrowsing();}
function renderPopular(){
  const lists=popular.lists.filter(list=>list.status==='available'&&list.media!=='애니메이션');if(!lists.length){$('#popular-tabs').innerHTML='';$('#side-picks').innerHTML='<p class="storage-note">확인된 인기 작품을 준비하고 있어요.</p>';return;}
  const list=lists.find(entry=>entry.id===popularTab)||lists[0];popularTab=list.id;
  $('#popular-tabs').innerHTML=lists.map(entry=>`<button data-popular="${E(entry.id)}" aria-pressed="${entry.id===popularTab}">${E(entry.media)}</button>`).join('');
  $('#side-picks').innerHTML=list.entries.slice(0,5).map((entry,index)=>{const item=byId.get(entry.catalogId),title=entry.localizedTitle||entry.title,url=officialPlatformURL(entry.url),external=!item||!!entry.editionWarning,cover=popularCoverItem(entry,item);const content=`<span class="side-rank">${index+1}</span><span class="popular-cover">${cover?image(cover,''):`<span aria-hidden="true">${E(popularCoverSymbol(list.media,title))}</span>`}</span><span class="side-info"><strong>${E(title)}</strong><small>${external?'공식 플랫폼에서 확인 ↗':E(item.genre)}</small></span>`;return external?(url?`<a class="side-pick" data-platform-link="" href="${E(url)}" title="${E(entry.editionWarning?'시리즈 전체 공식 페이지로 이동합니다.':'공식 작품 페이지로 이동합니다.')}" target="_blank" rel="noopener noreferrer">${content}</a>`:''):`<button class="side-pick" data-work="${item.id}">${content}</button>`;}).join('')||'<p class="storage-note">비성인·비애니메이션 여부가 확인된 작품을 준비하고 있어요.</p>';
  const sourceURL=safeURL(list.sourceUrl);
  $('#popular-source').innerHTML=sourceURL?`<a href="${E(sourceURL)}" target="_blank" rel="noopener noreferrer">${E(list.sourceLabel)} ↗</a>`:E(list.sourceLabel);
}
function renderContext(){
  const theme=visitContext?.theme,box=$('.context-card');
  box.hidden=!theme;
  if(!theme)return;
  const preview=orderedItems(items.filter(item=>matchesTheme(item,theme)),recommendations?.rankingIds).slice(0,3);
  box.dataset.theme=theme.id;box.dataset.group=theme.group;
  $('#context-content').innerHTML=`<h3>${E(theme.title)}</h3><button type="button" class="context-card-button" data-action="theme" data-theme="${E(theme.id)}" aria-label="${E(theme.title)} 작품 보기"><span class="context-scene" aria-hidden="true"><span class="scene-orbit"></span><span class="scene-motif">${E(theme.icon||'✦')}</span><span class="scene-line"></span><span class="context-season-label">${E(theme.label)}</span></span><span class="context-preview" aria-hidden="true">${preview.map(item=>`<span class="context-work"><span class="context-cover">${image(item,'')||`<span>${E(item.title)}</span>`}</span><span class="context-work-title">${E(item.title)}</span></span>`).join('')}</span></button>${theme.group==='weather'?`<small class="context-footnote"><a href="${E(safeURL(weatherContext?.source?.url)||'https://www.met.no/')}" target="_blank" rel="noopener noreferrer">${E(weatherContext?.source?.name||'MET Norway')}</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></small>`:''}`;
}
async function prepareContext(){
  if(contextPromise)return contextPromise;
  contextPromise=(async()=>{
    const resolved=await visitLoader({items,storage:getStorage()});
    visitContext=resolved.choice;weatherContext=resolved.weather;
    renderContext();
  })();
  return contextPromise;
}
function openDialog(dialog){const current=$('dialog[open]');if(current===dialog){dialog.scrollTop=0;$('.dialog-close',dialog).focus();return;}if(current){dialogStack.push({dialog:current,focus:document.activeElement});current.close();}else previousFocus=document.activeElement;dialog.showModal();dialog.scrollTop=0;}
function closeDialog(dialog,updateURL=true){dialog.close();if(dialog.id==='detail-dialog'){disposeActivity?.();disposeActivity=null;}if(dialog.id==='detail-dialog'&&updateURL)syncLocation(null,true);const previous=dialogStack.pop();if(previous){previous.dialog.showModal();if(previous.focus?.isConnected)previous.focus.focus({preventScroll:true});}else if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
function closeAllDialogs(){disposeActivity?.();disposeActivity=null;dialogStack.length=0;$$('dialog[open]').forEach(d=>d.close());}
function detailShelf(title,list,note=''){return `<section class="detail-shelf"><h3>${E(title)}</h3>${note?`<p class="shelf-note">${E(note)}</p>`:''}${list.length?`<div class="related-grid">${list.slice(0,6).map(i=>card(i)).join('')}</div>`:'<p class="storage-note">현재 등록된 작품에서 확인할 수 있는 연결 정보가 없어요.</p>'}</section>`;}
function openDetail(id,updateURL=true){
  const item=byId.get(id);if(!item||item.adult===true){if(updateURL)notify('현재 표시할 수 없는 작품입니다.');return;}
  const links=displayPlatforms(item).filter(p=>officialPlatformURL(p.url)),screen=['영화','드라마','OTT','드라마·OTT'].includes(item.type),people=item.credits.filter(c=>screen?c.role==='DIRECTOR':['STORY_WRITER','LEAD_ARTIST','ORIGINAL_AUTHOR','ADAPTATION_WRITER'].includes(c.role));
  const {sameCreators:same,cast}=detailConnections(item,items);
  disposeActivity?.();disposeActivity=null;
  $('#detail-content').innerHTML=`<div class="detail-top"><div>${image(item,'detail-poster',true)||`<div class="detail-poster cover-fallback" style="position:relative">${E(item.title)}</div>`}</div><div class="detail-info"><div class="detail-type"><span>${E(item.type)}</span><span>·</span><span>${E(item.genre||'작품')}</span>${item.age!=null?`<span>·</span><span>${item.age===0?'전체 이용가':E(item.age)+'세 이상'}</span>`:''}</div><h2 class="detail-title" id="detail-title">${E(item.title)}</h2><p class="detail-meta">${E(people.map(c=>c.roleLabel+' '+c.name).join(' · ')||item.creators.slice(0,3).join(' · '))}${item.year?'<br>'+E(item.year)+'년 공개':''}</p><p class="detail-description">${E(item.description||'작품의 더 자세한 이야기는 공식 플랫폼에서 만나보세요.')}</p><div class="detail-actions">${links.length?`<a class="primary-button" data-platform-link="${E(links[0].name)}" href="${E(safeURL(links[0].url))}" target="_blank" rel="noopener noreferrer">공식 플랫폼에서 보기 ↗</a>`:''}</div></div></div><div class="detail-body"><div id="detail-activity"></div><div class="detail-tags">${item.tags.map(t=>`<button class="detail-tag" data-detail-tag="${E(t)}">#${E(t)}</button>`).join('')}</div><h3>어디서 볼 수 있나요?</h3><div class="platform-links">${links.map(p=>`<a class="platform-link" data-platform-link="${E(p.name)}" href="${E(safeURL(p.url))}" target="_blank" rel="noopener noreferrer">${E(p.name)}<span>↗</span></a>`).join('')||'<p class="storage-note">공식 감상처를 확인하고 있어요.</p>'}</div><p class="availability-note">감상 가능 여부와 이용 요금은 각 플랫폼에서 확인해주세요.</p><div id="similar-picks" aria-live="polite"></div>${same.length?detailShelf(screen?'같은 감독의 작품':'같은 작가·제작진의 작품',same.map(r=>r.item),[...new Set(same.flatMap(r=>r.matches.map(c=>c.name)))].join(' · ')):''}${screen&&cast.length?`<section class="detail-shelf"><h3>출연배우</h3>${cast.length?`<div class="cast-grid">${cast.map(c=>`<button class="cast-person" data-cast="${E(c.name)}"><span class="cast-avatar">${E(c.name.slice(0,1))}</span><span><strong>${E(c.name)}</strong><small>${E(c.roleLabel)} · 출연작 보기 ↗</small></span></button>`).join('')}</div>`:'<p class="storage-note">등록된 출연진 정보가 없어요.</p>'}</section>`:''}</div>`;
  disposeActivity=myPage?.mountActivityControls($('#detail-activity'),item);
  openDialog($('#detail-dialog'));if(updateURL)syncLocation(id);void loadSimilar(id);
}
function refreshRecommendations(){heroPage=0;renderHero();renderShelves();renderAudience();renderBrowsing();if(visitContext)renderContext();}
function renderAudience(){
  const sidebar=recommendations?.sidebar;
  $('#audience-title').textContent=sidebar?.label||'전체 인기 추천';
  $('#audience-note').textContent=sidebar?.note||'공식 플랫폼별 인기 순위에서 골랐어요.';
  $('#audience-picks').innerHTML=(recommendations?.sidebarIds||[]).map(id=>byId.get(id)).filter(Boolean).slice(0,5).map((item,index)=>`<button class="side-pick" data-work="${item.id}"><span class="side-rank">${index+1}</span><span class="popular-cover">${image(item,'')}</span><span class="side-info"><strong>${E(item.title)}</strong><small>${E(media(item))}</small></span></button>`).join('');
}
async function loadRecommendations(){
  if(!catalogVersion)return;
  try{
    const generation=authGeneration;
    let data=await homeRequest.load({catalogVersion});
    if(!data)return;
    let draft;try{draft=JSON.parse(localStorage.getItem('chalpick-taste-v17-pending'));}catch{}
    if(!isSignedIn&&draft?.version===17&&!draft.owner&&Date.now()-draft.createdAt<7*86400000){
      try{
        const response=await fetch('/api/taste?action=result',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Chalpick-Taste':'1'},body:JSON.stringify({...draft.submission,resultMedia:draft.preview?.media}),signal:AbortSignal.timeout(10000)});
        if(response.ok){const taste=await response.json();const ids=taste.recommendations.match.map(w=>w.id);const blocked=new Set(Object.keys(draft.submission.ratings).map(Number));if(ids.length)data={...data,heroIds:ids,discoveryIds:taste.recommendations.discover.map(w=>w.id),rankingIds:[...ids,...data.rankingIds.filter(id=>!ids.includes(id)&&!blocked.has(id))],personalized:true,fromTaste:true};}
      }catch{}
    }
    if(generation!==authGeneration)return;
    recommendations=data;refreshRecommendations();
    $('#hero-note').textContent=data.fromTaste?'방금 고른 작품과 취향으로 이어서 추천해요.':data.personalized?'유형별 취향을 바탕으로 고른 열 편이에요.':'아직 취향 정보가 없어 인기 작품부터 소개해요.';
    if(!data.fromTaste&&['unavailable','not_configured','unlinked'].includes(data.profileStatus))$('#hero-note').textContent='회원 취향이 연결되기 전에는 인기 작품을 소개해요.';
  }catch{
    $('#hero-note').textContent='추천 연결이 잠시 지연되어 준비된 작품을 보여드려요.';
  }
}
async function loadSimilar(id){
  const generation=authGeneration;
  try{
    const data=await similarRequest.load({catalogVersion,contentId:id});
    if(!data||generation!==authGeneration||currentWorkId!==id||!$('#detail-dialog').open)return;
    const list=data.similarIds.map(identifier=>byId.get(identifier)).filter(Boolean);
    if(list.length)$('#similar-picks').innerHTML=detailShelf('유사픽 · 이 이야기의 다음 장',list);
  }catch{}
}
function applySearch(value){resetState();state.query=value.trim().slice(0,200);syncLocation();renderBrowsing(true);}
document.addEventListener('click',event=>{
  const b=event.target.closest('button,a');if(!b)return;
  if(b.matches('a.brand[href="/"]')&&!event.defaultPrevented&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();goHome();return;}
  if(b.matches('a[href^="#"]')){const target=document.getElementById(b.getAttribute('href').slice(1));if(target){event.preventDefault();closeAllDialogs();syncLocation();target.scrollIntoView({behavior:'instant',block:'start'});return;}}
  if(b.dataset.work)return openDetail(Number(b.dataset.work));
  if(b.dataset.media){state.types=b.dataset.media==='전체'?[]:[b.dataset.media];visibleCount=12;syncLocation();renderBrowsing();$(`[data-media="${b.dataset.media}"]`).focus({preventScroll:true});return;}
  if(b.dataset.tab){state.tab=b.dataset.tab;state.expanded=false;syncLocation();renderFilters();$(`[data-tab="${state.tab}"]`).focus();return;}
  if(b.dataset.facet){changeFilter(b.dataset.facet,b.dataset.value);$$('[data-facet]').find(button=>button.dataset.facet===b.dataset.facet&&button.dataset.value===b.dataset.value)?.focus({preventScroll:true});return;}
  if(b.dataset.clear){const key=b.dataset.clear;if(['type','platform',...GROUPS.map(g=>g.id)].includes(key))return changeFilter(key,b.dataset.value);state[key]=key==='mode'?'all':'';visibleCount=12;syncLocation();return renderBrowsing();}
  if(b.dataset.popular){popularTab=b.dataset.popular;renderPopular();$$('[data-popular]').find(button=>button.dataset.popular===popularTab)?.focus({preventScroll:true});return;}
  if(b.dataset.theme){closeAllDialogs();resetState();state.theme=b.dataset.theme;syncLocation();return renderBrowsing(true);}
  if(b.dataset.detailTag){const label=b.dataset.detailTag,g=taxonomy.groups.find(g=>g.tags.some(t=>t.label===label));closeAllDialogs();resetState();if(g){state.tags[g.id]=[label];state.tab=g.id;}else state.query=label;syncLocation();return renderBrowsing(true);}
  if(b.dataset.cast){closeAllDialogs();resetState();state.person=b.dataset.cast;syncLocation();return renderBrowsing(true);}
  switch(b.dataset.action){
    case 'hero-prev':{const pages=Math.max(1,Math.ceil(heroItems.length/heroPageSize()));heroPage=(heroPage+pages-1)%pages;renderHero();break;}
    case 'hero-next':heroPage++;renderHero();break;
    case 'discovery-more':resetState();state.mode='discovery';syncLocation();renderBrowsing(true);break;
    case 'reset':resetState();syncLocation();renderBrowsing();break;
    case 'facet-more':state.expanded=!state.expanded;syncLocation();renderFilters();$('#facet-more').focus();break;
    case 'browse-next':appendNextWorks(true);break;
    case 'about':openDialog($('#about-dialog'));break;


    case 'close-dialog':closeDialog(b.closest('dialog'));break;
    case 'retry':loadCatalog();break;
  }
});
for(const [form,input]of [['search-form','search'],['catalog-search-form','catalog-search']]){$('#'+form).addEventListener('submit',e=>{e.preventDefault();applySearch($('#'+input).value);});$('#'+input).addEventListener('search',()=>{if(!$('#'+input).value&&state.query){state.query='';visibleCount=12;syncLocation();renderBrowsing();}});}
$('#sort').addEventListener('change',e=>{state.sort=e.target.value;visibleCount=12;syncLocation();renderBrowsing();});
$('#facet-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const index=GROUPS.findIndex(g=>g.id===state.tab);state.tab=GROUPS[e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3].id;state.expanded=false;syncLocation();renderFilters();$(`[data-tab="${state.tab}"]`).focus();});

document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement){e.target.classList.add('failed');e.target.setAttribute('aria-hidden','true');if(!e.target.classList.contains('cover-image'))e.target.style.visibility='hidden';}},true);
$$('dialog').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(d);}});d.addEventListener('cancel',e=>{e.preventDefault();closeDialog(d);});});
window.addEventListener('popstate',event=>{readLocation(event.state,false);const id=currentWorkId;syncLocation(id,true);visibleCount=12;if(items.length)renderBrowsing();if(id)openDetail(id,false);else closeAllDialogs();});
window.addEventListener('resize',()=>{const size=heroPageSize();if(items.length&&size!==renderedHeroPageSize){heroPage=Math.floor(heroPage*renderedHeroPageSize/size);renderHero();}});
function setCatalogStatus(message,error=false){const status=$('#catalog-status');if(!status)return;status.hidden=!message;status.classList.toggle('is-error',error);status.textContent=message;if(error){const button=document.createElement('button');button.dataset.action='retry';button.textContent='다시 불러오기';status.append(' ',button);}}
function searchableItem(item){const cover=coverImages.find(entry=>entry.id===item.id&&entry.source===item.image);return {...item,...(cover&&safeImageURL(cover.url)?{image:cover.url}:{}),searchText:norm([item.title,...item.creators,...item.credits.map(credit=>credit.name),...item.tags,...item.contextTags.map(tag=>themeById(tag)?.label||tag),item.description].join(' '))};}
function readBootstrap(){try{const value=JSON.parse($('#catalog-bootstrap')?.textContent||'null');if(value?.schemaVersion!==1||value.source!=='supabase'||!Array.isArray(value.items)||!Array.isArray(value.popular?.lists))return null;return value;}catch{return null;}}
async function loadCatalog(){
  if(catalogLoading)return;
  catalogLoading=true;document.documentElement.dataset.catalogState='loading';
  const bootstrap=readBootstrap();
  if(!catalogMeta&&bootstrap){coverImages=Array.isArray(bootstrap.coverImages)?bootstrap.coverImages:[];items=bootstrap.items.map(normalizeCatalogItem).filter(item=>item.adult!==true).map(searchableItem);byId=new Map(items.map(item=>[item.id,item]));popular=bootstrap.popular;baselineRecommendations=bootstrap.recommendations;recommendations=baselineRecommendations;catalogVersion=bootstrap.release?.hash||'';renderHero();renderAudience();}
  setCatalogStatus('추천은 바로 확인하세요. 전체 검색을 준비하고 있어요.');
  if(!bootstrap&&!catalogMeta){$('#results-count').textContent='작품 검색 자료를 불러오고 있어요';$('#empty-state').hidden=true;}
  const rankingsReady=bootstrap?Promise.resolve(bootstrap.popular):(async()=>{try{const response=await fetch('/data/popular.json',{signal:AbortSignal.timeout(5000)});return response.ok?await response.json():{lists:[]};}catch{return {lists:[]};}})();
  try{
    const data=await loadFastCatalog({release:bootstrap?.release});
    items=data.items.map(searchableItem);byId=new Map(items.map(item=>[item.id,item]));taxonomy=data.taxonomy;catalogMeta=data.meta;
    popular=preparePopularLists(popular,items);renderHero();renderShelves();renderAudience();renderBrowsing();renderPopular();
    void prepareContext();void loadRecommendations();
    setCatalogStatus('');document.documentElement.dataset.catalogState='ready';document.documentElement.dataset.catalogReadyMs=String(Math.round(performance.now()));
    if(currentWorkId)openDetail(currentWorkId,false);
    if(startupAnchor)document.getElementById(startupAnchor)?.scrollIntoView({behavior:'instant',block:'start'});
    void rankingsReady.then(rankings=>{if(Array.isArray(rankings?.lists)){popular=preparePopularLists(rankings,items);renderPopular();}});
  }catch(error){
    console.error('찰픽 전체 작품 검색 자료를 불러오지 못했습니다.',error);document.documentElement.dataset.catalogState='error';
    setCatalogStatus('전체 검색을 연결하지 못했어요. 잠시 후 다시 시도해주세요.',true);
    if(!bootstrap&&!catalogMeta){$('#results-count').textContent='전체 작품 검색을 연결하지 못했어요';$('#empty-state').hidden=false;$('#empty-state').innerHTML='<h3>작품 검색 자료를 불러오지 못했어요</h3><p>네트워크 연결을 확인한 뒤 다시 시도해주세요.</p><button class="primary-button" data-action="retry">다시 불러오기</button>';}
  }finally{catalogLoading=false;}
}
installPlatformLinks(document);
document.addEventListener('chalpick:authchange',e=>{isSignedIn=Boolean(e.detail?.authenticated);authGeneration++;homeRequest.invalidate();similarRequest.invalidate();recommendations=baselineRecommendations;if(items.length)refreshRecommendations();if($('#detail-dialog').open)$('#similar-picks')?.replaceChildren();if(catalogMeta){void loadRecommendations();if(currentWorkId)void loadSimilar(currentWorkId);}});
document.addEventListener('chalpick:taste-saved',()=>{homeRequest.invalidate();similarRequest.invalidate();void loadRecommendations();if(currentWorkId)void loadSimilar(currentWorkId);});
document.addEventListener('chalpick:activitychange',()=>{homeRequest.invalidate();similarRequest.invalidate();void loadRecommendations();if(currentWorkId)void loadSimilar(currentWorkId);});
myPage=initMyPage({getWork:id=>byId.get(Number(id)),onOpenWork:id=>openDetail(Number(id))});
initAuth();readLocation();syncLocation(currentWorkId,true);loadCatalog();

document.addEventListener('chalpick:taste-cleared',()=>{authGeneration++;homeRequest.invalidate();recommendations=baselineRecommendations;if(items.length)refreshRecommendations();void loadRecommendations();});
