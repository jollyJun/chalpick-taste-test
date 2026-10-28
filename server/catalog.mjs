import { readFile } from 'node:fs/promises';
import { buildCatalog } from './catalog-model.mjs';
import { readBoundedJSON, SECURITY_HEADERS } from './security.mjs';

const PAGE_SIZE = 500;
const MAX_RESPONSE_BYTES = 4_000_000;
const MAX_OFFSET = 1_000_000;
const dictionaryCache = new Map();
const ageRatingsPromise = readFile(new URL('./catalog-age-ratings.json', import.meta.url), 'utf8').then(JSON.parse);
const fields = {
  contents: 'id,ip_id,title,media,release_year,synopsis,thumbnail_url,origin_image_url,tier,tempo,mood,resolve,unusual,story_engine_primary,story_engine_secondary,world_model,fantasy_presence,overall_complexity,tracking_complexity,tag_slugs_cache,recommendation_status,anniversary_tags,season_tags,weather_tags',
  content_platforms: 'id,content_id,platform,platform_role,is_available,watch_url,verification_status',
  content_creators: 'id,content_id,person_id,creator_role,credit_order,verification_status,source_url,person:persons(id,name,normalized_name,external_person_id)',
  content_complexity: 'content_id,character_complexity,faction_complexity,naming_complexity,relationship_complexity,lore_complexity,tracking_complexity,overall_complexity,analysis_state',
  tag_dictionary: 'tag_slug,display_name,category,status'
};

function configuration(env) {
  const url = new URL(env.SUPABASE_URL || 'https://invalid.invalid');
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !key) throw new Error('catalog_not_configured');
  if (!key.startsWith('sb_publishable_')) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch {}
    if (role !== 'anon') throw new Error('catalog_public_key_required');
  }
  return { url: url.origin, key };
}

function rangeInfo(header, length, offset) {
  const match = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(header || '');
  if (!match) throw new Error('catalog_count_missing');
  const total = Number(match[3]);
  if (!Number.isSafeInteger(total) || (length && (Number(match[1]) !== offset || Number(match[2]) + 1 !== offset + length || offset + length > total))) throw new Error('catalog_invalid_range');
  return total;
}

async function readPage(table, parameters, offset, limit, options) {
  const url = new URL(`/rest/v1/${table}`, options.config.url);
  url.search = new URLSearchParams({ select: fields[table], ...parameters, offset: String(offset), limit: String(limit) });
  const response = await options.fetchImpl(url, {
    method: 'GET',
    headers: { apikey: options.config.key, Prefer: 'count=exact', Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`catalog_upstream_${response.status}`);
  const rows = await readBoundedJSON(response, MAX_RESPONSE_BYTES);
  if (!Array.isArray(rows) || rows.length > limit) throw new Error('catalog_invalid_rows');
  return { rows, total: rangeInfo(response.headers.get('content-range'), rows.length, offset) };
}

async function readAll(table, parameters, options) {
  const rows = [];
  let expected;
  do {
    const page = await readPage(table, parameters, rows.length, 1000, options);
    if (expected !== undefined && expected !== page.total) throw new Error('catalog_changed_during_load');
    expected = page.total;
    if (!page.rows.length && rows.length < expected) throw new Error('catalog_incomplete');
    rows.push(...page.rows);
  } while (rows.length < expected);
  if (rows.length !== expected) throw new Error('catalog_incomplete');
  return rows;
}

async function readDictionary(options) {
  const cache = options.cache;
  const key = `${options.config.url}:${options.config.key}`;
  const cached = cache.get(key);
  if (cached && cached.expires > options.now()) return cached.value;
  const value = await readAll('tag_dictionary', { order: 'tag_slug.asc' }, options);
  if (cache.size >= 4) cache.clear();
  cache.set(key, { value, expires: options.now() + 60_000 });
  return value;
}

export async function loadCatalogPage(offset, options = {}) {
  const context = {
    config: configuration(options.env || process.env),
    fetchImpl: options.fetchImpl || fetch,
    now: options.now || Date.now,
    cache: options.cache || dictionaryCache
  };
  const [page, tags, ageRatings] = await Promise.all([
    readPage('contents', { order: 'id.asc', recommendation_status: 'neq.HOLD' }, offset, PAGE_SIZE, context),
    readDictionary(context),
    options.ageRatings || ageRatingsPromise
  ]);
  if (!page.rows.length && offset < page.total) throw new Error('catalog_incomplete');
  const tables = { contents: page.rows, tag_dictionary: tags, content_creators: [], content_platforms: [], content_complexity: [], persons: [] };
  if (page.rows.length) {
    if (!page.rows.every(row => Number.isSafeInteger(row.id) && row.id > 0)) throw new Error('catalog_invalid_id');
    const filter = `in.(${page.rows.map(row => row.id).join(',')})`;
    [tables.content_creators, tables.content_platforms, tables.content_complexity] = await Promise.all([
      readAll('content_creators', { content_id: filter, order: 'id.asc' }, context),
      readAll('content_platforms', { content_id: filter, order: 'id.asc' }, context),
      readAll('content_complexity', { content_id: filter, order: 'content_id.asc' }, context)
    ]);
    tables.persons = [...new Map(tables.content_creators.filter(row => row.person).map(row => [row.person.id, row.person])).values()];
  }
  const fetchedAt = new Date(context.now()).toISOString();
  const projected = buildCatalog(tables, { ageRatings, fetchedAt });
  return {
    items: projected.items,
    taxonomy: projected.taxonomy,
    meta: {
      source: 'supabase', total: page.total, offset, limit: PAGE_SIZE,
      scanned: page.rows.length, excluded: page.rows.length - projected.items.length,
      nextOffset: offset + page.rows.length < page.total ? offset + page.rows.length : null,
      fetchedAt
    }
  };
}

export async function handleCatalog(request, options = {}) {
  const headers = { ...SECURITY_HEADERS, 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json; charset=utf-8' };
  if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
  if ((options.env || process.env).CATALOG_LIVE_API_ENABLED !== 'true') return Response.json({error:'live_catalog_disabled'}, {status:410,headers});
  const url = new URL(request.url);
  const offsetText = url.searchParams.get('offset') || '0';
  if (request.url.length > 8192 || !/^(0|[1-9]\d*)$/.test(offsetText) || !Number.isSafeInteger(Number(offsetText)) || Number(offsetText) > MAX_OFFSET || [...url.searchParams.keys()].some(key => key !== 'offset') || url.searchParams.getAll('offset').length > 1) {
    return Response.json({ error: 'invalid_offset' }, { status: 400, headers });
  }
  try {
    const page = await loadCatalogPage(Number(offsetText), options);
    const payload = {...page,items:page.items.map(item => {
      const {recommendation,tagSlugs,...publicItem} = item;
      return {...publicItem,credits:publicItem.credits.map(credit => Object.fromEntries(
        ['name','role','roleLabel','identityKey','identityConfidence'].filter(key => Object.hasOwn(credit,key)).map(key => [key,credit[key]])
      ))};
    })};
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('catalog_response_too_large');
    return new Response(body, { headers });
  } catch {
    return Response.json({ error: 'catalog_unavailable', message: '최신 DB 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503, headers });
  }
}

export async function handleNodeCatalog(req, res) {
  const response = await handleCatalog(new Request(new URL(req.url, 'http://localhost'), { method: req.method }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}
