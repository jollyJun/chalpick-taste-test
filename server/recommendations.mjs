import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { recommendHome, recommendSimilar } from './recommendation-engine.mjs';
import { loadSocialRecommendationProfile } from './user-profiles.mjs';
import { activityPreferences } from './activity-preferences.mjs';
import { readAuthenticatedSession } from './auth.mjs';
import { SECURITY_HEADERS } from './security.mjs';
import { preparePopularLists } from '../public/catalog-display.js';

const ROOT = new URL('../',import.meta.url);
const MAX_CATALOG_BYTES = 100_000_000;
const MAX_ITEMS = 100_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const limiter = new Map();
let catalogPromise;
let anonymousResult;
let activeRequests = 0;

async function localBytes(path,maxBytes = MAX_CATALOG_BYTES,root = ROOT) {
  const file = new URL(path,root);
  if ((await stat(file)).size > maxBytes) throw new Error('recommendation_catalog_too_large');
  const bytes = await readFile(file);
  if (bytes.length > maxBytes) throw new Error('recommendation_catalog_too_large');
  return bytes;
}

async function localJSON(path,maxBytes = MAX_CATALOG_BYTES,root = ROOT) {
  return JSON.parse((await localBytes(path,maxBytes,root)).toString('utf8'));
}

const hash = value => createHash('sha256').update(value).digest('hex');
const publicPath = value => typeof value === 'string' && /^\/data\/[a-z0-9.-]+\.json$/.test(value);

async function readPublicSnapshot(manifest,root) {
  let catalog;
  if (Array.isArray(manifest.parts)) {
    if (!manifest.parts.length || manifest.parts.length > 10 || !publicPath(manifest.metadataUrl) || !/^[a-f0-9]{64}$/.test(manifest.metadataHash)) throw new Error('recommendation_catalog_parts_invalid');
    const metadataBytes = await localBytes(`public${manifest.metadataUrl}`,2_000_000,root);
    if (hash(metadataBytes) !== manifest.metadataHash) throw new Error('recommendation_catalog_hash_mismatch');
    const metadata = JSON.parse(metadataBytes.toString('utf8'));
    const allItems = [];
    let totalBytes = 0;
    for (const part of manifest.parts) {
      if (!publicPath(part.url) || !/^[a-f0-9]{64}$/.test(part.hash) || !Number.isSafeInteger(part.bytes) || part.bytes <= 0 || part.bytes > 25_000_000 || !Number.isSafeInteger(part.count) || part.count < 0) throw new Error('recommendation_catalog_parts_invalid');
      const bytes = await localBytes(`public${part.url}`,25_000_000,root);
      totalBytes += bytes.length;
      if (totalBytes > MAX_CATALOG_BYTES || bytes.length !== part.bytes || hash(bytes) !== part.hash) throw new Error('recommendation_catalog_hash_mismatch');
      const segment = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(segment.items) || segment.items.length !== part.count || allItems.length + segment.items.length > MAX_ITEMS) throw new Error('recommendation_catalog_parts_invalid');
      allItems.push(...segment.items);
    }
    catalog = {items:allItems,taxonomy:metadata.taxonomy,meta:metadata.meta};
    if (hash(JSON.stringify(catalog)) !== manifest.hash) throw new Error('recommendation_catalog_hash_mismatch');
  } else {
    if (!/^\/data\/live-catalog\.[a-f0-9]{16}\.json$/.test(manifest.catalogUrl) || manifest.catalogUrl !== `/data/live-catalog.${manifest.hash.slice(0,16)}.json`) throw new Error('recommendation_catalog_path_invalid');
    const bytes = await localBytes(`public${manifest.catalogUrl}`,MAX_CATALOG_BYTES,root);
    if (hash(bytes) !== manifest.hash || bytes.length !== manifest.bytes) throw new Error('recommendation_catalog_hash_mismatch');
    catalog = JSON.parse(bytes.toString('utf8'));
  }
  return {...catalog,catalogVersion:manifest.hash};
}

async function readSnapshot(root) {
    const manifest = await localJSON('public/data/catalog-release.json',20_000,root);
    if (!/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error('recommendation_catalog_version_invalid');
    let catalog;
    try {
      let bytes;
      try {
        bytes = gunzipSync(await localBytes('server/data/recommendation-catalog.json.gz',20_000_000,root),{maxOutputLength:MAX_CATALOG_BYTES});
        catalog = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        catalog = await localJSON('server/data/recommendation-catalog.json',MAX_CATALOG_BYTES,root);
      }
      if (catalog.catalogVersion !== manifest.hash) throw new Error('recommendation_catalog_version_mismatch');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      catalog = await readPublicSnapshot(manifest,root);
    }
    if (!Array.isArray(catalog.items) || catalog.items.length > MAX_ITEMS || catalog.items.some(item => !item || !Number.isSafeInteger(item.id) || item.id <= 0) || new Set(catalog.items.map(item => item.id)).size !== catalog.items.length) throw new Error('recommendation_catalog_invalid');
    const popular = preparePopularLists(await localJSON('public/data/popular.json',2_000_000,root),catalog.items);
    return {items:catalog.items,catalogVersion:catalog.catalogVersion,popular};
}

export async function loadRecommendationCatalog(options = {}) {
  if (options.root) return readSnapshot(options.root);
  if (!catalogPromise) catalogPromise = readSnapshot(ROOT).catch(error => {catalogPromise = null;throw error;});
  return catalogPromise;
}

function allowedOrigin(request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  return (!origin || origin === new URL(request.url).origin) && (!site || ['same-origin','none'].includes(site));
}

function rateAllowed(request,now) {
  const client = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'local';
  const key = createHash('sha256').update(client.slice(0,256)).digest('hex');
  const current = limiter.get(key);
  if (current && current.until > now) {
    current.count += 1;
    return current.count <= 60;
  }
  if (limiter.size >= 2048) {
    for (const [oldKey,value] of limiter) if (value.until <= now) limiter.delete(oldKey);
    if (limiter.size >= 2048) return false;
  }
  limiter.set(key,{until:now + 60_000,count:1});
  return true;
}

async function boundedProfile(request,options) {
  let timer;
  try {
    return await Promise.race([
      (options.resolveProfile || loadSocialRecommendationProfile)(request,options),
      new Promise((_,reject) => {timer = setTimeout(() => reject(new Error('profile_timeout')),2500);})
    ]);
  } finally {clearTimeout(timer);}
}

export async function handleRecommendations(request,options = {}) {
  const headers = {...SECURITY_HEADERS,'Cache-Control':'private, no-store','Vary':'Cookie','Content-Type':'application/json; charset=utf-8'};
  const reply = (body,status = 200,additional = {}) => Response.json(body,{status,headers:{...headers,...additional}});
  if (request.method !== 'GET') return reply({error:'method_not_allowed'},405,{Allow:'GET'});
  if (!allowedOrigin(request)) return reply({error:'origin_not_allowed'},403);
  const url = new URL(request.url), mode = url.searchParams.get('mode') || 'home';
  const contentId = url.searchParams.get('contentId');
  if (request.url.length > 512 || !['home','similar'].includes(mode) || [...url.searchParams.keys()].some(key => !['mode','contentId'].includes(key)) || ['mode','contentId'].some(key => url.searchParams.getAll(key).length > 1) || (mode === 'home' && contentId !== null) || (mode === 'similar' && (!/^[1-9]\d{0,12}$/.test(contentId ?? '') || !Number.isSafeInteger(Number(contentId))))) return reply({error:'invalid_request'},400);
  const now = (options.now || Date.now)();
  if (!(options.rateAllowed || rateAllowed)(request,now) || activeRequests >= 20) return reply({error:'too_many_requests'},429,{'Retry-After':'60'});
  activeRequests += 1;
  try {
    const [catalog,identity] = await Promise.all([
      (options.loadCatalog || loadRecommendationCatalog)(),
      boundedProfile(request,options).catch(() => {
        const user = readAuthenticatedSession(request,options);
        return {authenticated:Boolean(user),status:'unavailable',profiles:{},demographics:{gender:user?.gender ?? null,birthyear:user?.birthyear ?? null}};
      })
    ]);
    const usable = identity.authenticated === true && identity.status === 'ready';
    const activity = activityPreferences(catalog.items, usable ? identity.feedback : [], usable ? identity.profiles : {});
    const context = {profiles:activity.profiles,excludedIds:activity.excludedIds,popular:catalog.popular,demographics:identity.authenticated === true ? identity.demographics : undefined,cohort:identity.authenticated === true ? identity.cohort : [],profileStatus:identity.status,now};
    const base = {catalogVersion:catalog.catalogVersion,profileStatus:['guest','ready','not_configured','unlinked','unavailable'].includes(identity.status) ? identity.status : 'unavailable'};
    let payload;
    if (mode === 'similar') payload = {...base,similarIds:recommendSimilar(Number(contentId),catalog.items,context)};
    else {
      let home;
      if (identity.authenticated !== true && identity.status === 'guest') {
        if (!anonymousResult || anonymousResult.catalogVersion !== catalog.catalogVersion) anonymousResult = {catalogVersion:catalog.catalogVersion,result:recommendHome(catalog.items,{popular:catalog.popular})};
        home = anonymousResult.result;
      } else home = recommendHome(catalog.items,context);
      payload = {...base,...home};
    }
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('recommendation_response_too_large');
    return new Response(body,{headers});
  } catch {
    (options.logger || console).error('recommendations_unavailable');
    return reply({error:'recommendations_unavailable'},503);
  } finally {activeRequests -= 1;}
}

export async function handleNodeRecommendations(req,res) {
  const request = new Request(new URL(req.url,`http://${req.headers.host || 'localhost'}`),{method:req.method,headers:req.headers});
  const response = await handleRecommendations(request);
  res.writeHead(response.status,Object.fromEntries(response.headers));
  res.end(await response.text());
}
