'use strict';
const WORKS = window.CHALPICK_WORKS || [];
const TYPES = window.CHALPICK_TYPES || [];
if (!WORKS.length || !TYPES.length) { console.error('Chalpick data failed to load.'); }

// v6 metadata enrichment: broad tags alone should not make works look similar.
const CREATOR_PATCH = {
  '울어 봐, 빌어도 좋고':'솔체','황금숲':'윤소리','마지막 여행이 끝나면':'하늘가리기',
  '문제적 왕자님':'솔체','바스티안':'솔체','실버 트리':'윤소리','위대한 소원':'하늘가리기',
  '루시아':'하늘가리기','마이 페어 메이드':'솔체'
};
for(const w of WORKS){
  if(CREATOR_PATCH[w.title]) w.creator = CREATOR_PATCH[w.title];
  else if(!('creator' in w)) w.creator = null;
  if(w.title === '트롤의 습격'){
    // Official Netflix taxonomy is monster/action-adventure. Keep modern-world context explicit.
    w.tags = ['괴수물','괴수','재난','현대','액션','신화'];
    w.tagSlugs = ['monster-movie','monster','disaster','modern','action','myth'];
    w.semanticGroup = '괴수재난';
  }
}
const GENERIC_TAGS = new Set(['판타지','액션','현대','드라마','로맨스','코미디','청춘','시대극','휴먼','로코','스릴러','미스터리','SF']);
const SEARCH_ALIASES = {
  '호러물':['호러','공포'], '공포물':['공포','호러'], '무협물':['무협','무림'], '괴수물':['괴수물','괴수','몬스터'],
  '좀비물':['좀비'], '로맨스물':['로맨스'], '판타지물':['판타지'], '액션물':['액션']
};
function semanticGroup(w){
  if(w.semanticGroup) return w.semanticGroup;
  const tags=new Set(w.tags||[]);
  if(['괴수물','괴수','거대괴물','몬스터','재난'].some(t=>tags.has(t))) return '괴수재난';
  if(['헌터','던전','각성','상태창'].some(t=>tags.has(t))) return '헌터성장';
  if(['무협','무림','문파','천마'].some(t=>tags.has(t))) return '무협';
  if(tags.has('이능력') && tags.has('현대')) return '현대이능력';
  return null;
}
function semanticCompatibility(a,b){
  const ga=semanticGroup(a), gb=semanticGroup(b);
  if(!ga || !gb) return 1;
  if(ga===gb) return 1.12;
  if(ga==='괴수재난' || gb==='괴수재난') return 0.55;
  return 0.92;
}
const MEDIA = ['전체','영화','드라마','웹툰','웹소설'];
const EXCLUDES = [
  ['unresolved','여운이 긴 이야기보다 비교적 깔끔하게 풀리는 이야기가 좋아요'],
  ['gore','잔혹한 장면은 피하고 싶어요'],
  ['horror','공포 분위기는 피하고 싶어요'],
  ['medical','의학·병원 중심 이야기는 덜 보고 싶어요']
];
const PRIORITIES = [
  ['short','짧게 볼 수 있는 작품 우선'],
  ['new','최근 작품 우선']
];
const FEEDBACK = [
  ['want','보고 싶어요'],['liked','재미있었어요'],['meh','아쉬웠어요'],
  ['no','관심 없어요'],['stopped','중간에 멈췄어요'],['forgot','기억이 잘 안 나요']
];
const STOP_REASONS = [['bored','재미가 없어졌어요'],['busy','시간이 없었어요'],['later','나중에 이어볼래요'],['skip','이유는 넘어갈게요']];
const MODE_INFO = {
  match:['찰떡픽','좋아한 여러 작품의 공통 분위기와 흐름을 종합해서 추천해요.'],
  similar:['유사픽','내가 지정한 한 작품을 기준으로 비슷한 작품을 골라줘요.'],
  discover:['발견픽','익숙한 취향의 연결고리는 유지하되, 배경·형식·소재를 조금 넓혀서 추천해요.']
};
const STARTER_SEEDS = [{"title":"건축학개론","media":"영화"},{"title":"극한직업","media":"영화"},{"title":"기생충","media":"영화"},{"title":"리틀 포레스트","media":"영화"},{"title":"범죄도시","media":"영화"},{"title":"부산행","media":"영화"},{"title":"살인의 추억","media":"영화"},{"title":"서울의 봄","media":"영화"},{"title":"신과함께-죄와 벌","media":"영화"},{"title":"아바타","media":"영화"},{"title":"클래식","media":"영화"},{"title":"파묘","media":"영화"},{"title":"갯마을 차차차","media":"드라마"},{"title":"더 글로리","media":"드라마"},{"title":"도깨비","media":"드라마"},{"title":"동백꽃 필 무렵","media":"드라마"},{"title":"무빙","media":"드라마"},{"title":"사내맞선","media":"드라마"},{"title":"오징어 게임","media":"드라마"},{"title":"옷소매 붉은 끝동","media":"드라마"},{"title":"이상한 변호사 우영우","media":"드라마"},{"title":"철인왕후","media":"드라마"},{"title":"킹덤","media":"드라마"},{"title":"폭싹 속았수다","media":"드라마"},{"title":"갓 오브 하이스쿨","media":"웹툰"},{"title":"스위트홈","media":"웹툰"},{"title":"어느 날 공주가 되어버렸다","media":"웹툰"},{"title":"여신강림","media":"웹툰"},{"title":"연애혁명","media":"웹툰"},{"title":"유미의 세포들","media":"웹툰"},{"title":"재혼 황후","media":"웹툰"},{"title":"정년이","media":"웹툰"},{"title":"나 혼자만 레벨업","media":"웹소설"},{"title":"내 남편과 결혼해줘","media":"웹소설"},{"title":"데뷔 못 하면 죽는 병 걸림","media":"웹소설"},{"title":"상수리나무 아래","media":"웹소설"},{"title":"악녀는 모래시계를 되돌린다","media":"웹소설"},{"title":"악역의 엔딩은 죽음뿐","media":"웹소설"},{"title":"재벌집 막내아들","media":"웹소설"},{"title":"전지적 독자 시점","media":"웹소설"},{"title":"화산귀환","media":"웹툰"},{"title":"괴력 난신","media":"웹소설"},{"title":"천마육성","media":"웹툰"},{"title":"사랑의 불시착","media":"드라마"},{"title":"왕과 사는 남자","media":"영화"},{"title":"호텔 델루나","media":"드라마"},{"title":"우리들의 블루스","media":"드라마"},{"title":"나노마신","media":"웹툰"},{"title":"절대검감","media":"웹툰"},{"title":"SSS급 죽어야 사는 헌터","media":"웹툰"},{"title":"광마회귀","media":"웹툰"},{"title":"절대회귀","media":"웹툰"},{"title":"나 혼자 만렙 뉴비","media":"웹툰"},{"title":"상남자","media":"웹툰"},{"title":"이태원 클라쓰","media":"드라마"},{"title":"미스터 션샤인","media":"드라마"},{"title":"듄: 파트 1","media":"영화"},{"title":"역대급 영지 설계사","media":"웹툰"},{"title":"디펜스 게임의 폭군이 되었다","media":"웹툰"},{"title":"나빌레라","media":"웹툰"},{"title":"게임 속 바바리안으로 살아남기","media":"웹소설"},{"title":"인터스텔라","media":"영화"},{"title":"택시운전사","media":"영화"},{"title":"나의 해방일지","media":"드라마"},{"title":"조명가게","media":"드라마"},{"title":"경이로운 소문","media":"드라마"},{"title":"더 에이트 쇼","media":"드라마"},{"title":"그 해 우리는","media":"드라마"},{"title":"환혼","media":"드라마"},{"title":"슈룹","media":"드라마"},{"title":"암살","media":"영화"},{"title":"중증외상센터: 골든 아워","media":"웹소설"},{"title":"어바웃 타임","media":"영화"},{"title":"울어 봐, 빌어도 좋고","media":"웹소설"},{"title":"황금숲","media":"웹소설"},{"title":"이 사랑 통역 되나요?","media":"드라마"},{"title":"태양의 후예","media":"드라마"},{"title":"이 결혼은 어차피 망하게 되어 있다","media":"웹소설"},{"title":"언아더 헤븐","media":"웹소설"},{"title":"마지막 여행이 끝나면","media":"웹소설"},{"title":"메리 사이코","media":"웹소설"},{"title":"문제적 왕자님","media":"웹소설"},{"title":"바스티안","media":"웹소설"},{"title":"실버 트리","media":"웹소설"},{"title":"위대한 소원","media":"웹소설"},{"title":"루시아","media":"웹소설"},{"title":"결혼 장사","media":"웹소설"},{"title":"선재 업고 튀어","media":"드라마"},{"title":"눈물의 여왕","media":"드라마"},{"title":"지금 거신 전화는","media":"드라마"},{"title":"희란국연가","media":"웹소설"},{"title":"더 킹: 영원의 군주","media":"드라마"},{"title":"이터널 선샤인","media":"영화"},{"title":"시월애","media":"영화"},{"title":"악녀는 두 번 산다","media":"웹소설"},{"title":"시크릿 레이디","media":"웹툰"},{"title":"브리저튼 시즌 1","media":"드라마"},{"title":"요한은 티테를 사랑한다","media":"웹소설"},{"title":"어떤 계모님의 메르헨","media":"웹툰"},{"title":"내 벽을 움킨 해일","media":"웹소설"},{"title":"마이 페어 메이드","media":"웹소설"},{"title":"여러 해를 사는 나무여","media":"웹소설"},{"title":"당신, 거기 있어줄래요","media":"영화"},{"title":"내 남편과 결혼해줘 (드라마)","media":"드라마"}];
const DATA_PATCH = {
  '지금만나러갑니다': {tags:['로맨스','드라마','휴먼','일상','현대','기억상실','순정남']},
  '도깨비': {tags:['로판','판타지','현대','환생','이능력','복수극','액션']}
};
const $ = id => document.getElementById(id);
const BY_ID = Object.fromEntries(WORKS.map(w => [w.id,w]));
const STORE = 'chalpick-md-demo-20260923-v7';
let composing = false;
let noticeTimer = null;
let currentStage = '';
let REC = {match:[], similar:[], discover:[]};

function fresh(){
  return {selected:[], disliked:[], display:[], shown:{}, last:[], mediaFilters:[], query:'', all:false, expanded:false,
    exclude:[], priority:[], preferredMedia:[], feedback:{}, stage:'select', type:null, mode:'match', pivot:null,
    openFeedback:null, stopPending:null, seed:Math.random()};
}
let state = fresh();
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if(saved && Array.isArray(saved.selected)){
    state = {...fresh(), ...saved};
    state.selected = (saved.selected || []).filter(id => BY_ID[id]).slice(0,10);
    state.disliked = (saved.disliked || []).filter(id => BY_ID[id] && !state.selected.includes(id));
    const legacyFilter = MEDIA.includes(saved.filter) && saved.filter !== '전체' ? [saved.filter] : [];
    state.mediaFilters = Array.isArray(saved.mediaFilters) ? saved.mediaFilters.filter(x => MEDIA.slice(1).includes(x)) : legacyFilter;
    state.exclude = (saved.exclude || []).filter(x => EXCLUDES.some(v => v[0] === x));
    state.priority = (saved.priority || []).filter(x => PRIORITIES.some(v => v[0] === x));
    state.preferredMedia = (saved.preferredMedia || []).filter(x => MEDIA.slice(1).includes(x));
  }
} catch(e) {}

function save(){
  try {
    const {openFeedback, stopPending, ...rest} = state;
    localStorage.setItem(STORE, JSON.stringify(rest));
  } catch(e) {}
}
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function normalize(s){
  return String(s || '').toLowerCase().replace(/\s+/g,'').replace(/[.,·:'"!?()\[\]{}\-]/g,'');
}
function compactTitle(s){
  return String(s || '').toLowerCase().replace(/\s+/g,'').replace(/[.,·:'"!?()\[\]{}\-]/g,'');
}
function ipKey(input){
  let t = typeof input === 'string' ? input : (input && input.title ? input.title : '');
  t = String(t).toLowerCase().trim();
  t = t.replace(/\s*\((웹소설|소설|웹툰|드라마|영화|ott|원작)\)\s*$/i,'');
  t = t.replace(/[:：]?\s*(시즌|season)\s*\d+\s*$/i,'');
  t = t.replace(/[:：]?\s*(파트|part)\s*\d+\s*$/i,'');
  t = t.replace(/\s+\d+\s*$/,'');
  return compactTitle(t);
}
function applyDataPatches(){
  WORKS.forEach(w => {
    const patch = DATA_PATCH[compactTitle(w.title)];
    if(patch){
      if(Array.isArray(patch.tags)) w.tags = [...patch.tags];
      if(Number.isFinite(patch.tempo)) w.tempo = patch.tempo;
      if(Number.isFinite(patch.mood)) w.mood = patch.mood;
      if(Number.isFinite(patch.resolve)) w.resolve = patch.resolve;
      if(Number.isFinite(patch.unusual)) w.unusual = patch.unusual;
    }
  });
}
applyDataPatches();
function toast(msg){
  const el = $('toast'); if(!el) return;
  clearTimeout(noticeTimer); el.textContent = msg; el.classList.add('on');
  noticeTimer = setTimeout(() => el.classList.remove('on'), 2500);
}
function pseudoRandom(work){
  const str = work.id + '-' + state.seed;
  let n = 0;
  for(const ch of str) n = (Math.imul(n,31) + ch.charCodeAt(0)) >>> 0;
  return n / 4294967296;
}
function chosen(){ return state.selected.map(id => BY_ID[id]).filter(Boolean); }
function feedbackEntries(){ return Object.entries(state.feedback).map(([id,v]) => [BY_ID[id], v]).filter(x => x[0]); }
function positiveExtra(){ return feedbackEntries().filter(([,v]) => ['want','liked'].includes(v.status)).map(([w]) => w); }
function negativeExtra(){ const map=new Map(); (state.disliked||[]).map(id=>BY_ID[id]).filter(Boolean).forEach(w=>map.set(w.id,w)); feedbackEntries().filter(([,v]) => ['meh','no'].includes(v.status) || (v.status === 'stopped' && v.reason === 'bored')).map(([w]) => w).forEach(w=>map.set(w.id,w)); return [...map.values()]; }
function profileWorks(){ const map = new Map(); [...chosen(), ...positiveExtra()].forEach(w => map.set(w.id, w)); return [...map.values()]; }
function mediaFilterActive(w){ return !state.mediaFilters.length || state.mediaFilters.includes(w.media); }
function pool(){ return WORKS.filter(mediaFilterActive); }
function exposure(w){ return state.shown[w.id] || 0; }
function genre(w){ return (w.tags && w.tags[0]) || w.media; }
function diversity(w, existing){
  let score = (exposure(w) === 0 ? 6 : 0) - 2 * exposure(w);
  score += 2.7 / (1 + existing.filter(x => x.media === w.media).length);
  score += 2.0 / (1 + existing.filter(x => genre(x) === genre(w)).length);
  const sg = semanticGroup(w);
  if(sg) score += 1.6 / (1 + existing.filter(x => semanticGroup(x) === sg).length);
  score += 1.4 / (1 + existing.filter(x => (x.year && w.year && Math.abs(x.year - w.year) < 2)).length);
  score += pseudoRandom(w) * 0.7;
  return score;
}
function selectDiverse(list, count, existing=[]){
  const candidates = [...list];
  const picked = [];
  const usedIP = new Set(existing.map(ipKey));
  while(picked.length < count && candidates.length){
    const eligible = candidates.filter(w => !usedIP.has(ipKey(w)));
    if(!eligible.length) break;
    eligible.sort((a,b) => diversity(b, [...existing, ...picked]) - diversity(a, [...existing, ...picked]));
    const next = eligible[0];
    picked.push(next);
    usedIP.add(ipKey(next));
    const idx = candidates.findIndex(x => x.id === next.id);
    if(idx >= 0) candidates.splice(idx,1);
  }
  return picked;
}
function scoreProfile(list){
  if(!list.length) return {tempo:50, mood:50, resolve:50, unusual:50};
  const out = {tempo:0, mood:0, resolve:0, unusual:0};
  list.forEach(w => { out.tempo += w.tempo; out.mood += w.mood; out.resolve += w.resolve; out.unusual += w.unusual; });
  Object.keys(out).forEach(k => out[k] /= list.length);
  return out;
}
function axisDistance(a,b){
  const dt = (a.tempo - b.tempo) / 100;
  const dm = (a.mood - b.mood) / 100;
  const dr = (a.resolve - b.resolve) / 100;
  const du = (a.unusual - b.unusual) / 100;
  return Math.sqrt(0.29*dt*dt + 0.25*dm*dm + 0.22*dr*dr + 0.24*du*du);
}
function similarity(a,b){ return Math.max(0, 1 - axisDistance(a,b)); }
function weightedTagMap(w){
  const pos = [3.0,2.4,1.6,1.2,1.0,0.9,0.8,0.7];
  const out = new Map();
  (w.tags || []).forEach((t,i) => {
    const genericFactor = GENERIC_TAGS.has(t) ? 0.28 : 1;
    out.set(t, (pos[i] || 0.6) * genericFactor);
  });
  return out;
}
function weightedTagSimilarity(a,b){
  const A = weightedTagMap(a), B = weightedTagMap(b);
  const keys = new Set([...A.keys(), ...B.keys()]);
  let num = 0, den = 0;
  keys.forEach(k => { const x=A.get(k)||0, y=B.get(k)||0; num += Math.min(x,y); den += Math.max(x,y); });
  return den ? num / den : 0;
}
function primaryTagSimilarity(a,b){
  const A = new Set((a.tags || []).slice(0,2));
  const B = new Set((b.tags || []).slice(0,2));
  const u = new Set([...A,...B]);
  if(!u.size) return 0;
  let common = 0; A.forEach(x => { if(B.has(x)) common++; });
  return common / u.size;
}
function sourceAffinity(a,b){
  const axis = similarity(a,b);
  const tags = weightedTagSimilarity(a,b);
  const primary = primaryTagSimilarity(a,b);
  const compat = semanticCompatibility(a,b);
  const A = new Set((a.tags||[]).filter(t=>!GENERIC_TAGS.has(t)));
  const B = new Set((b.tags||[]).filter(t=>!GENERIC_TAGS.has(t)));
  let specificCommon=0; A.forEach(t=>{ if(B.has(t)) specificCommon++; });
  // Broad fantasy/action/modern overlap should not be enough by itself.
  let raw = axis*0.22 + tags*0.52 + primary*0.16 + Math.min(0.10,specificCommon*0.05);
  raw *= compat;
  if((semanticGroup(a)==='괴수재난' || semanticGroup(b)==='괴수재난') && semanticGroup(a)!==semanticGroup(b)) raw *= 0.62;
  return Math.max(0, Math.min(1, raw));
}
function supportMetrics(w, positives){
  const rows = positives.map(source => {
    const shared = overlapInfo(source,w).tags;
    const specificShared = shared.filter(t=>!GENERIC_TAGS.has(t));
    return {source, score:sourceAffinity(source,w), tagScore:weightedTagSimilarity(source,w), shared, specificShared};
  }).sort((a,b) => b.score - a.score);
  const support = rows.filter(r => {
    const sameGroup = semanticGroup(r.source) && semanticGroup(r.source)===semanticGroup(w);
    return (r.specificShared.length>=1 && r.score>=0.50) || sameGroup || (r.specificShared.length>=2 && r.score>=0.44);
  });
  const top = rows.slice(0, Math.min(5, rows.length));
  const topAvg = top.length ? top.reduce((sum,r)=>sum+r.score,0)/top.length : 0;
  return {rows, support, topAvg, supportCount:support.length, coverage: positives.length ? support.length/positives.length : 0};
}
function profileTagAffinity(w, tags){
  if(!tags.length) return 0;
  const weighted = weightedTagMap(w);
  let hit = 0;
  tags.forEach(t => { if(weighted.has(t)) hit += Math.min(1, weighted.get(t)/2.4); });
  return Math.min(1, hit / Math.min(4, tags.length));
}
function overlapInfo(a,b){
  const A = new Set(a.tags || []), B = new Set(b.tags || []);
  const same = [...A].filter(t => B.has(t));
  const union = new Set([...A, ...B]);
  return {tags:same, ratio: union.size ? same.length / union.size : 0};
}
function profileTagStats(list){
  const m = new Map();
  list.forEach(w => (w.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a,b) => b[1] - a[1]);
}
function topProfileTags(list, n=5){ return profileTagStats(list).slice(0,n).map(x => x[0]); }
function priorityBoost(w){
  let b = 0;
  if(state.priority.includes('short') && w.media === '영화') b += 0.03;
  if(state.priority.includes('new') && w.year) b += Math.max(0, 1 - (2026 - w.year) / 18) * 0.04;
  return b;
}
function excludeCandidate(w){
  const title = w.title || '';
  const tags = w.tags || [];
  if(state.exclude.includes('unresolved') && w.resolve < 45) return true;
  if(state.exclude.includes('gore') && tags.some(t => ['잔혹','고어','좀비','괴물','하드보일드'].includes(t))) return true;
  if(state.exclude.includes('horror') && (tags.some(t => ['공포','오컬트','좀비','괴물','호러','귀신'].includes(t)) || title.includes('파묘'))) return true;
  if(state.exclude.includes('medical') && (tags.some(t => ['의료','병원','메디컬'].includes(t)) || title.includes('중증외상센터'))) return true;
  return false;
}
function negativePenalty(w){
  const neg = negativeExtra();
  if(!neg.length) return 0;
  const maxSim = Math.max(...neg.map(n => similarity(w,n)), 0);
  const shared = Math.max(...neg.map(n => overlapInfo(w,n).tags.length), 0);
  return maxSim * 0.08 + Math.min(0.06, shared * 0.015);
}
function matchAffinity(w, positives, profile, tags){
  const m = supportMetrics(w, positives);
  const supportStrength = Math.min(1, m.supportCount / 4);
  const profileTags = profileTagAffinity(w, tags);
  const axis = similarity(w, profile);
  return m.topAvg*0.38 + supportStrength*0.24 + m.coverage*0.10 + profileTags*0.16 + axis*0.12 + priorityBoost(w) - negativePenalty(w);
}
function similarAffinity(source, w){
  const semantic = sourceAffinity(source,w);
  const ov = overlapInfo(source,w);
  const specific = ov.tags.filter(t=>!GENERIC_TAGS.has(t));
  const sameGroup = semanticGroup(source) && semanticGroup(source)===semanticGroup(w);
  if(!sameGroup && specific.length===0 && semantic < 0.52) return 0;
  if((semanticGroup(source)==='괴수재난' || semanticGroup(w)==='괴수재난') && !sameGroup) return semantic*0.35;
  const exactMechanic = Math.min(0.08, specific.length * 0.03);
  const mediaBonus = source.media === w.media ? 0.015 : 0;
  return semantic*0.86 + exactMechanic + mediaBonus + priorityBoost(w) - negativePenalty(w);
}
function discoverAffinity(profile, source, w){
  const connection = sourceAffinity(source,w);
  const ov = overlapInfo(source,w);
  const commonProfile = (w.tags || []).filter(t => topProfileTags(profileWorks(),6).includes(t)).length;
  const novelty = (source.media !== w.media ? 0.07 : 0) + (primaryTagSimilarity(source,w) < 0.5 ? 0.04 : 0);
  const tooClose = connection > 0.86 ? 0.07 : 0;
  const hasBridge = ov.tags.length > 0 ? 0.05 : -0.10;
  return connection*0.48 + similarity(profile,w)*0.22 + Math.min(0.15, commonProfile*0.03) + novelty + hasBridge + priorityBoost(w) - tooClose - negativePenalty(w);
}
function poster(w, small=false){
  const palettes = {영화:['#8367ff','#ab8cff'], 드라마:['#2d6cdf','#65a1ff'], 웹툰:['#20a67b','#5fcf97'], 웹소설:['#cf6b56','#f0a462']};
  const colors = palettes[w.media] || ['#6854d9','#9f86ff'];
  if(small){
    return `<div class="rec-poster" style="--c1:${colors[0]};--c2:${colors[1]}">${esc(w.title)}</div>`;
  }
  const source = esc(w.media + (w.platforms && w.platforms.length ? ' · ' + w.platforms[0] : ''));
  const titleClass = w.title.length >= 18 ? 'xlong-title' : (w.title.length >= 11 ? 'long-title' : '');
  return `<div class="cover" style="--c1:${colors[0]};--c2:${colors[1]}"><span class="source">${source}</span><span class="cover-symbol">✦</span><span class="cover-title ${titleClass}">${esc(w.title)}</span></div>`;
}
function starterPool(){
  const poolByKey = new Map();
  WORKS.forEach(w => {
    const key = ipKey(w);
    if(!poolByKey.has(key)) poolByKey.set(key, []);
    poolByKey.get(key).push(w);
  });
  const out = [];
  const seen = new Set();
  for(const seed of STARTER_SEEDS){
    const key = ipKey(seed.title);
    if(seen.has(key)) continue;
    const candidates = poolByKey.get(key) || [];
    if(!candidates.length) continue;
    candidates.sort((a,b) => {
      const am = a.media === seed.media ? 1 : 0, bm = b.media === seed.media ? 1 : 0;
      const ac = a.confidence === '확정' ? 1 : 0, bc = b.confidence === '확정' ? 1 : 0;
      return (bm-am) || (bc-ac) || ((b.year||0)-(a.year||0));
    });
    out.push(candidates[0]); seen.add(key);
  }
  return out;
}
const STARTER_POOL = starterPool();
function activeMediaList(){
  return state.mediaFilters.length ? [...state.mediaFilters] : MEDIA.slice(1);
}
function starterAvailable(){
  return STARTER_POOL.filter(w => !state.selected.includes(w.id) && !(state.disliked||[]).includes(w.id) && mediaFilterActive(w));
}
function diverseZeroSignalBatch(){
  let available = starterAvailable();
  let freshAvailable = available.filter(w => exposure(w) === 0);
  if(freshAvailable.length >= Math.min(12, available.length)) available = freshAvailable;
  const active = activeMediaList();
  const out = [];
  const used = new Set();
  const targetPerMedia = active.length ? Math.ceil(12 / active.length) : 12;

  // With no taste signal, deliberately spread the first 12 across selected media and different story types.
  for(const medium of active){
    const group = available.filter(w => w.media === medium && !used.has(ipKey(w)));
    const picked = selectDiverse(group, targetPerMedia, out).slice(0, Math.max(0, 12-out.length));
    picked.forEach(w => { out.push(w); used.add(ipKey(w)); });
    if(out.length >= 12) break;
  }
  if(out.length < 12){
    const rest = available.filter(w => !used.has(ipKey(w)));
    const picked = selectDiverse(rest, 12-out.length, out);
    picked.forEach(w => { out.push(w); used.add(ipKey(w)); });
  }
  return out.slice(0,12);
}
function refreshSimilarityScore(w, positives){
  if(!positives.length) return 0;
  const affinities = positives.map(p => sourceAffinity(p,w)).sort((a,b)=>b-a);
  const best = affinities[0] || 0;
  const top = affinities.slice(0, Math.min(3, affinities.length));
  const topAvg = top.length ? top.reduce((a,b)=>a+b,0)/top.length : best;
  const profile = scoreProfile(positives);
  const tags = topProfileTags(positives,8);
  const profileFit = similarity(w,profile);
  const tagFit = profileTagAffinity(w,tags);
  return Math.max(0, Math.min(1.2, best*0.42 + topAvg*0.28 + profileFit*0.16 + tagFit*0.14 + priorityBoost(w) - negativePenalty(w)));
}
function noveltyScore(w, positives){
  if(!positives.length) return 0;
  const bridges = positives.map(p => ({p,aff:sourceAffinity(p,w)})).sort((a,b)=>b.aff-a.aff);
  const best = bridges[0];
  const bridge = best ? best.aff : 0;
  const chosenMedia = new Set(positives.map(x=>x.media));
  const chosenGroups = new Set(positives.map(semanticGroup).filter(Boolean));
  const group = semanticGroup(w);
  const mediaNovel = chosenMedia.has(w.media) ? 0 : 1;
  const groupNovel = group && !chosenGroups.has(group) ? 1 : 0;
  const primaryMax = Math.max(...positives.map(p=>primaryTagSimilarity(p,w)),0);
  const tagNovel = 1 - Math.min(1, primaryMax);
  const broadBridge = Math.max(...positives.map(p=>weightedTagSimilarity(p,w)),0);
  // New-field candidates still need a bridge; pure randomness should not dominate.
  return bridge*0.42 + broadBridge*0.13 + mediaNovel*0.15 + groupNovel*0.16 + tagNovel*0.14 - negativePenalty(w);
}
function pickRankedRows(rows, count, used, existing, diversityWeight=0.012){
  const picked = [];
  const candidates = rows.filter(r => !used.has(ipKey(r.w)));
  while(picked.length < count && candidates.length){
    candidates.sort((a,b) => {
      const ad = diversity(a.w,[...existing,...picked.map(x=>x.w)]) * diversityWeight;
      const bd = diversity(b.w,[...existing,...picked.map(x=>x.w)]) * diversityWeight;
      return (b.score + bd) - (a.score + ad);
    });
    const next = candidates.shift();
    if(used.has(ipKey(next.w))) continue;
    picked.push(next); used.add(ipKey(next.w));
  }
  return picked;
}
function pickForRefresh(base){
  const positives = profileWorks();
  if(!positives.length) return diverseZeroSignalBatch();

  const simRows = base.map(w => ({w,score:refreshSimilarityScore(w,positives)})).sort((a,b)=>b.score-a.score);
  const n = simRows.length;
  const highEnd = Math.max(4, Math.ceil(n*0.28));
  const midStart = Math.min(n, Math.max(4, Math.floor(n*0.28)));
  const midEnd = Math.min(n, Math.max(midStart+4, Math.ceil(n*0.70)));
  const highRows = simRows.slice(0,highEnd);
  const midRows = simRows.slice(midStart,midEnd);
  const discoveryRows = base.map(w => ({w,score:noveltyScore(w,positives)}))
    .sort((a,b)=>b.score-a.score);

  const used = new Set();
  const outRows = [];
  // 4 close candidates
  outRows.push(...pickRankedRows(highRows,4,used,[],0.006));
  if(outRows.length < 4) outRows.push(...pickRankedRows(simRows,4-outRows.length,used,outRows.map(x=>x.w),0.006));
  // 4 medium candidates: still connected, but not merely the nearest neighbours.
  const beforeMid = outRows.length;
  outRows.push(...pickRankedRows(midRows,4,used,outRows.map(x=>x.w),0.014));
  if(outRows.length < beforeMid+4){
    const fallbackMid = simRows.slice(Math.min(4,simRows.length));
    outRows.push(...pickRankedRows(fallbackMid,beforeMid+4-outRows.length,used,outRows.map(x=>x.w),0.014));
  }
  // 4 discovery candidates: retain a bridge while changing medium/story mechanism/primary material.
  const beforeDiscovery = outRows.length;
  outRows.push(...pickRankedRows(discoveryRows,4,used,outRows.map(x=>x.w),0.020));
  if(outRows.length < beforeDiscovery+4){
    outRows.push(...pickRankedRows(simRows,beforeDiscovery+4-outRows.length,used,outRows.map(x=>x.w),0.018));
  }
  return outRows.slice(0,12).map(r=>r.w);
}
function markShown(list){
  list.forEach(w => { state.shown[w.id] = (state.shown[w.id] || 0) + 1; });
  state.last = list.map(w => w.id);
}
function makeBatch(initial=false){
  const hasSignal = profileWorks().length > 0;
  let base;
  if(!hasSignal){
    base = starterAvailable();
  } else {
    base = pool().filter(w => !state.selected.includes(w.id) && !(state.disliked||[]).includes(w.id));
  }
  const unseen = base.filter(w => !exposure(w));
  let candidates = unseen.length >= 12 ? unseen : base.filter(w => !state.last.includes(w.id));
  if(candidates.length < 12) candidates = base;
  const output = hasSignal ? pickForRefresh(candidates) : diverseZeroSignalBatch();
  state.display = output.slice(0,12).map(w => w.id);
  markShown(output.slice(0,12));
  state.all = false; state.query = '';
  save();
}
function mediaTabs(){
  const active = new Set(state.mediaFilters || []);
  $('media-tabs').innerHTML = MEDIA.map(m => {
    const on = m === '전체' ? active.size === 0 : active.has(m);
    return `<button class="media-tab ${on ? 'active' : ''}" data-medium="${m}" type="button" aria-pressed="${on}">${m}</button>`;
  }).join('');
}
function searchTokens(raw){
  const q=normalize(raw);
  const out=new Set([q]);
  if(SEARCH_ALIASES[raw]) SEARCH_ALIASES[raw].forEach(x=>out.add(normalize(x)));
  if(raw.endsWith('물') && raw.length>1) out.add(normalize(raw.slice(0,-1)));
  return [...out].filter(Boolean);
}
function searchableFields(w){
  return {
    title:normalize(w.title),
    tags:(w.tags||[]).map(normalize),
    platforms:(w.platforms||[]).map(normalize),
    creator:w.creator?normalize(w.creator):''
  };
}
function searchScore(w, raw){
  const tokens=searchTokens(raw), f=searchableFields(w);
  let best=0;
  for(const q of tokens){
    if(f.title===q) best=Math.max(best,120);
    else if(f.title.startsWith(q)) best=Math.max(best,110);
    else if(f.title.includes(q)) best=Math.max(best,100);
    if(f.tags.some(x=>x===q)) best=Math.max(best,92);
    else if(f.tags.some(x=>x.includes(q))) best=Math.max(best,84);
    if(f.creator===q) best=Math.max(best,90);
    else if(f.creator && f.creator.includes(q)) best=Math.max(best,82);
    if(f.platforms.some(x=>x===q)) best=Math.max(best,78);
    else if(f.platforms.some(x=>x.includes(q))) best=Math.max(best,72);
  }
  return best;
}
function resultListing(){
  if(state.query){
    return pool().map(w=>({w,score:searchScore(w,state.query)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || Number(state.selected.includes(b.w.id))-Number(state.selected.includes(a.w.id)) || ((b.w.confidence==='확정')-(a.w.confidence==='확정')) || (b.w.year||0)-(a.w.year||0)).slice(0,240).map(x=>x.w);
  }
  const all = pool();
  if(state.all) return all;
  return state.display.map(id => BY_ID[id]).filter(Boolean).filter(mediaFilterActive);
}
function cardMarkup(w){
  const active = state.selected.includes(w.id);
  const disliked = (state.disliked || []).includes(w.id);
  const disabled = state.selected.length >= 10 && !active;
  return `<article class="item ${active ? 'selected' : ''} ${disliked ? 'disliked' : ''}"><button class="card-pick" type="button" data-pick="${w.id}" aria-pressed="${active}" ${disabled ? 'disabled' : ''}>${poster(w)}<span class="tick">${active ? '✓' : '+'}</span><div class="info"><b>${esc(w.title)}</b><div class="meta"><strong>${esc(w.media)}</strong><span>${w.yearLabel || '연도 미확인'}</span><span>${esc((w.tags || []).slice(0,2).join(' · '))}</span>${w.creator?`<span>${esc(w.creator)}</span>`:''}</div></div></button><button class="card-negative" type="button" data-dislike="${w.id}" aria-pressed="${disliked}">${disliked ? '× 별로예요 취소' : '× 별로예요'}</button></article>`;
}
function renderPickedSummary(){
  const n = state.selected.length;
  $('count').textContent = `${n} / 10`;
  $('progress-bar').style.width = `${n * 10}%`;
  $('progress-caption').textContent = n === 0 ? '좋아하는 작품을 5편 이상 골라주세요.' : n < 5 ? `좋아요! ${5-n}편 더 선택하면 취향 결과를 볼 수 있어요.` : n === 10 ? '10편을 골랐어요. 이제 취향 결과를 확인해 보세요.' : '취향 결과를 볼 수 있어요. 원하면 더 골라도 됩니다.';
  $('go-options').disabled = n < 5;
  $('go-options').textContent = n >= 5 ? '취향 결과 보기 →' : `좋아하는 작품 ${5-n}편을 더 선택해 주세요`;
  $('expand-picks').classList.toggle('hidden', n <= 2);
  $('expand-picks').textContent = state.expanded ? '접기' : `전체 ${n}개 보기`;
  const show = state.expanded ? chosen() : chosen().slice(-2);
  $('picked-pills').innerHTML = show.length ? show.map(w => `<span class="picked-pill"><span>${esc(w.title)}</span><button type="button" data-remove="${w.id}" aria-label="${esc(w.title)} 선택 취소">×</button></span>`).join('') : '<span class="sub">선택한 작품이 아직 없습니다.</span>';
  $('sidebar-list').innerHTML = n ? chosen().map((w,i) => `<div class="line"><span>${i+1}. ${esc(w.title)}</span><button type="button" data-remove="${w.id}" aria-label="선택 취소">×</button></div>`).join('') : '<div class="empty">아직 선택한 작품이 없어요.</div>';
  const dislikedWorks=(state.disliked||[]).map(id=>BY_ID[id]).filter(Boolean);
  const box=$('disliked-summary');
  if(box){
    box.classList.toggle('hidden', dislikedWorks.length===0);
    box.innerHTML=dislikedWorks.length?`<strong>별로예요 ${dislikedWorks.length}편</strong> · ${dislikedWorks.slice(0,4).map(w=>`<button type="button" data-undislike="${w.id}">${esc(w.title)}</button>`).join(' · ')}${dislikedWorks.length>4?' 외 '+(dislikedWorks.length-4)+'편':''}`:'';
  }
}
function showStage(name, scroll=true){
  ['select','options','result','share','browse'].forEach(x => { const el = $('step-' + x); if(el) el.classList.toggle('hidden', name !== x); });
  if($('stages')) $('stages').classList.toggle('hidden', name === 'share' || name === 'browse');
  const titles = {
    select:['FIND YOUR NEXT FAVORITE','좋아하는 작품을 고르면,<br>당신만의 취향이 보여요.','작품만 골라도 돼요. 마음에 들었던 작품을 5개 이상, 최대 10개까지 선택해 보세요.'],
    options:['ONE MORE CHOICE','추천받을 콘텐츠를 골라주세요.','주로 보는 유형을 선택하면 추천에서 우선 반영해요.'],
    result:['YOUR TASTE IS HERE','취향을 발견했어요.<br>다음 작품도 만나볼까요?',''],
    share:['SHARED TASTE CARD','이런 취향 카드를 공유할 수 있어요.','공유 화면에서는 카드만 보입니다. 추천은 직접 작품을 골라야 시작됩니다.'],
    browse:['EXPLORE ANIMALS','대표 카드 보기','대표 카드는 취향을 요약한 이미지예요.']
  };
  if($('hero-kicker')) $('hero-kicker').textContent = titles[name][0];
  if($('hero-title')) $('hero-title').innerHTML = titles[name][1];
  if($('hero-desc')) $('hero-desc').textContent = titles[name][2];
  document.querySelectorAll('.stage b').forEach((b,i) => b.classList.toggle('active', i === (name === 'select' ? 0 : name === 'options' ? 1 : 2)));
  if(scroll && currentStage !== name) window.scrollTo({top:0, behavior:'instant'});
  currentStage = name;
}
function renderSelection(preserve=false){
  showStage('select', !preserve);
  renderPickedSummary();
  mediaTabs();
  $('catalog-total').textContent = '';
  $('search').value = state.query;
  const list = resultListing();
  $('list-label').innerHTML = state.query ? `<strong>검색 결과 ${list.length}편</strong>` : state.all ? `<strong>전체 작품</strong>` : `<strong>${profileWorks().length ? '취향에 맞춰 다시 골랐어요' : '먼저 보기 좋은 작품'}</strong>`;
  $('catalog').innerHTML = list.length ? list.map(cardMarkup).join('') : '<div class="empty" style="grid-column:1/-1">표시할 작품이 없어요. 작품명이나 태그, 플랫폼으로 다시 검색해 보세요.</div>';
  save();
}
function togglePick(id){
  const idx = state.selected.indexOf(id);
  if(idx >= 0) state.selected.splice(idx, 1);
  else if(state.selected.length < 10){ state.selected.push(id); state.disliked=(state.disliked||[]).filter(x=>x!==id); }
  else { toast('작품은 최대 10편까지 선택할 수 있어요.'); return; }
  state.expanded = false;
  state.pivot = state.selected.includes(state.pivot) ? state.pivot : (state.selected[0] || null);
  const y = window.scrollY;
  renderSelection(true);
  window.scrollTo(0, y);
  if(state.selected.length === 10){
    requestAnimationFrame(() => { const btn=$('go-options'); if(btn) btn.scrollIntoView({behavior:'smooth',block:'center'}); });
  }
}
function toggleDislike(id){
  state.disliked = state.disliked || [];
  const idx=state.disliked.indexOf(id);
  if(idx>=0) state.disliked.splice(idx,1);
  else {
    state.disliked.push(id);
    state.selected=state.selected.filter(x=>x!==id);
  }
  state.pivot = state.selected.includes(state.pivot) ? state.pivot : (state.selected[0] || null);
  const y=window.scrollY;
  renderSelection(true);
  window.scrollTo(0,y);
}

function renderOptions(){
  showStage('options');
  if(!state.preferredMedia.length){
    state.preferredMedia = [...new Set(chosen().map(w=>w.media).filter(m=>MEDIA.slice(1).includes(m)))];
  }
  $('preferred-media-opts').innerHTML = MEDIA.slice(1).map(m => `<label class="check-option"><input type="checkbox" name="preferredMedia" value="${m}" ${state.preferredMedia.includes(m)?'checked':''}><span>${m}</span></label>`).join('');
  $('exclude-opts').innerHTML = EXCLUDES.map(([key,label]) => `<label class="check-option"><input type="checkbox" name="exclude" value="${key}" ${state.exclude.includes(key)?'checked':''}><span>${label}</span></label>`).join('');
  $('option-picks').innerHTML = chosen().map((w,i)=>`<div class="line">${i+1}. ${esc(w.title)}</div>`).join('');
  $('finish').disabled = state.preferredMedia.length === 0;
  save();
}
function profileBits(p){ return [p.tempo >= 55 ? 1 : 0, p.mood >= 55 ? 1 : 0, p.resolve >= 50 ? 1 : 0, p.unusual >= 30 ? 1 : 0]; }
function typeIndex(){
  const ws = profileWorks(); if(!ws.length) return null;
  const [b0,b1,b2,b3] = profileBits(scoreProfile(ws));
  return 8*b0 + 4*b1 + 2*b2 + b3;
}
function classified(){ const idx = typeIndex(); return idx === null ? null : {idx, label:TYPES[idx].label, card:TYPES[idx].card}; }
function shareSlug(idx){ return (TYPES[idx].label.split(' ').slice(-1)[0] || 'type') + '-' + idx.toString(36); }
function shareLookup(slug){ const idx = TYPES.findIndex((_,i) => shareSlug(i) === slug); return idx < 0 ? null : idx; }
function cardImg(label, src, cls=''){ return `<img src="${src}" alt="${esc(label)} 결과 카드" class="${cls}">`; }
function profileLine(p){
  return [p.tempo >= 55 ? '빠른 전개' : '느긋한 흐름', p.mood >= 55 ? '묵직한 감정' : '가벼운 분위기', p.resolve >= 50 ? '깔끔한 해소감' : '여운 있는 전개', p.unusual >= 30 ? '낯선 설정' : '생활밀착 배경'].join(' · ');
}
function renderHistory(){
  const hist = Object.entries(state.feedback);
  $('feedback-history').innerHTML = hist.length ? hist.map(([id,f]) => {
    const w = BY_ID[id];
    const label = (FEEDBACK.find(x => x[0] === f.status) || [,''])[1];
    const reason = (STOP_REASONS.find(x => x[0] === f.reason) || [,''])[1];
    return `<div class="feed-line"><span>${esc(w ? w.title : '')} · ${esc(label)} ${reason ? '(' + esc(reason) + ')' : ''}</span><button type="button" data-undo="${id}">취소</button></div>`;
  }).join('') : '<p class="mini-info">아직 남긴 기록이 없어요.</p>';
}
function buildDescriptors(ref, cand){
  const d = [];
  if(Math.abs(ref.tempo - cand.tempo) <= 15) d.push(cand.tempo >= 55 ? '빠른전개' : '느긋한전개');
  if(Math.abs(ref.mood - cand.mood) <= 15) d.push(cand.mood >= 55 ? '묵직한분위기' : '편안한분위기');
  if(Math.abs(ref.resolve - cand.resolve) <= 15) d.push(cand.resolve >= 50 ? '사이다' : '여운');
  if(Math.abs(ref.unusual - cand.unusual) <= 18) d.push(cand.unusual >= 30 ? '낯선설정' : '현실밀착');
  if(!d.length) d.push((cand.tags && cand.tags[0]) || cand.media);
  return d.slice(0,4);
}
function noveltyLabel(source, cand){
  const parts = [];
  if(source.media !== cand.media) parts.push(`${cand.media}로확장`);
  if(Math.abs(source.unusual - cand.unusual) >= 18) parts.push(cand.unusual > source.unusual ? '더낯선설정' : '더현실적인배경');
  if(Math.abs(source.resolve - cand.resolve) >= 18) parts.push(cand.resolve > source.resolve ? '더깔끔한마무리' : '더긴여운');
  if(!parts.length) parts.push('취향확장');
  return parts.slice(0,3).join(' · ');
}
function chip(text, cls=''){
  const clean = String(text || '').trim();
  if(!clean) return '';
  return `<span class="tag-chip ${cls}">#${esc(clean.replace(/^#+/,''))}</span>`;
}
function chipRow(label, values, cls=''){
  const arr = [...new Set((values || []).filter(Boolean).map(v => String(v).trim()))].filter(Boolean);
  if(!arr.length) return '';
  return `<div class="fact-row"><span class="fact-label">${esc(label)}</span><div class="chip-wrap">${arr.map(v => chip(v, cls)).join('')}</div></div>`;
}
function styleTagsFor(w){
  const out=[];
  if(w.tempo >= 62) out.push('빠른전개'); else if(w.tempo <= 40) out.push('느긋한전개');
  if(w.mood <= 40) out.push('편안함'); else if(w.mood >= 68) out.push('묵직함');
  if(w.resolve >= 65) out.push('사이다'); else if(w.resolve <= 35) out.push('여운');
  if(w.unusual >= 72) out.push('비일상세계'); else if(w.unusual <= 25) out.push('현실밀착');
  return out.slice(0,4);
}
function recommendationFacts(o, mode){
  const w=o.work;
  let sourceWorks=[];
  let sourceLabel='비슷한 작품';
  if(mode==='match'){
    sourceWorks=(o.supportSources || o.sources || []).slice(0,6);
  } else if(mode==='similar') {
    sourceWorks=o.source ? [o.source] : [];
  } else {
    sourceWorks=o.source ? [o.source] : [];
    sourceLabel='연결 작품';
  }
  const sharedSpecific=(o.sharedTags || []).filter(t=>!GENERIC_TAGS.has(t));
  const group=semanticGroup(w);
  const contentTags=[...(sharedSpecific.length?sharedSpecific:(o.sharedTags||[]).slice(0,2)), ...(group?[group]:[]), ...(w.tags || []).slice(0,4)];
  const styleTags=[...(o.descriptors || []), ...styleTagsFor(w)];
  const platforms=(w.platforms || []).slice(0,4);
  const discovery = mode==='discover' ? String(o.novelty || '').split(' · ').filter(Boolean) : [];
  return `<div class="rec-facts">
    ${chipRow('플랫폼', platforms, 'platform-chip')}
    ${chipRow(sourceLabel, sourceWorks.map(x=>x.title), 'source-chip')}
    ${chipRow('태그', [...contentTags, ...styleTags], 'style-chip')}
    ${mode==='discover' ? chipRow('발견 포인트', discovery, 'discovery-chip') : ''}
  </div>`;
}
function pickUniqueRows(rows, limit, mediaCap=4, excludedKeys=new Set()){
  const out = [], seen = new Set(excludedKeys), mediaCount = {};
  for(const row of rows){
    if(out.length >= limit) break;
    const key = ipKey(row.work); if(seen.has(key)) continue;
    mediaCount[row.work.media] = mediaCount[row.work.media] || 0;
    if(mediaCount[row.work.media] >= mediaCap) continue;
    out.push(row); seen.add(key); mediaCount[row.work.media]++;
  }
  return out;
}
function recommend(){
  const positives = profileWorks();
  if(!positives.length) return {match:[], similar:[], discover:[]};
  const profile = scoreProfile(positives);
  const profileTags = topProfileTags(positives,8);
  const feedbackWorks = feedbackEntries().map(([w])=>w);
  const blockedIP = new Set([...chosen(), ...feedbackWorks].map(ipKey));
  const blockedIds = new Set([...state.selected, ...Object.keys(state.feedback)]);
  const base = WORKS.filter(w => !blockedIds.has(w.id) && !blockedIP.has(ipKey(w)) && !excludeCandidate(w) && (!state.preferredMedia.length || state.preferredMedia.includes(w.media)));

  const matchScored = base.map(w => {
    const m = supportMetrics(w, positives);
    const sourceRows = m.support.length ? m.support : m.rows.slice(0,2);
    return {
      work:w,
      score:matchAffinity(w, positives, profile, profileTags),
      supportSources:sourceRows.map(x=>x.source),
      supportCount:m.supportCount,
      sharedTags:(w.tags || []).filter(t => profileTags.includes(t)),
      descriptors:buildDescriptors(profile,w)
    };
  }).sort((a,b) => (b.supportCount-a.supportCount) || (b.score-a.score));
  const match = pickUniqueRows(matchScored,3,3);

  const pivot = BY_ID[state.pivot] || chosen()[0] || positives[0];
  const similarScored = base.map(w => {
    const ov = overlapInfo(pivot,w);
    return {work:w,score:similarAffinity(pivot,w),source:pivot,sharedTags:ov.tags,descriptors:buildDescriptors(pivot,w)};
  }).filter(x => x.score > 0.42).sort((a,b)=>b.score-a.score);
  const similar = pickUniqueRows(similarScored,3,3);

  const usedKeys = new Set([...match,...similar].map(x=>ipKey(x.work)));
  const discoverScored = base.map(w => {
    const pairs = positives.map(source => ({source, score:discoverAffinity(profile,source,w)})).sort((a,b)=>b.score-a.score);
    const source = pairs[0].source;
    const ov = overlapInfo(source,w);
    return {work:w,score:pairs[0].score,source,sharedTags:ov.tags,descriptors:buildDescriptors(profile,w),novelty:noveltyLabel(source,w)};
  }).filter(x => x.score > 0.36).sort((a,b)=>b.score-a.score);
  const discover = pickUniqueRows(discoverScored,3,3,usedKeys);
  return {match,similar,discover};
}
function feedbackMenu(w){
  const current = state.feedback[w.id];
  const buttons = FEEDBACK.map(([s,label]) => `<button type="button" data-feedback="${w.id}" data-fb-status="${s}" class="${current && current.status === s ? 'active' : ''}">${label}</button>`).join('');
  const stops = state.stopPending === w.id ? `<div class="feed-menu"><span class="inline-label" style="width:100%">괜찮다면 이유도 알려주세요 · 선택 사항</span>${STOP_REASONS.map(([s,label]) => `<button type="button" data-stop-reason="${w.id}" data-reason="${s}">${label}</button>`).join('')}</div>` : '';
  return `<div class="feed-menu">${buttons}</div>${stops}`;
}
function renderRecommendation(){
  REC = recommend();
  const mode = state.mode;
  document.querySelectorAll('#mode-tabs button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('mode-description').innerHTML = `<strong>${MODE_INFO[mode][0]}</strong> · ${MODE_INFO[mode][1]}`;
  $('pivot-control').classList.toggle('hidden', mode !== 'similar');
  $('pivot').innerHTML = chosen().map(w => `<option value="${w.id}">${esc(w.title)}</option>`).join('');
  $('pivot').value = state.pivot || state.selected[0];
  const data = REC[mode] || [];
  $('recommend-list').innerHTML = data.length ? data.map((r,i) => {
    const w = r.work;
    return `<article class="recommend">${poster(w,true)}<div class="rec-body"><div class="rec-header"><strong>${i+1}. ${esc(w.title)}</strong><span class="badge">${esc(w.media)}</span>${w.year ? `<span class="badge">${w.year}</span>` : ''}</div><div class="reason">${recommendationFacts(r,mode)}</div></div></article>`;
  }).join('') : `<div class="empty"><strong>추천 후보가 아직 없어요.</strong><br>선택한 작품을 조금 더 늘리거나, 피하고 싶은 조건을 줄이면 후보가 더 보일 수 있어요.</div>`;
  $('recommend-footnote').textContent = '';
  save();
}
function setFeedback(id, status, reason=null){
  if(status === 'stopped' && !reason){ state.stopPending = id; state.openFeedback = id; renderRecommendation(); return; }
  state.feedback[id] = {status, reason};
  state.stopPending = null; state.openFeedback = null;
  renderResult(true);
  toast('반응을 반영해 추천을 다시 계산했어요.');
}
function renderResult(preserve=false){
  if(state.selected.length < 5){ state.stage='select'; renderSelection(); toast('좋아하는 작품을 5편 이상 선택해 주세요.'); return; }
  showStage('result', !preserve);
  const t = classified();
  if(!t){ renderSelection(); return; }
  state.type = t.idx;
  state.pivot = state.pivot && state.selected.includes(state.pivot) ? state.pivot : state.selected[0];
  $('animal').innerHTML = cardImg(t.label, t.card);
  $('animal-title').textContent = '';
  $('animal-desc').textContent = '';
  $('confidence').textContent = '';
  $('result-picks').innerHTML = chosen().map((w,i) => `<div class="line">${i+1}. ${esc(w.title)}</div>`).join('');
  
  renderRecommendation();
  save();
}
function sharedCard(idx){ const t = TYPES[idx]; return `<div class="share-card card-image">${cardImg(t.label,t.card)}</div>`; }
function renderShare(idx){ showStage('share'); $('share-card').innerHTML = sharedCard(idx); }
function clearAll(){
  if(!window.confirm('선택한 작품과 감상 기록을 모두 초기화할까요?')) return;
  state = fresh(); history.replaceState(null,'',location.pathname + location.search);
  makeBatch(true); renderSelection(); toast('새로운 작품 목록으로 다시 시작합니다.');
}
function renderCatalogOnly(){
  const list = resultListing();
  $('catalog').innerHTML = list.length ? list.map(cardMarkup).join('') : '<div class="empty" style="grid-column:1/-1">검색 결과가 없어요. 제목을 바꿔 검색해 주세요.</div>';
  $('list-label').textContent = state.query ? `검색 결과 ${list.length}편` : state.all ? `전체 작품` : `작품 목록`;
  save();
}
function appStart(){
  const browseBtn = $('browse-animals'); if(browseBtn) browseBtn.remove();
  const seeAll = $('see-all'); if(seeAll) seeAll.remove();
  const browseSection = $('step-browse'); if(browseSection) browseSection.classList.add('hidden-legacy');
  const slug = new URLSearchParams(location.hash.slice(1)).get('share');
  const idx = slug ? shareLookup(slug) : null;
  if(idx !== null){ renderShare(idx); return; }
  if(!state.display.length) makeBatch(true);
  if(state.selected.length < 5 && state.stage !== 'select') state.stage = 'select';
  if(state.stage === 'result' && state.selected.length >= 5) renderResult();
  else if(state.stage === 'options' && state.selected.length >= 5) renderOptions();
  else renderSelection();
}

$('catalog').addEventListener('click', e => { const dislike=e.target.closest('[data-dislike]'); if(dislike){ toggleDislike(dislike.dataset.dislike); return; } const b = e.target.closest('[data-pick]'); if(b) togglePick(b.dataset.pick); });
[$('picked-pills'), $('sidebar-list')].forEach(parent => parent.addEventListener('click', e => { const b = e.target.closest('[data-remove]'); if(b) togglePick(b.dataset.remove); }));
const dislikedSummary=$('disliked-summary'); if(dislikedSummary) dislikedSummary.addEventListener('click',e=>{const b=e.target.closest('[data-undislike]'); if(b) toggleDislike(b.dataset.undislike);});
$('expand-picks').addEventListener('click', () => { state.expanded = !state.expanded; renderPickedSummary(); save(); });
$('search').addEventListener('compositionstart', () => composing = true);
$('search').addEventListener('compositionend', e => { composing = false; state.query = e.target.value; renderCatalogOnly(); });
$('search').addEventListener('input', e => { if(composing) return; state.query = e.target.value; renderCatalogOnly(); });
$('media-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-medium]'); if(!b) return;
  const medium = b.dataset.medium;
  if(medium === '전체'){
    state.mediaFilters = [];
  } else {
    const set = new Set(state.mediaFilters || []);
    if(set.has(medium)) set.delete(medium); else set.add(medium);
    state.mediaFilters = [...set];
  }
  state.query = ''; state.all = false; state.display = []; state.last = [];
  makeBatch(true); renderSelection();
});
$('refresh').addEventListener('click', () => { makeBatch(); renderSelection(true); requestAnimationFrame(() => { const target=$('catalog'); if(target) target.scrollIntoView({behavior:'smooth',block:'start'}); }); });
$('go-options').addEventListener('click', () => { if(state.selected.length < 5){ toast('좋아하는 작품을 5편 이상 선택해 주세요.'); return; } state.stage = 'options'; renderOptions(); });
$('back-select').addEventListener('click', () => { state.stage = 'select'; renderSelection(); });
$('exclude-opts').addEventListener('change', e => {
  if(!e.target.closest('input[type=checkbox]')) return;
  state.exclude = [...$('exclude-opts').querySelectorAll('input:checked')].map(x=>x.value);
  save();
});
$('preferred-media-opts').addEventListener('change', e => {
  if(!e.target.closest('input[type=checkbox]')) return;
  state.preferredMedia = [...$('preferred-media-opts').querySelectorAll('input:checked')].map(x=>x.value);
  $('finish').disabled = state.preferredMedia.length === 0;
  save();
});
$('finish').addEventListener('click', () => { if(!state.preferredMedia.length){ toast('추천받을 콘텐츠 유형을 하나 이상 선택해 주세요.'); return; } state.stage = 'result'; renderResult(); });
$('mode-tabs').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if(!b) return; state.mode = b.dataset.mode; state.openFeedback = null; state.stopPending = null; renderRecommendation(); });
$('pivot').addEventListener('change', e => { state.pivot = e.target.value; renderRecommendation(); });


function openResultCard(){ const idx=typeIndex(); if(idx===null) return; $('zoom-content').innerHTML=cardImg(TYPES[idx].label,TYPES[idx].card,'dialog-cardimg'); $('card-dialog').showModal(); }
const zoomBtn=$('zoom-card'); if(zoomBtn) zoomBtn.addEventListener('click',openResultCard);
const animalCard=$('animal'); if(animalCard){ animalCard.addEventListener('click',openResultCard); animalCard.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();openResultCard();} }); }
$('close-card').addEventListener('click', () => $('card-dialog').close());
function currentShareUrl(){
  const idx=typeIndex();
  if(idx===null) return null;
  const base=location.href.split('#')[0];
  return base + '#share=' + encodeURIComponent(shareSlug(idx));
}
async function copyShareLink(){
  const url=currentShareUrl();
  if(!url) return;
  try{ await navigator.clipboard.writeText(url); toast('공유 링크를 복사했어요.'); }
  catch(e){ const x=document.createElement('input'); x.value=url; document.body.appendChild(x); x.select(); const ok=document.execCommand('copy'); x.remove(); toast(ok?'공유 링크를 복사했어요.':'주소를 직접 복사해 주세요.'); }
}
const shareBtn=$('share-btn'); if(shareBtn) shareBtn.addEventListener('click',copyShareLink);
const copyTestLink=$('copy-test-link'); if(copyTestLink) copyTestLink.addEventListener('click',async()=>{
  const testUrl=location.href.split('#')[0];
  try{ await navigator.clipboard.writeText(testUrl); toast('취향테스트 링크를 복사했어요.'); }
  catch(e){ const x=document.createElement('input'); x.value=testUrl; document.body.appendChild(x); x.select(); const ok=document.execCommand('copy'); x.remove(); toast(ok?'취향테스트 링크를 복사했어요.':'주소를 직접 복사해 주세요.'); }
});

$('try-own').addEventListener('click', () => { history.replaceState(null,'',location.pathname + location.search); state = fresh(); makeBatch(true); renderSelection(); });
$('reset').addEventListener('click', clearAll);
window.addEventListener('hashchange', () => {
  const slug = new URLSearchParams(location.hash.slice(1)).get('share');
  const idx = slug ? shareLookup(slug) : null;
  if(idx !== null) renderShare(idx);
  else if(state.selected.length) renderResult();
  else renderSelection();
});
appStart();

