import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { readAuthenticatedSession } from './auth.mjs';
import { SECURITY_HEADERS, readBoundedJSON } from './security.mjs';

const HEADERS = { ...SECURITY_HEADERS, 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'Content-Type': 'application/json; charset=utf-8' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS = Object.freeze({ watched: 'WATCHED', want: 'WANT_TO_WATCH', avoid: 'NOT_INTERESTED' });
const states = new Set([null, 'watched', 'want', 'avoid']);
const limits = new Map();
let active = 0;

function configuration(env) {
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret || secret.length > 8192 || /[\s\r\n]/.test(secret)) return null;
  try {
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.hostname.endsWith('.supabase.co')) return null;
    if (!secret.startsWith('sb_secret_') && JSON.parse(Buffer.from(secret.split('.')[1], 'base64url').toString('utf8')).role !== 'service_role') return null;
    return { url, secret };
  } catch { return null; }
}

function identity(user) {
  if (!user || !['kakao', 'naver'].includes(user.provider) || typeof user.id !== 'string' || !user.id.startsWith(`${user.provider}:`)) return null;
  const externalId = user.id.slice(user.provider.length + 1);
  if (!externalId || externalId.length > 128 || /[\u0000-\u001f\u007f]/.test(externalId)) return null;
  return { p_provider: user.provider, p_external_id: externalId };
}

function rateAllowed(key, now) {
  const digest = createHash('sha256').update(key).digest('hex');
  const value = limits.get(digest);
  if (value && value.until > now) return ++value.count <= 90;
  if (limits.size >= 4096) {
    for (const [oldKey, item] of limits) if (item.until <= now) limits.delete(oldKey);
    if (limits.size >= 4096) return false;
  }
  limits.set(digest, { until: now + 60_000, count: 1 }); return true;
}

async function rpc(name, args, { env, fetchImpl }) {
  const config = configuration(env);
  if (!config) return { error: 'not_configured', status: 503 };
  try {
    const headers = { apikey: config.secret, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!config.secret.startsWith('sb_secret_')) headers.Authorization = `Bearer ${config.secret}`;
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, config.url), { method: 'POST', headers, body: JSON.stringify(args), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
    const data = await readBoundedJSON(response, 524_288);
    if (!response.ok) {
      if (data?.code === 'P0409') return { error: 'conflict', status: 409 };
      if (data?.code === '22023') return { error: 'invalid_request', status: 400 };
      if (data?.code === 'P0002') return { error: 'content_not_found', status: 404 };
      return { error: 'unavailable', status: 503 };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_activity_response');
    return { data };
  } catch { return { error: 'unavailable', status: 503 }; }
}

function integer(value, min, max) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= min && result <= max ? result : null;
}

function query(url) {
  const p = url.searchParams;
  if ([...p.keys()].some(key => !['view', 'status', 'offset', 'limit', 'before', 'contentId'].includes(key) || p.getAll(key).length !== 1)) return null;
  const view = p.get('view') || 'current';
  const contentId = p.has('contentId') ? integer(p.get('contentId'), 1, 2_147_483_647) : null;
  const limit = p.has('limit') ? integer(p.get('limit'), 1, 50) : 20;
  const offset = p.has('offset') ? integer(p.get('offset'), 0, 10_000) : 0;
  const before = p.has('before') ? integer(p.get('before'), 1, Number.MAX_SAFE_INTEGER) : null;
  const status = p.get('status');
  if (!['current', 'history'].includes(view) || limit === null || offset === null || (p.has('before') && before === null) || (status !== null && !Object.hasOwn(STATUS, status))) return null;
  if (p.has('contentId')) {
    if (contentId === null || [...p.keys()].some(key => key !== 'contentId')) return null;
    return { p_view: 'item', p_content_id: contentId, p_status: null, p_limit: 1, p_offset: 0, p_before: null };
  }
  if ((view === 'current' && p.has('before')) || (view === 'history' && (p.has('offset') || p.has('status')))) return null;
  return { p_view: view, p_content_id: null, p_status: status ? STATUS[status] : null, p_limit: limit, p_offset: offset, p_before: before };
}

function mutation(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['contentId', 'status', 'stars', 'expectedVersion', 'requestId'].includes(key))) return null;
  if (!Number.isSafeInteger(data.contentId) || data.contentId < 1 || data.contentId > 2_147_483_647 || !states.has(data.status) || !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0 || !UUID.test(data.requestId || '')) return null;
  if (data.stars !== null && (typeof data.stars !== 'number' || !Number.isFinite(data.stars) || data.stars < 0.5 || data.stars > 5 || !Number.isInteger(data.stars * 2))) return null;
  if (data.status !== 'watched' && data.stars !== null) return null;
  return { p_content_id: data.contentId, p_status: data.status === null ? 'NONE' : STATUS[data.status], p_stars: data.stars, p_expected_version: data.expectedVersion, p_request_id: data.requestId };
}

const OUT_STATUS = Object.freeze({ NONE: null, WATCHED: 'watched', WANT_TO_WATCH: 'want', NOT_INTERESTED: 'avoid' });
function safeText(value, max = 500) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function safeNumber(value, fallback = 0) { const result = typeof value === 'number' ? value : Number(value); return Number.isSafeInteger(result) && result >= 0 ? result : fallback; }
function stars(value) { const number = Number(value); return value !== null && value !== undefined && number >= 0.5 && number <= 5 && Number.isInteger(number * 2) ? number : null; }
function date(value) { return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null; }
function thumbnail(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
function item(row) {
  if (!row || !Object.hasOwn(OUT_STATUS, row.status) || !safeNumber(row.content_id)) throw new Error('invalid_activity_row');
  return { contentId: safeNumber(row.content_id), status: OUT_STATUS[row.status], stars: stars(row.stars), version: safeNumber(row.version), updatedAt: date(row.updated_at), watchedAt: null, title: safeText(row.title), media: safeText(row.media, 16), thumbnail: thumbnail(row.thumbnail_url) };
}
function history(row) {
  if (!row || !safeNumber(row.id) || !safeNumber(row.content_id) || !Object.hasOwn(OUT_STATUS, row.after_status) || !Object.hasOwn(OUT_STATUS, row.before_status)) throw new Error('invalid_history_row');
  return { id: safeNumber(row.id), contentId: safeNumber(row.content_id), status: OUT_STATUS[row.after_status], stars: stars(row.after_stars), previousStatus: OUT_STATUS[row.before_status], previousStars: stars(row.before_stars), eventType: row.before_status !== 'WATCHED' && row.after_status === 'WATCHED' ? 'watched' : row.before_stars !== row.after_stars ? 'rating' : 'status', occurredAt: date(row.occurred_at), title: safeText(row.title_snapshot), media: safeText(row.media_snapshot, 16) };
}

/** Activity is scoped only by the verified encrypted session, never a browser UUID. */
export async function handleActivity(request, options = {}) {
  const reply = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
  if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST' });
  const url = new URL(request.url), origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site');
  if ((origin && origin !== url.origin) || (site && !['same-origin', 'none'].includes(site))) return reply({ error: 'origin_not_allowed' }, 403);
  if (request.method === 'POST' && (origin !== url.origin || request.headers.get('x-chalpick-activity') !== '1' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))) return reply({ error: 'origin_not_allowed' }, 403);
  if (request.url.length > 1000) return reply({ error: 'invalid_request' }, 400);
  const env = options.env || process.env, now = options.now || Date.now;
  const user = (options.readSession || readAuthenticatedSession)(request, { env, now });
  const owner = identity(user);
  if (!owner) return reply({ error: 'not_authenticated' }, 401);
  if (!(options.rateAllowed || rateAllowed)(`${owner.p_provider}:${owner.p_external_id}`, now()) || active >= 20) return reply({ error: 'too_many_requests' }, 429, { 'Retry-After': '60' });
  let args;
  if (request.method === 'GET') args = query(url);
  else {
    if (url.search) return reply({ error: 'invalid_request' }, 400);
    try { args = mutation(await readBoundedJSON(request, 4096)); } catch { return reply({ error: 'invalid_request' }, 400); }
  }
  if (!args) return reply({ error: 'invalid_request' }, 400);
  active += 1;
  try {
    const result = await (options.rpc || rpc)(request.method === 'POST' ? 'cp_v12_set_activity' : 'cp_v12_get_activity', { ...owner, ...args }, { env, fetchImpl: options.fetchImpl || globalThis.fetch });
    if (result.error) return reply({ error: result.error }, result.status);
    const data = result.data;
    if (request.method === 'POST' || args.p_view === 'item') return reply({ status: 'ready', item: item(data.item) });
    if (!Array.isArray(data.items) || data.items.length > args.p_limit + 1) throw new Error('invalid_activity_list');
    const hasMore = data.items.length > args.p_limit;
    const rows = data.items.slice(0, args.p_limit);
    if (args.p_view === 'history') {
      const items = rows.map(history);
      return reply({ status: 'ready', items, hasMore, nextBefore: hasMore ? items.at(-1)?.id ?? null : null });
    }
    return reply({ status: 'ready', items: rows.map(item), hasMore, counts: { watched: safeNumber(data.counts?.watched), want: safeNumber(data.counts?.want), avoid: safeNumber(data.counts?.avoid), rated: safeNumber(data.counts?.rated) } });
  } catch { return reply({ error: 'unavailable' }, 503); }
  finally { active -= 1; }
}

export async function handleNodeActivity(req, res, options) {
  try {
    const init = { method: req.method, headers: req.headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') { init.body = Readable.toWeb(req); init.duplex = 'half'; }
    const request = new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), init);
    const response = await handleActivity(request, options);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  } catch { res.writeHead(400, HEADERS); res.end(JSON.stringify({ error: 'invalid_request' })); }
}
