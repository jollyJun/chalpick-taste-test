import {safePublicURL,safeImageURL} from './catalog-client.js';
function creatorCredits(item) {
  const roles = ['영화','드라마','OTT','드라마·OTT'].includes(item.type) ? ['DIRECTOR'] : ['STORY_WRITER','LEAD_ARTIST','ORIGINAL_AUTHOR','ADAPTATION_WRITER'];
  return (item.credits || []).filter(credit => roles.includes(credit.role) && credit.identityConfidence !== 'collective_account');
}
function sameCreatorWorks(seed, items) {
  const credits = creatorCredits(seed);
  return items.filter(item => item.id !== seed.id && item.adult !== true).map(item => ({item, matches:creatorCredits(item).filter(other => credits.some(credit => credit.role === other.role && credit.identityKey && credit.identityKey === other.identityKey))})).filter(row => row.matches.length).sort((left,right) => right.matches.length-left.matches.length || left.item.id-right.item.id);
}

export const POPULAR_MEDIA_ORDER = Object.freeze(['웹툰', '드라마·OTT', '영화', '웹소설']);
const screenMedia = new Set(['영화', '드라마', 'OTT', '드라마·OTT']);
const actorRoles = new Set(['LEAD_ACTOR', 'SUPPORT_ACTOR']);
const publicWork = item => item && item.adult !== true && !(item.age != null && Number(item.age) >= 18) && item.type !== '애니메이션';
export const popularMedia = value => ['드라마', 'OTT'].includes(value) ? '드라마·OTT' : value;
export const popularCoverSymbol = (media, title) => ['드라마·OTT', '영화'].includes(popularMedia(media)) ? '▶' : String(title || '').slice(0, 1);

export function popularCoverItem(entry, item) {
  if (item && safeImageURL(item.image)) return item;
  const verification = entry.imageVerification, image = safePublicURL(entry.image);
  if (!image || verification?.sourcePage !== entry.url || verification?.titleId !== entry.seriesTitleId || verification?.title !== entry.localizedTitle || verification?.imageURL !== image || verification?.httpStatus !== 200) return null;
  return {image, title: entry.localizedTitle || entry.title};
}

function officialURLKey(value) {
  const safe = safePublicURL(value);
  if (!safe) return '';
  const url = new URL(safe);
  url.hash = '';
  url.searchParams.sort();
  return url.href.replace(/\/$/, '');
}

function popularTitleKey(value,media) {
  let title = String(value || '').normalize('NFKC').replace(/\[독점\]/gu,'').trim();
  if (media === '웹소설') title = title.replace(/\(소설\)$/u,'');
  return title.replace(/\s+/gu,'').toLocaleLowerCase('ko');
}

export function preparePopularLists(popular, items) {
  const byId = new Map(items.map(item => [item.id, item]));
  const byURL = new Map();
  const byTitle = new Map();
  for (const item of items) {
    const media = popularMedia(item.type), title = popularTitleKey(item.title,media);
    if (!title) continue;
    const key = `${media}:${title}`;
    if (!byTitle.has(key)) byTitle.set(key,[]);
    byTitle.get(key).push(item);
  }
  for (const item of items) for (const platform of item.platforms || []) {
    const key = officialURLKey(platform.url);
    if (!key) continue;
    if (!byURL.has(key)) byURL.set(key, []);
    byURL.get(key).push(item);
  }
  const lists = [];
  for (const media of POPULAR_MEDIA_ORDER) {
    const candidates = (popular?.lists || []).filter(list => popularMedia(list.media) === media && list.status === 'available' && Array.isArray(list.entries));
    const prepared = candidates.map(list => {
      const used = new Set();
      const entries = [];
      for (const entry of list.entries) {
        let item = byId.get(entry.catalogId);
        if (item && !publicWork(item)) continue;
        if (item) {
          const officialMatch = Boolean(officialURLKey(entry.url)) && (item.platforms || []).some(platform => officialURLKey(platform.url) === officialURLKey(entry.url));
          const titleMatch = [entry.localizedTitle,entry.title].some(title => {
            const key = popularTitleKey(title,media);
            return key && popularTitleKey(item.title,media) === key && byTitle.get(`${media}:${key}`)?.length === 1;
          });
          if (popularMedia(item.type) !== media || (!officialMatch && !titleMatch)) item = null;
        }
        if (!item) {
          const matches = [...new Map((byURL.get(officialURLKey(entry.url)) || []).filter(candidate => popularMedia(candidate.type) === media).map(candidate => [candidate.id, candidate])).values()];
          if (matches.length === 1) item = matches[0];
        }
        if (item && (!publicWork(item) || popularMedia(item.type) !== media)) continue;
        if (!item && (entry.animation !== false || entry.adult !== false || !safePublicURL(entry.url))) continue;
        const identity = item ? `catalog:${item.id}` : officialURLKey(entry.url);
        if (used.has(identity)) continue;
        used.add(identity);
        entries.push({...entry, catalogId:item ? item.id : null, displayNumber: entries.length + 1});
        if (entries.length === 5) break;
      }
      return {...list, media, entries};
    }).sort((left, right) => right.entries.length - left.entries.length);
    if (prepared[0]) lists.push(prepared[0]);
  }
  return {schemaVersion: 1, updatedAt: popular?.updatedAt || null, lists};
}

export function detailConnections(item, items) {
  return {
    sameCreators: sameCreatorWorks(item, items),
    cast: screenMedia.has(item.type) ? (item.credits || []).filter(credit => actorRoles.has(credit.role) && typeof credit.name === 'string' && credit.name.trim()) : []
  };
}
