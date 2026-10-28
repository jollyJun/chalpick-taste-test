export const ADULT_PLACEHOLDER = '/assets/adult-placeholder.svg';

const ROLE_LABELS = Object.freeze({STORY_WRITER:'글',LEAD_ARTIST:'그림',ORIGINAL_AUTHOR:'원작',ADAPTATION_WRITER:'각색',DIRECTOR:'감독',SCREENWRITER:'각본',LEAD_ACTOR:'주요 출연',SUPPORT_ACTOR:'조연'});
const ROLE_ORDER = new Map(Object.keys(ROLE_LABELS).map((role,index) => [role,index]));
const GROUPS = Object.freeze([
  {id:'genre',category:'genre',label:'장르'},
  {id:'setting',category:'setting_premise',label:'소재·배경'},
  {id:'relationship',category:'character_relationship',label:'인물·관계'}
]);
const CATEGORY_GROUP = new Map(GROUPS.map(group => [group.category,group.id]));
const PLATFORM_VERIFICATION = new Set(['verified','partial','partially_verified']);
const PLATFORM_ROLES = new Map([['availability',0],['current_edition_provider',1],['origin',2]]);
const MEDIA = new Set(['웹툰','웹소설','OTT','영화','드라마']);
const MOMENT_IDS = Object.freeze({
  anniversary_tags: {'새해':'new-year','설날':'seollal','삼일절':'independence-march','3·1절':'independence-march','3.1절':'independence-march','어린이날':'children','어버이날':'parents','현충일':'memorial','광복절':'liberation','추석':'chuseok','개천절':'foundation','한글날':'hangul','크리스마스':'christmas','발렌타인데이':'valentine','밸런타인데이':'valentine','화이트데이':'white-day','스승의날':'teachers','식목일':'arbor','할로윈':'halloween'},
  season_tags: {'봄':'spring','여름':'summer','가을':'autumn','겨울':'winter'},
  weather_tags: {'비/폭풍':'rain','비·폭풍':'rain','비':'rain','폭풍':'rain','눈':'snow'}
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value) {
  return text(value) || null;
}

function number(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function positiveId(value) {
  const result = number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function boolean(value) {
  if (value === true || value === 'true' || value === 'True') return true;
  if (value === false || value === 'false' || value === 'False') return false;
  return null;
}

function stringList(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
}

function safeUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value.trim());
    return ['http:','https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? value.trim() : null;
  } catch { return null; }
}

function sourceUrl(value) {
  return safeUrl(text(value).match(/https?:\/\/[^\s;|]+/u)?.[0]);
}

function rows(tables, name) {
  const value = tables[name];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new TypeError(`Invalid catalog table: ${name}`);
  return value;
}

function indexBy(values, key) {
  const result = new Map();
  for (const value of values) result.set(String(value[key]),value);
  return result;
}

function groupBy(values, key) {
  const result = new Map();
  for (const value of values) {
    const group = String(value[key]);
    if (!result.has(group)) result.set(group,[]);
    result.get(group).push(value);
  }
  return result;
}

function ageFor(row, ageRatings) {
  const stored = ageRatings instanceof Map ? ageRatings.get(Number(row.id)) ?? ageRatings.get(String(row.id)) : ageRatings?.[row.id];
  const bound = stored && (!stored.title || stored.title === row.title) && (!stored.media || stored.media === row.media);
  const rating = bound ? stored : null;
  const age = number(rating?.age);
  const adult = boolean(rating?.adult);
  const placeholder = [row.thumbnail_url,row.poster_url,row.origin_image_url].some(value => /^data:image\//iu.test(text(value)));
  const explicitAdultEdition = /(?:\[|\(|【)\s*(?:18|19)\s*세/u.test(text(row.title));
  if (placeholder || explicitAdultEdition || adult === true || (age !== null && age >= 18)) return {adult:true,age:age ?? (placeholder || explicitAdultEdition ? 19 : null)};
  if (adult === false || (age !== null && [0,7,12,15].includes(age))) return {adult:false,age};
  return {adult:null,age:null};
}

function creditsFor(values, persons) {
  const credits = [];
  const ordered = [...values].sort((left,right) => (ROLE_ORDER.get(left.creator_role) ?? 99) - (ROLE_ORDER.get(right.creator_role) ?? 99) || (number(left.credit_order) ?? 999) - (number(right.credit_order) ?? 999) || (number(left.id) ?? 0) - (number(right.id) ?? 0));
  for (const credit of ordered) {
    const person = persons.get(String(credit.person_id));
    const name = text(person?.name);
    if (!name || !positiveId(person.id)) continue;
    const role = text(credit.creator_role);
    const roleLabel = role === 'SUPPORT_ACTOR' && credit.verification_status === 'verified_cast_billing_unspecified' ? '출연' : Object.hasOwn(ROLE_LABELS,role) ? ROLE_LABELS[role] : role;
    const collective = person.external_person_id === 'naver_artist_305532';
    const identityKey = collective ? null : optionalText(person.external_person_id);
    credits.push({
      id:positiveId(person.id),name,role,roleLabel,
      identityKey,identityConfidence:collective ? 'collective_account' : identityKey ? 'verified_external_id' : 'content_scoped',
      candidateKey:collective ? null : `${role}:${text(person.normalized_name) || name}`,
      sourceUrl:sourceUrl(credit.source_url)
    });
  }
  return credits;
}

function platformsFor(values) {
  const ordered = [...values].sort((left,right) => Number(boolean(right.is_available) === true) - Number(boolean(left.is_available) === true) || Number(right.verification_status === 'verified') - Number(left.verification_status === 'verified') || (PLATFORM_ROLES.get(left.platform_role) ?? 9) - (PLATFORM_ROLES.get(right.platform_role) ?? 9) || (number(right.id) ?? 0) - (number(left.id) ?? 0));
  const platforms = new Map();
  for (const row of ordered) {
    const name = text(row.platform);
    const url = safeUrl(row.watch_url);
    if (!name || !url || boolean(row.is_available) === false || !PLATFORM_VERIFICATION.has(row.verification_status) || platforms.has(name)) continue;
    platforms.set(name,{name,url});
  }
  return [...platforms.values()];
}

function contextFor(row) {
  return [...new Set(Object.entries(MOMENT_IDS).flatMap(([column,labels]) => stringList(row[column]).map(label => label.replace(/\s/gu,'')).filter(label => Object.hasOwn(labels,label)).map(label => labels[label])))];
}

function countBy(values, key) {
  const result = Object.create(null);
  for (const value of values) result[value[key]] = (result[value[key]] || 0) + 1;
  return {...result};
}

export function buildCatalog(tables, {ageRatings = {},fetchedAt = new Date().toISOString()} = {}) {
  if (!tables || typeof tables !== 'object' || !Array.isArray(tables.contents)) throw new TypeError('Catalog contents are required');
  const contents = rows(tables,'contents');
  const persons = indexBy(rows(tables,'persons'),'id');
  const dictionaries = rows(tables,'tag_dictionary');
  const tags = indexBy(dictionaries.filter(tag => CATEGORY_GROUP.has(tag.category) && text(tag.tag_slug) && text(tag.display_name)),'tag_slug');
  const credits = groupBy(rows(tables,'content_creators'),'content_id');
  const platforms = groupBy(rows(tables,'content_platforms'),'content_id');
  const complexities = indexBy(rows(tables,'content_complexity'),'content_id');
  const identifiers = new Set();
  const items = [];
  for (const row of contents) {
    const id = positiveId(row.id);
    if (!id || identifiers.has(id) || !text(row.title)) throw new TypeError('Catalog contains an invalid or duplicate work');
    identifiers.add(id);
    if (!MEDIA.has(row.media)) continue;
    const rating = ageFor(row,ageRatings);
    const slugs = stringList(row.tag_slugs_cache);
    const tagGroups = {genre:[],setting:[],relationship:[]};
    for (const slug of slugs) {
      const tag = tags.get(slug);
      if (tag) tagGroups[CATEGORY_GROUP.get(tag.category)].push(tag.display_name);
    }
    for (const key of Object.keys(tagGroups)) tagGroups[key] = [...new Set(tagGroups[key])];
    const publicCredits = creditsFor(credits.get(String(row.id)) || [],persons);
    const complexity = complexities.get(String(row.id)) || {};
    const analysisState = optionalText(complexity.analysis_state);
    const publicComplexity = Object.fromEntries(['overall','tracking','character','faction','naming','relationship','lore'].map(key => [key,number(complexity[`${key}_complexity`]) ?? number(row[`${key}_complexity`])]));
    items.push({
      id,title:text(row.title),type:row.media,genre:tagGroups.genre[0] || '기타',
      tags:[...new Set(Object.values(tagGroups).flat())],tagSlugs:slugs,tagGroups,
      description:optionalText(row.synopsis),year:number(row.release_year),
      creators:[...new Set(publicCredits.map(credit => credit.name))],credits:publicCredits,
      platforms:platformsFor(platforms.get(String(row.id)) || []),
      image:rating.adult ? ADULT_PLACEHOLDER : safeUrl(row.thumbnail_url) || safeUrl(row.origin_image_url) || safeUrl(row.poster_url),
      adult:rating.adult,age:rating.age,ipId:optionalText(row.ip_id),
      recommendation:{
        tier:number(row.tier),axes:Object.fromEntries(['tempo','mood','resolve','unusual'].map(key => [key,number(row[key])])),
        storyEnginePrimary:optionalText(row.story_engine_primary),storyEngineSecondary:optionalText(row.story_engine_secondary),
        worldModel:optionalText(row.world_model),fantasyPresence:optionalText(row.fantasy_presence),
        complexity:publicComplexity,analysisState,provisional:analysisState !== 'VERIFIED',status:optionalText(row.recommendation_status)
      },
      contextTags:contextFor(row)
    });
  }
  const countsAll = new Map();
  const countsPublic = new Map();
  for (const item of items) {
    for (const slug of item.tagSlugs) {
      countsAll.set(slug,(countsAll.get(slug) || 0) + 1);
      if (item.adult !== true) countsPublic.set(slug,(countsPublic.get(slug) || 0) + 1);
    }
  }
  const updatedAt = typeof fetchedAt === 'string' ? fetchedAt : new Date(fetchedAt).toISOString();
  const groups = GROUPS.map(group => {
    const groupTags = [...tags.values()].filter(tag => tag.category === group.category).map(tag => ({
      slug:tag.tag_slug,label:tag.display_name,count:countsPublic.get(tag.tag_slug) || 0,countAll:countsAll.get(tag.tag_slug) || 0,
      aliases:Array.isArray(tag.aliases) ? stringList(tag.aliases) : [...new Set(text(tag.aliases).split(/[,;|]/u).map(value => value.trim()).filter(Boolean))],
      definition:text(tag.definition)
    }));
    return {id:group.id,label:group.label,count:groupTags.length,tags:groupTags};
  });
  return {
    items,updatedAt,sourceCount:contents.length,
    taxonomy:{
      updatedAt,totalTags:tags.size,groups,countScope:'count: 확인된 성인 작품 제외; countAll: 애니메이션을 제외한 전체 작품',roles:{...ROLE_LABELS},
      storyEngines:rows(tables,'story_engine_dictionary').filter(engine => text(engine.engine_slug)).map(engine => ({slug:engine.engine_slug,label:text(engine.display_name),definition:text(engine.definition)}))
    },
    counts:{total:items.length,byType:countBy(items,'type'),adult:items.filter(item => item.adult === true).length,nonAdultConfirmed:items.filter(item => item.adult === false).length,ageUnconfirmed:items.filter(item => item.adult === null).length,visible:items.filter(item => item.adult !== true).length,excludedUnsupportedMedia:contents.length - items.length}
  };
}
