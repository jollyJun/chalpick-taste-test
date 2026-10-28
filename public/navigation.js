import {normalizePlatformName} from './facets.js';

export const NAVIGATION_KEY = 'chalpick-navigation-v1';
const types = new Set(['웹툰', '웹소설', '드라마·OTT', '영화']);
const filterKeys = ['type', 'genre', 'setting', 'relationship', 'platform', 'q', 'sort', 'theme', 'mode', 'cast', 'work'];
const strings = values => Array.isArray(values) ? [...new Set(values.filter(value => typeof value === 'string').map(value => value.slice(0, 200)))].slice(0, 100) : [];
const text = value => typeof value === 'string' ? value.slice(0, 200) : '';

export function cleanNavigationState(value = {}) {
  return {
    types: strings(value.types).filter(type => types.has(type)).slice(0, 1),
    platforms: [...new Set(strings(value.platforms).map(normalizePlatformName).filter(Boolean))],
    tags: Object.fromEntries(['genre', 'setting', 'relationship'].map(group => [group, strings(value.tags?.[group])])),
    query: text(value.query), sort: ['taste', 'latest', 'title'].includes(value.sort) ? value.sort : 'taste',
    tab: ['genre', 'setting', 'relationship'].includes(value.tab) ? value.tab : 'genre', expanded: value.expanded === true,
    theme: text(value.theme), mode: value.mode === 'discovery' ? 'discovery' : 'all', person: text(value.person).slice(0, 80)
  };
}

function snapshot(value) {
  if (value?.schemaVersion !== 1 || !value.filters) return null;
  return {schemaVersion: 1, filters: cleanNavigationState(value.filters), workId: Number.isSafeInteger(value.workId) && value.workId > 0 ? value.workId : null};
}

export function readNavigation({href, historyState, storage}) {
  const params = new URL(href).searchParams;
  if (filterKeys.some(key => params.has(key))) {
    return snapshot({schemaVersion: 1, filters: {types: params.getAll('type'), platforms: params.getAll('platform'), tags: Object.fromEntries(['genre', 'setting', 'relationship'].map(group => [group, params.getAll(group)])), query: params.get('q'), sort: params.get('sort'), theme: params.get('theme'), mode: params.get('mode'), person: params.get('cast')}, workId: Number(params.get('work'))});
  }
  const previous = snapshot(historyState?.chalpickNavigation);
  if (previous) return previous;
  try {
    const stored = snapshot(JSON.parse(storage?.getItem(NAVIGATION_KEY) || 'null'));
    if (stored) return stored;
  } catch {}
  return snapshot({schemaVersion: 1, filters: {}});
}

export function canCleanNavigationURL(href) {
  const url = new URL(href);
  if (!['/', '/index.html'].includes(url.pathname)) return false;
  const fragment = new URLSearchParams(url.hash.slice(1));
  return !['code', 'state', 'access_token', 'refresh_token', 'id_token', 'auth', 'auth_error', 'error', 'error_description'].some(key => url.searchParams.has(key) || fragment.has(key));
}

export function writeNavigation({filters, workId = null, history, location, storage, replace = false}) {
  const next = snapshot({schemaVersion: 1, filters, workId});
  try { storage?.setItem(NAVIGATION_KEY, JSON.stringify(next)); } catch {}
  if (!canCleanNavigationURL(location.href)) return next;
  const previous = history.state?.chalpickNavigation;
  if (!replace && JSON.stringify(previous) === JSON.stringify(next) && new URL(location.href).pathname === '/' && !new URL(location.href).search && !new URL(location.href).hash) return next;
  history[replace ? 'replaceState' : 'pushState']({...history.state, chalpickNavigation: next}, '', '/');
  return next;
}
