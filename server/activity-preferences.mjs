// Social-session feedback stays on the server; no recommendation features go to the client.
import { canonicalMedia, MEDIA } from './recommendation-engine.mjs';

const AXES = ['tempo', 'mood', 'resolve', 'unusual'];
const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const increment = (map, key) => { if (slug(key)) map[key] = (Object.hasOwn(map, key) ? map[key] : 0) + 1; };

export function activityPreferences(items, feedback, previous = {}) {
  const byId = new Map(items.map(item => [item.id, item]));
  const profiles = { ...previous }, excludedIds = new Set(), seen = new Set();
  const groups = new Map();
  for (const row of Array.isArray(feedback) ? feedback.slice(0, 1000) : []) {
    if (!Number.isSafeInteger(row?.content_id) || seen.has(row.content_id)) continue;
    seen.add(row.content_id);
    const item = byId.get(row.content_id), media = canonicalMedia(item?.type);
    if (!item || !MEDIA.includes(media)) continue;
    if (row.status === 'NOT_INTERESTED' || row.status === 'WATCHED') excludedIds.add(item.id);
    // Not wanting to watch an item is not a rating of its content.
    if (row.status !== 'WATCHED' || typeof row.stars !== 'number' || row.stars < .5 || row.stars > 5 || !Number.isInteger(row.stars * 2)) continue;
    if (item.adult === true || (item.age != null && Number(item.age) >= 18) || item.recommendation?.status === 'HOLD') continue;
    if (!groups.has(media)) groups.set(media, []);
    groups.get(media).push({ item, stars: row.stars });
  }
  for (const [media, rows] of groups) {
    // Canonical explicit v3 ratings must not be replaced by star-derived estimates.
    if (previous[media]?.learned?.sample_count > 0) continue;
    const learned = { sample_count: rows.length, liked_count: 0, disliked_count: 0, neutral_count: 0,
      liked_tag_counts: {}, disliked_tag_counts: {}, liked_primary_engine_counts: {}, disliked_primary_engine_counts: {} };
    const totals = Object.fromEntries(AXES.map(axis => [axis, { sum: 0, count: 0 }]));
    for (const { item, stars } of rows) {
      const direction = stars >= 4 ? 'liked' : stars <= 2 ? 'disliked' : 'neutral';
      learned[`${direction}_count`]++;
      if (direction === 'neutral') continue;
      for (const tag of new Set(item.tagSlugs || [])) increment(learned[`${direction}_tag_counts`], tag);
      increment(learned[`${direction}_primary_engine_counts`], item.recommendation?.storyEnginePrimary);
      if (direction === 'liked') for (const axis of AXES) {
        const value = score(item.recommendation?.axes?.[axis]);
        if (value !== null) { totals[axis].sum += value; totals[axis].count++; }
      }
    }
    for (const axis of AXES) {
      learned[axis] = totals[axis].count ? totals[axis].sum / totals[axis].count : null;
      learned[`${axis}_valid_count`] = totals[axis].count;
    }
    // Manual settings remain authoritative; unrelated media keep their own profiles.
    profiles[media] = { ...previous[media], learned };
  }
  return { profiles, excludedIds };
}
