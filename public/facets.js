// Every selected tag is a requirement, across all three taxonomy groups.
export function matchesSelectedTags(item, selected = {}) {
  return Object.entries(selected).every(([group, tags]) =>
    tags.every(tag => (item.tagGroups?.[group] || []).includes(tag)));
}

export function facetCounts(group, items) {
  const counts = new Map();
  for (const item of items) {
    const labels = group === 'platform' ? displayPlatforms(item).map(platform => platform.name) : item.tagGroups?.[group] || [];
    for (const label of new Set(labels)) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return counts;
}

export function sortFacetLabels(labels, counts) {
  return [...labels].sort((left, right) =>
    (counts.get(right) || 0) - (counts.get(left) || 0) || left.localeCompare(right, 'ko'));
}

export const PLATFORM_FILTERS = Object.freeze(['넷플릭스', '네이버웹툰', '네이버시리즈', '카카오페이지', '티빙', '리디', 'U+tv모바일', '웨이브', '왓챠', '쿠팡플레이', '애플TV', '디즈니+', '카카오웹툰']);

const platformKey = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ko').replace(/[\s_-]+/g, '');
const platformAliases = new Map(PLATFORM_FILTERS.map(name => [platformKey(name), name]));
for (const [name, aliases] of [
  ['넷플릭스', ['Netflix']], ['네이버웹툰', ['Naver Webtoon']], ['네이버시리즈', ['Naver Series']],
  ['카카오페이지', ['Kakao Page', 'Kakaopage']], ['카카오웹툰', ['Kakao Webtoon']],
  ['티빙', ['TVING']], ['리디', ['RIDIBOOKS', 'RIDI', '리디북스']],
  ['U+tv모바일', ['U+모바일tv', 'U+ mobile tv']], ['웨이브', ['Wavve']], ['왓챠', ['Watcha']],
  ['쿠팡플레이', ['Coupang Play']], ['애플TV', ['Apple TV', 'Apple TV+', '애플TV+']],
  ['디즈니+', ['Disney+', 'Disney Plus', '디즈니플러스']]
]) for (const alias of aliases) platformAliases.set(platformKey(alias), name);

export function normalizePlatformName(value) {
  return platformAliases.get(platformKey(value)) || '';
}

export function displayPlatforms(item) {
  const platforms = new Map();
  for (const platform of item.platforms || []) {
    const name = normalizePlatformName(platform.name);
    if (!name) continue;
    const previous = platforms.get(name);
    if (!previous || (!previous.url && platform.url)) platforms.set(name, {...platform, name});
  }
  return PLATFORM_FILTERS.filter(name => platforms.has(name)).map(name => platforms.get(name));
}
