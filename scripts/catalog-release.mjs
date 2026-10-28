import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { normalizeCatalogItem } from '../public/catalog-client.js';

const GROUP_IDS = ['genre', 'setting', 'relationship'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = () => { throw new Error('catalog_release_invalid_or_incomplete'); };
const digest = value => createHash('sha256').update(value).digest('hex');

function taxonomyFor(taxonomy, items) {
  if (!taxonomy || !Array.isArray(taxonomy.groups) || taxonomy.groups.length !== GROUP_IDS.length) fail();
  if (GROUP_IDS.some(id => taxonomy.groups.filter(group => group.id === id && Array.isArray(group.tags)).length !== 1)) fail();
  return { ...taxonomy, groups: taxonomy.groups.map(group => {
    const counts = new Map(), countsAll = new Map();
    for (const item of items) for (const label of new Set(item.tagGroups[group.id])) {
      countsAll.set(label, (countsAll.get(label) || 0) + 1);
      if (item.adult !== true) counts.set(label, (counts.get(label) || 0) + 1);
    }
    if (group.tags.some(tag => !tag || typeof tag.label !== 'string' || !tag.label)) fail();
    return { ...group, tags: group.tags.map(tag => ({ ...tag, count: counts.get(tag.label) || 0, countAll: countsAll.get(tag.label) || 0 })) };
  }) };
}

export function validateCatalog(catalog) {
  const meta = catalog?.meta;
  if (!Array.isArray(catalog?.items) || meta?.source !== 'supabase' || !['total', 'loaded', 'excluded', 'adultExcluded', 'available'].every(key => integer(meta[key]))) fail();
  if (meta.loaded !== catalog.items.length || meta.loaded + meta.excluded !== meta.total || meta.available + meta.adultExcluded !== meta.loaded) fail();
  if (typeof meta.generatedAt !== 'string' || !Number.isFinite(Date.parse(meta.generatedAt))) fail();
  const identifiers = new Set();
  for (const rawItem of catalog.items) {
    const item = normalizeCatalogItem(rawItem);
    if (item.type === '애니메이션' || identifiers.has(item.id) || item.adult !== rawItem.adult) fail();
    if (item.adult === true && item.image !== '/assets/adult-placeholder.svg') fail();
    identifiers.add(item.id);
  }
  if (catalog.items.filter(item => item.adult === true).length !== meta.adultExcluded) fail();
  const taxonomy = taxonomyFor(catalog.taxonomy, catalog.items);
  if (JSON.stringify(taxonomy) !== JSON.stringify(catalog.taxonomy)) fail();
  return catalog;
}

export async function collectCatalog(readPage, { generatedAt = new Date().toISOString(), onProgress = () => {} } = {}) {
  const items = [], identifiers = new Set();
  let offset = 0, total = null, excluded = 0, taxonomy = null, fetchedAt = null;
  do {
    const page = await readPage(offset), meta = page?.meta;
    if (!Array.isArray(page?.items) || meta?.source !== 'supabase' || !['total', 'offset', 'scanned', 'excluded', 'limit'].every(key => integer(meta[key]))) fail();
    if (meta.offset !== offset || !meta.limit || meta.scanned > meta.limit || page.items.length + meta.excluded !== meta.scanned) fail();
    if (total === null) { total = meta.total; taxonomy = page.taxonomy; fetchedAt = meta.fetchedAt; }
    const nextOffset = offset + meta.scanned;
    if (meta.total !== total || nextOffset > total) fail();
    if (meta.nextOffset === null ? nextOffset !== total : !integer(meta.nextOffset) || meta.nextOffset !== nextOffset || nextOffset <= offset || nextOffset >= total) fail();
    excluded += meta.excluded;
    for (const rawItem of page.items) {
      const item = normalizeCatalogItem(rawItem);
      if (identifiers.has(item.id)) fail();
      identifiers.add(item.id);
      if (item.type === '애니메이션') { excluded++; continue; }
      if (item.adult === true) item.image = '/assets/adult-placeholder.svg';
      items.push(item);
    }
    onProgress({ loaded: nextOffset, total });
    offset = meta.nextOffset;
  } while (offset !== null);
  const adultExcluded = items.filter(item => item.adult === true).length;
  return validateCatalog({ items, taxonomy: taxonomyFor(taxonomy, items), meta: { source: 'supabase', delivery: 'cdn-snapshot', total, loaded: items.length, excluded, adultExcluded, available: items.length - adultExcluded, fetchedAt, generatedAt } });
}

export function projectPublicCatalog(sourceCatalog) {
  validateCatalog(sourceCatalog);
  return { ...sourceCatalog, items: sourceCatalog.items.map(item => {
    const { recommendation, tagSlugs, ...publicItem } = item;
    return { ...publicItem, credits: publicItem.credits.map(credit => Object.fromEntries(
      ['name', 'role', 'roleLabel', 'identityKey', 'identityConfidence'].filter(key => Object.hasOwn(credit, key)).map(key => [key, credit[key]])
    )) };
  }) };
}

export async function writeCatalogRelease(publicPath, sourceCatalog) {
  const catalog = projectPublicCatalog(sourceCatalog);
  const contents = JSON.stringify(catalog), hash = digest(contents);
  const catalogUrl = `/data/live-catalog.${hash.slice(0, 16)}.json`;
  const manifest = {
    schemaVersion: 1, source: 'supabase', generatedAt: catalog.meta.generatedAt, catalogUrl, hash,
    total: catalog.meta.total, loaded: catalog.meta.loaded, excluded: catalog.meta.excluded,
    available: catalog.meta.available, adultExcluded: catalog.meta.adultExcluded,
    bytes: Buffer.byteLength(contents), gzipBytes: gzipSync(contents).length,
    brotliBytes: brotliCompressSync(contents, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length,
    compressionEstimate: 'gzip level 6; Brotli quality 6; actual CDN transfer varies'
  };
  const dataPath = path.resolve(publicPath, 'data');
  await mkdir(dataPath, { recursive: true });
  await writeFile(path.join(dataPath, path.basename(catalogUrl)), contents);
  if(manifest.bytes>20_000_000){
    manifest.parts=[];
    for(let offset=0;offset<catalog.items.length;offset+=5000){
      const selected=catalog.items.slice(offset,offset+5000),partContents=JSON.stringify({items:selected}),partHash=digest(partContents);
      const url=`/data/catalog-part.${partHash.slice(0,16)}.json`;
      if(Buffer.byteLength(partContents)>24_000_000)throw new Error('catalog_part_exceeds_upload_limit');
      await writeFile(path.join(dataPath,path.basename(url)),partContents);
      manifest.parts.push({url,hash:partHash,bytes:Buffer.byteLength(partContents),count:selected.length});
    }
    const metadata=JSON.stringify({taxonomy:catalog.taxonomy,meta:catalog.meta}),metadataHash=digest(metadata);
    manifest.metadataUrl=`/data/catalog-meta.${metadataHash.slice(0,16)}.json`;
    manifest.metadataHash=metadataHash;
    await writeFile(path.join(dataPath,path.basename(manifest.metadataUrl)),metadata);
  }
  const temporaryPath = path.join(dataPath, 'catalog-release.json.pending');
  await writeFile(temporaryPath, JSON.stringify(manifest, null, 2) + '\n');
  await rename(temporaryPath, path.join(dataPath, 'catalog-release.json'));
  return { catalog, manifest, sourceCatalog };
}

export async function refreshCatalogRelease({ publicPath, readPage, generatedAt, onProgress }) {
  const catalog = await collectCatalog(readPage, { generatedAt, onProgress });
  return writeCatalogRelease(publicPath, catalog);
}

export async function readCatalogRelease(publicPath) {
  const manifest = JSON.parse(await readFile(path.resolve(publicPath, 'data/catalog-release.json'), 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest.source !== 'supabase' || !/^\/data\/live-catalog\.[a-f0-9]{16}\.json$/.test(manifest.catalogUrl) || !/^[a-f0-9]{64}$/.test(manifest.hash)) fail();
  if (manifest.catalogUrl !== `/data/live-catalog.${manifest.hash.slice(0, 16)}.json`) fail();
  let contents;
  if(manifest.parts){
    const items=[];
    for(const part of manifest.parts){
      if(!/^\/data\/catalog-part\.[a-f0-9]{16}\.json$/.test(part.url)||!Number.isSafeInteger(part.count))fail();
      const raw=await readFile(path.join(publicPath,'data',path.basename(part.url)),'utf8');
      if(digest(raw)!==part.hash||Buffer.byteLength(raw)!==part.bytes)fail();
      const value=JSON.parse(raw);if(value.items.length!==part.count)fail();items.push(...value.items);
    }
    if(!/^\/data\/catalog-meta\.[a-f0-9]{16}\.json$/.test(manifest.metadataUrl))fail();
    const raw=await readFile(path.join(publicPath,'data',path.basename(manifest.metadataUrl)),'utf8');
    if(digest(raw)!==manifest.metadataHash)fail();
    const metadata=JSON.parse(raw);contents=JSON.stringify({items,taxonomy:metadata.taxonomy,meta:metadata.meta});
  }else contents=await readFile(path.join(publicPath, 'data', path.basename(manifest.catalogUrl)), 'utf8');
  if (digest(contents) !== manifest.hash || Buffer.byteLength(contents) !== manifest.bytes) fail();
  const catalog = validateCatalog(JSON.parse(contents));
  for (const key of ['total', 'loaded', 'excluded', 'available', 'adultExcluded', 'generatedAt']) if (manifest[key] !== catalog.meta[key]) fail();
  return { catalog, manifest };
}
