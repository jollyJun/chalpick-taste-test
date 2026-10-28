import { readAuthenticatedSession } from './auth.mjs';
import { readBoundedJSON } from './security.mjs';

const MEDIA = Object.freeze(['웹툰', '웹소설', 'OTT', '영화']);
const AXES = Object.freeze(['tempo', 'mood', 'resolve', 'unusual']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function configuration(env) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret || secret.length > 8192 || /[\s\r\n]/.test(secret)) return null;
  try {
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.hostname.endsWith('.supabase.co')) return null;
    if (!secret.startsWith('sb_secret_')) {
      const claims = JSON.parse(Buffer.from(secret.split('.')[1], 'base64url').toString('utf8'));
      if (claims.role !== 'service_role') return null;
    }
    return { url, secret };
  } catch { return null; }
}

async function rpc(name, payload, { env, fetchImpl }) {
  const config = configuration(env);
  if (!config) return { status: 'not_configured', data: null };
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', apikey: config.secret };
    if (!config.secret.startsWith('sb_secret_')) headers.Authorization = `Bearer ${config.secret}`;
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, config.url), { method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { status: 'unavailable', data: null };
    const data = await readBoundedJSON(response, 524_288);
    return data && typeof data === 'object' && !Array.isArray(data) ? { status: 'ready', data } : { status: 'unavailable', data: null };
  } catch { return { status: 'unavailable', data: null }; }
}

function verifiedIdentity(user) {
  if (!user || !['kakao', 'naver'].includes(user.provider) || typeof user.id !== 'string' || !user.id.startsWith(`${user.provider}:`)) return null;
  const externalId = user.id.slice(user.provider.length + 1);
  if (!externalId || externalId.length > 128 || /[\u0000-\u001f\u007f]/.test(externalId)) return null;
  return { p_provider: user.provider, p_external_id: externalId };
}

export async function synchronizeOAuthIdentity(user, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const identity = verifiedIdentity(user);
  if (!identity) return { status: 'unavailable' };
  const result = await rpc('cp_v11_sync_identity', { ...identity, p_gender: user.gender ?? null, p_birth_year: user.birthyear ?? null }, { env, fetchImpl });
  return { status: result.status === 'ready' ? typeof result.data.linked !== 'boolean' ? 'unavailable' : result.data.linked ? 'ready' : 'unlinked' : result.status };
}

function axis(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function count(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function countMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 1000).filter(([slug]) => SLUG.test(slug)).map(([slug, total]) => [slug, count(total)]));
}

function preferences(rows, media, key) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row?.media === media && SLUG.test(row[key]) && Number.isInteger(row.preference_level) && row.preference_level >= -2 && row.preference_level <= 2 && typeof row.excluded === 'boolean').slice(0, 1000).map(row => ({ [key]: row[key], preference_level: row.preference_level, excluded: row.excluded }));
}

export function normalizeMediaProfiles(data) {
  const manualRows = Array.isArray(data?.preferences) ? data.preferences : [];
  const learnedRows = Array.isArray(data?.learned) ? data.learned : [];
  return Object.fromEntries(MEDIA.map(media => {
    const manual = manualRows.find(row => row?.media === media);
    const source = learnedRows.find(row => row?.media === media);
    const learned = Object.fromEntries(AXES.map(name => [name, axis(source?.[name])]));
    for (const field of ['sample_count', 'liked_count', 'disliked_count', 'neutral_count', ...AXES.map(name => `${name}_valid_count`)]) learned[field] = count(source?.[field]);
    for (const field of ['liked_tag_counts', 'disliked_tag_counts', 'liked_primary_engine_counts', 'disliked_primary_engine_counts']) learned[field] = countMap(source?.[field]);
    return [media, { enabled: manual?.enabled !== false, manualAxes: Object.fromEntries(AXES.map(name => [name, axis(manual?.[`manual_${name}`])])), learned, tags: preferences(data?.tags, media, 'tag_slug'), engines: preferences(data?.engines, media, 'engine_slug') }];
  }));
}

export async function loadUserRecommendationProfile(request, { env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const user = readAuthenticatedSession(request, { env, now });
  // Provider-verified session data remains usable when the separate member profile is unavailable.
  const base = { authenticated: Boolean(user), status: 'guest', userId: null, profiles: {}, demographics: { gender: user?.gender ?? null, birthyear: user?.birthyear ?? null }, cohort: [] };
  if (!user) return base;
  const identity = verifiedIdentity(user);
  if (!identity) return { ...base, status: 'unavailable' };
  const result = await rpc('cp_v17_taste_profile', {...identity,p_provider:identity.p_provider.toUpperCase()}, { env, fetchImpl });
  if (result.status !== 'ready') return { ...base, status: result.status };
  const data = result.data;
  if (data.status !== 'ready') return { ...base, status: 'unavailable' };
  const cohort = Array.isArray(data.cohort) ? data.cohort.filter(row => Number.isSafeInteger(row?.content_id) && row.content_id > 0 && count(row.liked_count) >= 3).slice(0, 20).map(row => ({ content_id: row.content_id, liked_count: count(row.liked_count) })) : [];
  const demographics = { gender: user.gender, birthyear: user.birthyear };
  return { ...base, status: 'ready', profiles: normalizeMediaProfiles(data), demographics, cohort };
}

/** Custom OAuth accounts use v12 without fabricating Supabase Auth users or email addresses. */
export async function loadSocialRecommendationProfile(request, options = {}) {
  const env = options.env || process.env, fetchImpl = options.fetchImpl || globalThis.fetch;
  const user = readAuthenticatedSession(request, { env, now: options.now || Date.now });
  if (!user) return { authenticated: false, status: 'guest', profiles: {}, demographics: {}, cohort: [], feedback: [] };
  const identity = verifiedIdentity(user);
  const base = { authenticated: true, profiles: {}, demographics: { gender: user.gender, birthyear: user.birthyear }, cohort: [], feedback: [] };
  if (!identity) return { ...base, status: 'unavailable' };
  if (!configuration(env)) return { ...base, status: 'not_configured' };
  // Both lookups use the same verified identity. Preserve a previously linked member's
  // manual settings without delaying social feedback behind a second sequential timeout.
  const [result, legacy] = await Promise.all([
    rpc('cp_v12_social_recommendation_profile', { ...identity, p_gender: user.gender ?? null, p_birth_year: user.birthyear ?? null }, { env, fetchImpl }),
    loadUserRecommendationProfile(request, options)
  ]);
  if (result.status !== 'ready' || !Array.isArray(result.data.feedback) || !Array.isArray(result.data.cohort)) {
    return legacy;
  }
  const feedback = result.data.feedback.slice(0, 1000).filter(row => Number.isSafeInteger(row?.content_id) && row.content_id > 0 && ['WATCHED', 'NOT_INTERESTED'].includes(row.status)).map(row => ({ content_id: row.content_id, status: row.status, stars: typeof row.stars === 'number' && row.stars >= .5 && row.stars <= 5 && Number.isInteger(row.stars * 2) ? row.stars : null }));
  const cohort = result.data.cohort.slice(0, 20).filter(row => Number.isSafeInteger(row?.content_id) && row.content_id > 0 && count(row.liked_count) >= 3).map(row => ({ content_id: row.content_id, liked_count: count(row.liked_count) }));
  return { ...base, status: 'ready', profiles: legacy.status === 'ready' ? legacy.profiles : {}, feedback, cohort };
}
