export const MEDIA = Object.freeze(['웹툰','OTT','영화','웹소설']);
export const MODEL_VERSION = 'media-v3-server-rank-1';
const AXES = Object.freeze(['tempo','mood','resolve','unusual']);
const features = new WeakMap();
const validScore = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
const count = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const list = value => Array.isArray(value) ? value : [];
export const canonicalMedia = value => value === '드라마·OTT' || value === '드라마' ? 'OTT' : value;

function feature(item) {
  if (!features.has(item)) features.set(item,{
    media:canonicalMedia(item.type ?? item.media),
    tags:new Set(list(item.tagSlugs)),
    engine:item.recommendation?.storyEnginePrimary ?? null,
    axes:item.recommendation?.axes ?? {},
    displayTags:new Set(list(item.tags))
  });
  return features.get(item);
}

function preference(profile = {}) {
  const learned = profile.learned ?? {};
  return {
    enabled:profile.enabled !== false,
    axes:Object.fromEntries(AXES.map(axis => [axis,validScore(profile.manualAxes?.[axis]) ?? validScore(learned[axis])])),
    tags:new Map(list(profile.tags).map(row => [row.tag_slug,row])),
    engines:new Map(list(profile.engines).map(row => [row.engine_slug,row])),
    learned
  };
}

function itemAllowed(item,profile) {
  const fields = feature(item);
  return Number.isSafeInteger(item.id) && item.id > 0 && MEDIA.includes(fields.media) && item.adult !== true && !(validScore(item.age) >= 18) && item.recommendation?.status !== 'HOLD' && profile.enabled && ![...fields.tags].some(tag => profile.tags.get(tag)?.excluded === true) && profile.engines.get(fields.engine)?.excluded !== true;
}

function evidenceScore(keys,direct,positive,negative,learned) {
  if (!keys.size) return {active:false,value:0};
  const preferred = [...direct].filter(([,row]) => Number.isInteger(row.preference_level) && row.preference_level !== 0 && Math.abs(row.preference_level) <= 2);
  let manual = 0;
  if (preferred.length) {
    manual = preferred.reduce((sum,[key,row]) => sum + (keys.has(key) ? row.preference_level / 2 : 0),0) / preferred.length;
  }
  const likes = count(learned.liked_count), dislikes = count(learned.disliked_count);
  const positiveKeys = Object.keys(positive ?? {}), negativeKeys = Object.keys(negative ?? {});
  let automatic = 0;
  if (positiveKeys.length && likes) automatic += [...keys].reduce((sum,key) => sum + Math.min(count(positive[key]) / likes,1),0) / Math.max(keys.size,1);
  if (negativeKeys.length && dislikes) automatic -= [...keys].reduce((sum,key) => sum + Math.min(count(negative[key]) / dislikes,1),0) / Math.max(keys.size,1);
  const hasManual = preferred.length > 0;
  const hasAutomatic = (positiveKeys.length > 0 && likes > 0) || (negativeKeys.length > 0 && dislikes > 0);
  return {active:hasManual || hasAutomatic,value:hasManual && hasAutomatic ? manual * .6 + automatic * .4 : hasManual ? manual : automatic};
}

function affinity(item,profile) {
  const fields = feature(item), learned = profile.learned;
  const distances = AXES.flatMap(axis => {
    const target = profile.axes[axis], actual = validScore(fields.axes[axis]);
    return target === null || actual === null ? [] : [1 - Math.abs(target - actual) / 100];
  });
  const tags = evidenceScore(fields.tags,profile.tags,learned.liked_tag_counts,learned.disliked_tag_counts,learned);
  const engines = evidenceScore(new Set(fields.engine ? [fields.engine] : []),profile.engines,learned.liked_primary_engine_counts,learned.disliked_primary_engine_counts,learned);
  const signals = [];
  if (distances.length) signals.push([distances.reduce((sum,value) => sum + value,0) / distances.length,.65]);
  if (tags.active) signals.push([(tags.value + 1) / 2,.25]);
  if (engines.active) signals.push([(engines.value + 1) / 2,.1]);
  const weight = signals.reduce((sum,signal) => sum + signal[1],0);
  return {active:signals.length > 0,value:weight ? signals.reduce((sum,signal) => sum + signal[0] * signal[1],0) / weight : 0};
}

function interleave(groups,limit = Infinity) {
  const result = [], seen = new Set();
  let position = 0;
  while (result.length < limit && groups.some(group => position < group.length)) {
    for (const group of groups) {
      const item = group[position];
      if (item && !seen.has(item.id)) {result.push(item);seen.add(item.id);}
      if (result.length >= limit) break;
    }
    position += 1;
  }
  return result;
}

export function officialPopular(items,popular = {},limit = 5) {
  const byId = new Map(items.map(item => [item.id,item]));
  const groups = MEDIA.map(media => {
    const rows = list(popular.lists).filter(source => source.status === 'available' && canonicalMedia(source.media) === media).flatMap(source => list(source.entries).filter(entry => entry.status === 'available' && Number.isSafeInteger(entry.rank) && entry.rank > 0 && byId.has(entry.catalogId)).map(entry => ({item:byId.get(entry.catalogId),rank:entry.rank,source:source.id ?? ''})));
    return rows.sort((left,right) => left.rank - right.rank || left.source.localeCompare(right.source) || left.item.id - right.item.id).filter(row => canonicalMedia(row.item.type) === media).map(row => row.item);
  });
  return interleave(groups,limit);
}

function ranked(items,profiles,popular) {
  const normalized = Object.fromEntries(MEDIA.map(media => [media,preference(profiles?.[media])]));
  const eligible = items.filter(item => itemAllowed(item,normalized[feature(item).media] ?? preference({enabled:false})));
  const popularOrder = new Map(officialPopular(eligible,popular,Infinity).map((item,index) => [item.id,index]));
  const fallback = (left,right) => (popularOrder.get(left.id) ?? Infinity) - (popularOrder.get(right.id) ?? Infinity) || Number(Boolean(right.image)) - Number(Boolean(left.image)) || left.id - right.id;
  const personalizedRows = [];
  const groups = MEDIA.map(media => {
    const rows = eligible.filter(item => feature(item).media === media).map(item => ({item,match:affinity(item,normalized[media])}));
    rows.sort((left,right) => Number(right.match.active) - Number(left.match.active) || right.match.value - left.match.value || fallback(left.item,right.item));
    personalizedRows.push(...rows.filter(row => row.match.active));
    return {personal:rows.filter(row => row.match.active).map(row => row.item),general:rows.filter(row => !row.match.active).map(row => row.item)};
  });
  const general = interleave(groups.map(group => group.general));
  const heroItems = [...personalizedRows.sort((left,right) => right.match.value - left.match.value || left.item.id - right.item.id).map(row => row.item),...general];
  return {items:[...interleave(groups.map(group => group.personal)),...general],heroItems,personalized:groups.some(group => group.personal.length > 0),eligible,normalized};
}

function demographicLabel(demographics,now = Date.now()) {
  const year = new Date(now).getUTCFullYear();
  if (!['male','female'].includes(demographics?.gender) || !Number.isInteger(demographics?.birthyear) || demographics.birthyear < year - 120 || demographics.birthyear > year) return null;
  const age = year - demographics.birthyear;
  const ageBand = age < 10 ? '10세 미만' : `${Math.floor(age / 10) * 10}대`;
  return `${ageBand} ${demographics.gender === 'male' ? '남성' : '여성'}을 위한 추천`;
}

export function recommendHome(items,options = {}) {
  const ordered = ranked(items,options.profiles,options.popular);
  const canRecommend = item => !options.excludedIds?.has(item.id);
  const hero = ordered.heroItems.filter(canRecommend).slice(0,10), heroIds = new Set(hero.map(item => item.id));
  const candidates = ordered.items.filter(item => !heroIds.has(item.id) && canRecommend(item));
  const discovery = interleave(MEDIA.map(media => candidates.filter(item => feature(item).media === media)),6);
  const available = new Map(ordered.eligible.filter(canRecommend).map(item => [item.id,item]));
  const audienceLabel = demographicLabel(options.demographics,options.now);
  const demographicReady = Boolean(audienceLabel);
  const cohort = demographicReady ? list(options.cohort).filter(row => count(row.liked_count) >= 3 && available.has(row.content_id)).sort((left,right) => right.liked_count - left.liked_count || left.content_id - right.content_id).map(row => available.get(row.content_id)) : [];
  const distinctCohort = [...new Map(cohort.map(item => [item.id,item])).values()];
  const official = officialPopular(ordered.eligible.filter(canRecommend),options.popular,5);
  const sidebar = distinctCohort.length >= 5 ? distinctCohort.slice(0,5) : official;
  return {
    heroIds:hero.map(item => item.id),discoveryIds:discovery.map(item => item.id),sidebarIds:sidebar.map(item => item.id),rankingIds:ordered.items.map(item => item.id),personalized:ordered.personalized,
    sidebar:distinctCohort.length >= 5
      ? {kind:'demographic',label:audienceLabel,note:'같은 나이대·성별 이용자가 좋아한 작품이에요.'}
      : {kind:'popular',label:audienceLabel || '전체 인기 추천',note:!audienceLabel ? '공식 플랫폼별 인기 순위에서 골랐어요.' : ['not_configured','unavailable'].includes(options.profileStatus) ? '맞춤 추천을 준비하는 동안 전체 인기 작품을 먼저 보여드려요.' : '또래 평가가 부족해 전체 인기 작품을 먼저 보여드려요.'}
  };
}

export function recommendSimilar(seedId,items,options = {}) {
  const seed = items.find(item => item.id === seedId);
  if (!seed || seed.adult === true || validScore(seed.age) >= 18 || seed.recommendation?.status === 'HOLD') return [];
  const seedFeature = feature(seed), ordered = ranked(items,options.profiles,options.popular);
  return ordered.eligible.filter(item => item.id !== seedId && !options.excludedIds?.has(item.id)).map(item => {
    const other = feature(item), union = new Set([...seedFeature.displayTags,...other.displayTags]);
    const common = [...seedFeature.displayTags].filter(tag => other.displayTags.has(tag)).length;
    const tagScore = union.size ? common / union.size : null;
    const axes = AXES.flatMap(axis => {
      const left = validScore(seedFeature.axes[axis]), right = validScore(other.axes[axis]);
      return left === null || right === null ? [] : [1 - Math.abs(left - right) / 100];
    });
    const axisScore = axes.length ? axes.reduce((sum,value) => sum + value,0) / axes.length : null;
    const similarity = tagScore !== null && axisScore !== null ? tagScore * .5 + axisScore * .5 : tagScore ?? axisScore ?? 0;
    const match = affinity(item,ordered.normalized[other.media]);
    return {item,similarity,value:match.active ? similarity * .85 + match.value * .15 : similarity};
  }).filter(row => row.similarity > 0).sort((left,right) => right.value - left.value || left.item.id - right.item.id).slice(0,Math.min(options.limit ?? 6,20)).map(row => row.item.id);
}
