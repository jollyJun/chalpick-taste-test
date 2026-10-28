// Context themes are editorial metadata. A genre alone never qualifies a work.
export const CONTEXT_ROTATION_KEY = 'chalpick-context-rotation-v1';
export const CONTEXT_WEIGHTS = Object.freeze({weather: 6, event: 3, season: 1});

export const THEMES = Object.freeze([
  {id:'spring',group:'season',label:'봄',title:'봄빛을 닮은 이야기',description:'꽃이 피는 계절, 봄 추천 목록에서 고른 작품을 만나보세요.',icon:'✿',background:'spring'},
  {id:'summer',group:'season',label:'여름',title:'여름이 머무는 장면들',description:'여름의 풍경과 공기를 담은 추천작을 모았어요.',icon:'☀',background:'summer'},
  {id:'autumn',group:'season',label:'가을',title:'가을에 오래 머물고 싶은 이야기',description:'가을 추천 목록에서 찾은, 이 계절의 여운을 담은 작품들.',icon:'◒',background:'autumn'},
  {id:'winter',group:'season',label:'겨울',title:'겨울을 담은 한 편',description:'겨울의 풍경과 온기를 담은 추천작을 만나보세요.',icon:'❄',background:'winter'},
  {id:'rain',group:'weather',label:'비·폭풍',title:'빗소리에 어울리는 이야기',description:'비와 폭풍이 등장하거나, 비 오는 날의 추천작으로 고른 이야기.',icon:'☂',background:'rain'},
  {id:'snow',group:'weather',label:'눈',title:'눈 내리는 날의 한 편',description:'눈 덮인 풍경과 설경이 기억에 남는 작품을 모았어요.',icon:'❄',background:'snow'},
  {id:'new-year',group:'event',label:'새해',title:'새로운 한 해, 새로운 이야기',description:'새로운 시작을 담은 새해 추천작을 만나보세요.',icon:'✦',background:'new-year',month:1,day:1},
  {id:'seollal',group:'event',label:'설날',title:'설날, 함께 나누는 한 편',description:'설 명절에 함께 보기 좋은 작품을 모았어요.',icon:'◈',background:'seollal'},
  {id:'valentine',group:'event',label:'발렌타인데이',title:'마음을 전하는 이야기',description:'발렌타인데이 추천 목록에서 고른 사랑의 이야기를 만나보세요.',icon:'♡',background:'spring',month:2,day:14},
  {id:'independence-march',group:'event',label:'3·1절',title:'그날의 용기를 기억하며',description:'독립을 향한 마음과 역사를 담은 이야기.',icon:'✦',background:'remembrance',month:3,day:1},
  {id:'white-day',group:'event',label:'화이트데이',title:'달콤한 마음을 나누는 날',description:'화이트데이에 추천된 로맨스 작품을 만나보세요.',icon:'♡',background:'spring',month:3,day:14},
  {id:'arbor',group:'event',label:'식목일',title:'초록을 생각하는 이야기',description:'식목일 추천 목록에서 찾은 자연과 함께하는 이야기.',icon:'✿',background:'spring',month:4,day:5},
  {id:'children',group:'event',label:'어린이날',title:'작은 마음이 꿈꾸는 큰 세상',description:'어린이날에 함께 볼 작품을 만나보세요.',icon:'☆',background:'children',month:5,day:5},
  {id:'parents',group:'event',label:'어버이날',title:'고마운 마음을 전하는 이야기',description:'부모와 가족을 돌아보는 어버이날 추천작.',icon:'♡',background:'parents',month:5,day:8},
  {id:'teachers',group:'event',label:'스승의 날',title:'배움과 고마움을 담은 이야기',description:'스승의 날에 추천된, 가르침과 성장의 작품을 만나보세요.',icon:'✧',background:'parents',month:5,day:15},
  {id:'memorial',group:'event',label:'현충일',title:'잊지 않고 기억하는 이야기',description:'희생과 기억을 되새기는 현충일의 작품들.',icon:'✦',background:'remembrance',month:6,day:6},
  {id:'liberation',group:'event',label:'광복절',title:'광복절에 돌아보는 이야기',description:'독립과 해방의 기억을 담은 작품을 만나보세요.',icon:'✦',background:'remembrance',month:8,day:15},
  {id:'chuseok',group:'event',label:'추석',title:'보름달 아래, 함께 보는 이야기',description:'추석 명절에 함께 보기 좋은 작품을 모았어요.',icon:'◕',background:'chuseok'},
  {id:'foundation',group:'event',label:'개천절',title:'우리의 시작을 돌아보는 이야기',description:'개천절과 이어지는 역사와 문화의 이야기.',icon:'✧',background:'remembrance',month:10,day:3},
  {id:'hangul',group:'event',label:'한글날',title:'우리말에 담긴 마음',description:'한글과 우리말의 가치를 담은 작품을 만나보세요.',icon:'가',background:'hangul',month:10,day:9},
  {id:'halloween',group:'event',label:'할로윈',title:'오싹한 상상이 찾아오는 밤',description:'할로윈 추천 목록에서 고른 특별한 이야기를 만나보세요.',icon:'☾',background:'autumn',month:10,day:31},
  {id:'christmas',group:'event',label:'크리스마스',title:'크리스마스가 찾아오는 이야기',description:'크리스마스의 풍경과 마음을 담은 작품을 모았어요.',icon:'✧',background:'christmas',month:12,day:25}
].map(theme => Object.freeze(theme)));

// Only verified Gregorian dates are used for lunar holidays. Do not extrapolate
// using the Chinese calendar: its civil dates can differ from Korea's calendar.
export const LUNAR_HOLIDAYS = Object.freeze({
  2025: Object.freeze({seollal:'01-29',chuseok:'10-06'}),
  2026: Object.freeze({seollal:'02-17',chuseok:'09-25'}),
  2027: Object.freeze({seollal:'02-07',chuseok:'09-15'})
});
export const CALENDAR_SOURCES = Object.freeze([
  {year:2025,url:'https://www.kasi.re.kr/kor/publication/post/newsMaterial/30071'},
  {year:2026,url:'https://www.kasa.go.kr/bbs/BBSMSTR_000000000010/view.do?nttId=B000000001860Pe2zT3'},
  {year:2027,url:'https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431'}
]);

const DAY_MS = 86_400_000;
const SEOUL_FORMAT = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
const GROUP_ORDER = Object.keys(CONTEXT_WEIGHTS);
const emptyRotation = () => ({version:1,schedules:{},lastEventId:null});
let memoryRotation = emptyRotation();
const storageSnapshots = new WeakMap();
const unsavedRotations = new WeakMap();
const isStorageObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');

export function themeById(id) { return THEMES.find(theme => theme.id === id); }

export function matchesTheme(item, theme) {
  if (!theme) return true;
  const id = typeof theme === 'string' ? theme : theme.id;
  return Boolean(themeById(id) && Array.isArray(item.contextTags) && item.contextTags.includes(id));
}

export function seoulParts(date = new Date()) {
  return Object.fromEntries(SEOUL_FORMAT.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type,Number(part.value)]));
}

function seasonForMonth(month) {
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
}

export function activeKoreanEvents(date = new Date()) {
  const {year,month,day} = seoulParts(date);
  const today = Date.UTC(year,month - 1,day);
  const active = [];
  // Adjacent years make Dec 25–Jan 8 work without special month arithmetic.
  for (const eventYear of [year - 1,year,year + 1]) {
    for (const theme of THEMES.filter(theme => theme.group === 'event')) {
      const lunarDate = LUNAR_HOLIDAYS[eventYear]?.[theme.id];
      if (!theme.month && !lunarDate) continue;
      const [eventMonth,eventDay] = lunarDate ? lunarDate.split('-').map(Number) : [theme.month,theme.day];
      const timestamp = Date.UTC(eventYear,eventMonth - 1,eventDay);
      const daysUntil = (timestamp - today) / DAY_MS;
      if (Math.abs(daysUntil) <= 7) active.push({id:theme.id,theme,year:eventYear,month:eventMonth,day:eventDay,daysUntil,timestamp});
    }
  }
  return active.sort((left,right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
}

export function currentThemeIds(date = new Date()) {
  const parts = seoulParts(date);
  const events = activeKoreanEvents(date).map(event => event.id);
  return {season:seasonForMonth(parts.month),event:events[0] || null,events};
}

function weatherId(weather) {
  if (weather && typeof weather === 'object' && weather.available === false) return null;
  const value = typeof weather === 'string' ? weather : weather?.condition ?? weather?.kind;
  return value === 'rain' || value === 'snow' ? value : null;
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function cleanRotation(value) {
  if (!value || value.version !== 1 || typeof value.schedules !== 'object' || value.schedules === null) return emptyRotation();
  const state = emptyRotation();
  state.lastEventId = themeById(value.lastEventId)?.group === 'event' ? value.lastEventId : null;
  // There are seven nonempty combinations of the three groups. Reject arbitrary
  // stored keys and scores so a stale or edited storage value cannot bias picks.
  for (let mask = 1; mask < 8; mask++) {
    const groups = GROUP_ORDER.filter((_,index) => mask & (1 << index));
    const key = groups.join('|');
    const scores = value.schedules[key];
    const total = groups.reduce((sum,group) => sum + CONTEXT_WEIGHTS[group],0);
    if (!scores || typeof scores !== 'object') continue;
    if (groups.some(group => !Number.isInteger(scores[group]) || Math.abs(scores[group]) > total)) continue;
    if (groups.reduce((sum,group) => sum + scores[group],0) !== 0) continue;
    state.schedules[key] = Object.fromEntries(groups.map(group => [group,scores[group]]));
  }
  return state;
}

function loadRotation(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return cleanRotation(memoryRotation);
    const raw = storage.getItem(CONTEXT_ROTATION_KEY);
    const unsaved = unsavedRotations.get(storage);
    storageSnapshots.set(storage,raw);
    // A quota error can leave reads working while writes keep failing. Resume
    // the newest in-memory cursor until storage actually changes or recovers.
    if (unsaved && unsaved.snapshot === raw) return cleanRotation(unsaved.state);
    unsavedRotations.delete(storage);
    return cleanRotation(JSON.parse(raw || 'null'));
  } catch { return cleanRotation(isStorageObject(storage) ? unsavedRotations.get(storage)?.state || memoryRotation : memoryRotation); }
}

function saveRotation(storage, state) {
  memoryRotation = state;
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(CONTEXT_ROTATION_KEY,JSON.stringify(state));
    unsavedRotations.delete(storage);
    return true;
  } catch {
    if (isStorageObject(storage)) unsavedRotations.set(storage,{snapshot:storageSnapshots.get(storage),state});
    return false;
  }
}

/**
 * Call exactly once after weather resolution for each page visit, then keep the
 * returned object for re-renders. This function deliberately advances rotation.
 * Unavailable groups lose their weight; the remaining weights are normalized.
 * If browser storage is blocked/full, rotation survives only in this runtime;
 * it cannot be restored after a page reload until writes become available again.
 */
export function chooseVisitTheme({items = [],date = new Date(),weather = null,storage = defaultStorage()} = {}) {
  const season = currentThemeIds(date).season;
  const currentWeather = weatherId(weather);
  const calendarEvents = activeKoreanEvents(date);
  const eligible = items.filter(item => item.adult !== true);
  const hasWorks = id => eligible.some(item => matchesTheme(item,id));
  const events = calendarEvents.filter(event => hasWorks(event.id));
  const candidates = {
    weather:currentWeather && hasWorks(currentWeather) ? [themeById(currentWeather)] : [],
    event:events.map(event => event.theme),
    season:hasWorks(season) ? [themeById(season)] : []
  };
  const availableGroups = GROUP_ORDER.filter(group => candidates[group].length);
  const total = availableGroups.reduce((sum,group) => sum + CONTEXT_WEIGHTS[group],0);
  const weights = Object.fromEntries(availableGroups.map(group => [group,CONTEXT_WEIGHTS[group]]));
  const probabilities = Object.fromEntries(availableGroups.map(group => [group,CONTEXT_WEIGHTS[group] / total]));
  const result = {theme:null,group:null,availableGroups,weights,probabilities,activeEventIds:events.map(event => event.id),calendarEventIds:calendarEvents.map(event => event.id),season,weather:currentWeather,rotationPersisted:false,lunarCalendarSupported:Boolean(LUNAR_HOLIDAYS[seoulParts(date).year])};
  if (!total) return result;

  const state = loadRotation(storage);
  const key = availableGroups.join('|');
  const scores = state.schedules[key] || Object.fromEntries(availableGroups.map(group => [group,0]));
  let group = availableGroups[0];
  for (const candidate of availableGroups) scores[candidate] += CONTEXT_WEIGHTS[candidate];
  for (const candidate of availableGroups) if (scores[candidate] > scores[group]) group = candidate;
  scores[group] -= total;
  state.schedules[key] = scores;

  let theme = candidates[group][0];
  if (group === 'event') {
    const previous = candidates.event.findIndex(event => event.id === state.lastEventId);
    theme = candidates.event[(previous + 1) % candidates.event.length];
    state.lastEventId = theme.id;
  }
  return {...result,theme,group,rotationPersisted:saveRotation(storage,state)};
}
