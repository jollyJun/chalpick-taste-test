import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {recommendHome} from '../server/recommendation-engine.mjs';
import {facetCounts,sortFacetLabels,PLATFORM_FILTERS} from '../public/facets.js';
import {preparePopularLists,popularCoverSymbol,popularCoverItem} from '../public/catalog-display.js';
import {safePublicURL} from '../public/catalog-client.js';

const GROUPS=[{id:'genre',label:'장르'},{id:'setting',label:'소재·배경'},{id:'relationship',label:'인물·관계'}];
const LOCAL_COVER=/^\/assets\/covers\/[a-f0-9]{16,64}\.webp$/;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g,'');
const eligible=item=>item.adult!==true&&!(item.age!=null&&Number(item.age)>=18)&&item.type!=='애니메이션';
const safeImage=value=>LOCAL_COVER.test(value||'')?value:safePublicURL(value);

export function serializeBootstrap(value){
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,character=>({'<':'\\u003c','>':'\\u003e','&':'\\u0026','\u2028':'\\u2028','\u2029':'\\u2029'}[character]));
}

function replaceRegion(html,name,value){
  const opening=`<!-- prerender:${name}:start -->`,closing=`<!-- prerender:${name}:end -->`;
  const start=html.indexOf(opening),end=html.indexOf(closing);
  if(start<0||end<start||html.indexOf(opening,start+opening.length)>=0||html.indexOf(closing,end+closing.length)>=0)throw new Error(`Missing or duplicate homepage prerender marker: ${name}`);
  return html.slice(0,start+opening.length)+value+html.slice(end);
}

function uniqueIPs(items){
  const seen=new Set();
  return items.filter(item=>{
    const key=item.ipId||normalize(item.title.replace(/\(소설\)$/,''));
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}

function image(item,className='cover-image',{eager=false,priority=false}={}){
  const source=safeImage(item.image);
  return source?`<img class="${className}" src="${escapeHTML(source)}" alt="${escapeHTML(item.title)} 표지" width="360" height="480" loading="${eager?'eager':'lazy'}" fetchpriority="${priority?'high':'auto'}" decoding="async" referrerpolicy="no-referrer">`:'';
}

function card(item,{tags=false,eager=false}={}){
  return `<article class="work-card" data-card-id="${item.id}"><button class="cover-button" data-work="${item.id}" aria-label="${escapeHTML(item.title)} 상세 보기"><span class="cover-fallback" aria-hidden="true"><span class="fallback-mark">✦</span>${escapeHTML(item.title)}</span>${image(item,'cover-image',{eager})}<span class="cover-badge">${escapeHTML(item.type)}</span></button><button class="card-title" data-work="${item.id}" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</button><p class="card-meta">${escapeHTML(item.type)} · ${escapeHTML((item.creators||[]).slice(0,2).join(' / ')||item.genre||'')}</p>${tags?`<p class="card-tags">${(item.tags||[]).slice(0,2).map(tag=>'#'+escapeHTML(tag)).join(' ')}</p>`:''}</article>`;
}

function heroCard(item,index){
  const description=item.description||'';
  const subtitle=index===0?description.slice(0,72)+(description.length>72?'…':''):`${item.type} · ${item.genre||''}`;
  return `<button class="hero-card ${['featured','rose','teal'][index]}" data-work="${item.id}" aria-label="${escapeHTML(item.title)} 상세 보기"><span class="hero-backdrop" aria-hidden="true">${image(item,'hero-backdrop-image',{eager:true})}</span><span class="hero-text"><span class="hero-kicker">${escapeHTML(item.genre)}</span><h2>${escapeHTML(item.title.replace(/\(소설\)$/, ''))}</h2><span class="hero-subtitle">${escapeHTML(subtitle)}</span><span class="hero-cta">작품 만나보기 <span class="arrow" aria-hidden="true">↗</span></span></span>${image(item,'hero-art',{eager:true,priority:index===0})}</button>`;
}

function chip(label,count,dimension){
  const unavailable=count===0;
  return `<button class="facet-chip ${unavailable?'is-empty':''}" data-facet="${dimension}" data-value="${escapeHTML(label)}" aria-pressed="false" ${unavailable?'disabled':''}>${escapeHTML(label)} <span class="facet-count">${count.toLocaleString('ko-KR')}</span></button>`;
}

function popularRegions(popular,byId){
  const lists=popular.lists,list=lists[0];
  if(!list)return {tabs:'',picks:'<p class="storage-note">확인된 인기 작품을 준비하고 있어요.</p>',source:'',items:[]};
  const entries=list.entries.slice(0,5);
  const picks=entries.map((entry,index)=>{
    const item=byId.get(entry.catalogId),title=entry.localizedTitle||entry.title,url=safePublicURL(entry.url),external=!item||!!entry.editionWarning,cover=popularCoverItem(entry,item);
    const fallback=`<span aria-hidden="true">${escapeHTML(popularCoverSymbol(list.media,title))}</span>`;
    const content=`<span class="side-rank">${index+1}</span><span class="popular-cover">${cover?image(cover,'')||fallback:fallback}</span><span class="side-info"><strong>${escapeHTML(title)}</strong><small>${external?'공식 플랫폼에서 확인 ↗':escapeHTML(item.genre)}</small></span>`;
    return external?(url?`<a class="side-pick" href="${escapeHTML(url)}" data-platform-link="" ${entry.editionWarning?'title="시리즈 전체 공식 페이지로 이동합니다." ':''}target="_blank" rel="noopener noreferrer">${content}</a>`:''):`<button class="side-pick" data-work="${item.id}">${content}</button>`;
  }).join('')||'<p class="storage-note">인기 작품을 준비하고 있어요.</p>';
  const sourceURL=safePublicURL(list.sourceUrl);
  const source=sourceURL?`<a href="${escapeHTML(sourceURL)}" target="_blank" rel="noopener noreferrer">${escapeHTML(list.sourceLabel)} ↗</a>`:escapeHTML(list.sourceLabel);
  return {tabs:lists.map(entry=>`<button data-popular="${escapeHTML(entry.id)}" aria-pressed="${entry.id===list.id}">${escapeHTML(entry.media)}</button>`).join(''),picks,source,items:entries.map(entry=>byId.get(entry.catalogId)).filter(Boolean)};
}

function contextRegion(){
  return {html:'<section class="collection-card context-card" aria-labelledby="context-title"><p class="eyebrow">A STORY FOR THIS MOMENT</p><h2 id="context-title">지금 이 순간의 이야기</h2><div id="context-content" aria-live="polite"><p class="recommendation-note">지금 어울리는 이야기를 고르고 있어요.</p></div></section>'};
}

async function localCoverImages(publicPath,items){
  if(!publicPath)return [];
  let entries;
  try{entries=JSON.parse(await readFile(path.join(publicPath,'assets/covers/manifest.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return [];throw error;}
  if(!Array.isArray(entries))throw new Error('Invalid local cover manifest');
  const byId=new Map(items.map(item=>[item.id,item]));
  return entries.filter(entry=>{
    const item=byId.get(entry.id);
    return item&&eligible(item)&&entry.source===item.image&&LOCAL_COVER.test(entry.url);
  }).map(({id,source,url})=>({id,source,url}));
}

export async function prerenderHome({html,catalog,popular={lists:[]},publicPath,release}){
  const sourceItems=catalog?.items,meta=catalog?.meta;
  if(!Array.isArray(sourceItems)||meta?.source!=='supabase'||meta.loaded!==sourceItems.length||!Number.isSafeInteger(meta.total)||meta.total<meta.loaded||!catalog.taxonomy?.groups)throw new Error('Prerender requires a complete verified Supabase catalog');
  if(sourceItems.some(item=>!Number.isSafeInteger(item.id)||item.id<=0||typeof item.title!=='string'))throw new Error('Invalid catalog item identity');
  if(new Set(sourceItems.map(item=>item.id)).size!==sourceItems.length)throw new Error('Duplicate catalog IDs');
  const publicItems=sourceItems.filter(eligible);
  if(meta.available!==publicItems.length)throw new Error('Prerender catalog public count mismatch');
  const generatedAt=release?.generatedAt||catalog.generatedAt||meta.fetchedAt;
  if(!Number.isFinite(Date.parse(generatedAt)))throw new Error('Prerender catalog timestamp is missing');
  const coverImages=await localCoverImages(publicPath,publicItems),coverById=new Map(coverImages.map(entry=>[entry.id,entry]));
  const items=publicItems.map(item=>coverById.has(item.id)?{...item,image:coverById.get(item.id).url}:item);
  const byId=new Map(items.map(item=>[item.id,item]));
  const rankings=preparePopularLists(popular,sourceItems),recommended=recommendHome(items,{popular:rankings});
  const fromIds=identifiers=>identifiers.map(id=>byId.get(id)).filter(Boolean);
  const hero=fromIds(recommended.heroIds),browse=fromIds(recommended.rankingIds).slice(0,12),discovery=fromIds(recommended.discoveryIds),audience=fromIds(recommended.sidebarIds);
  const sidebar=popularRegions(rankings,byId),context=contextRegion();
  const selected=[...new Map([...hero,...browse,...sidebar.items,...audience,...discovery].map(item=>[item.id,item])).values()];
  if(selected.length>40)throw new Error('Homepage bootstrap selection exceeds budget');
  const counts=Object.fromEntries(GROUPS.map(group=>[group.id,facetCounts(group.id,items)]));
  const taxonomy={...catalog.taxonomy,groups:catalog.taxonomy.groups.map(group=>({...group,tags:group.tags.map(tag=>({...tag,count:counts[group.id]?.get(tag.label)||0}))}))};
  const tabs=GROUPS.map(group=>`<button role="tab" id="facet-tab-${group.id}" aria-controls="facet-tag-panel" aria-selected="${group.id==='genre'}" tabindex="${group.id==='genre'?0:-1}" data-tab="${group.id}">${group.label}</button>`).join('');
  const genres=sortFacetLabels((taxonomy.groups.find(group=>group.id==='genre')?.tags||[]).map(tag=>tag.label),counts.genre);
  const platformCounts=facetCounts('platform',items),platforms=sortFacetLabels(PLATFORM_FILTERS,platformCounts).map(label=>[label,platformCounts.get(label)||0]);
  const bootstrap={schemaVersion:1,source:'supabase',generatedAt,meta,taxonomy,items:selected,popular:rankings,coverImages,recommendations:{...recommended,rankingIds:recommended.rankingIds.slice(0,40)},...(release?{release}:{} )};
  const regions={
    preload:hero[0]?`<link rel="preload" as="image" href="${escapeHTML(safeImage(hero[0].image))}" fetchpriority="high" referrerpolicy="no-referrer">`:'',
    hero:hero.slice(0,3).map(heroCard).join(''),
    audience:audience.map((item,index)=>`<button class="side-pick" data-work="${item.id}"><span class="side-rank">${index+1}</span><span class="popular-cover">${image(item,'')}</span><span class="side-info"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.type)}</small></span></button>`).join(''),
    'facet-tabs':tabs,
    facets:genres.slice(0,16).map(label=>chip(label,counts.genre.get(label)||0,'genre')).join(''),
    'facet-more':`<button class="facet-more" id="facet-more" data-action="facet-more" aria-expanded="false" ${genres.length<=16?'hidden':''}>더 보기</button>`,
    platforms:platforms.map(([label,count])=>chip(label,count,'platform')).join(''),
    browse:browse.map(item=>card(item,{tags:true})).join(''),
    discovery:discovery.map(item=>card(item)).join(''),
    'popular-tabs':sidebar.tabs,
    popular:sidebar.picks,
    'popular-source':sidebar.source,
    context:context.html,
    bootstrap:`<script type="application/json" id="catalog-bootstrap">${serializeBootstrap(bootstrap)}</script>`
  };
  let rendered=html;
  for(const [name,value]of Object.entries(regions))rendered=replaceRegion(rendered,name,value);
  const heroPages=Math.max(1,Math.ceil(hero.length/3));
  rendered=rendered.replace('<span id="hero-page"><b>01</b> / 02</span>',`<span id="hero-page"><b>01</b> / ${String(heroPages).padStart(2,'0')}</span>`);
  if(items.length<=browse.length)rendered=rendered.replace('id="browse-next" data-action="browse-next"','id="browse-next" data-action="browse-next" hidden');
  rendered=rendered.replace('<body>','<body data-catalog-prerendered="true">');
  return rendered;
}
