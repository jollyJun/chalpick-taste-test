import {chooseVisitTheme} from './context.js';

export const CONTEXT_WEATHER_CACHE_KEY = 'chalpick-context-weather-v1';
export const CONTEXT_WEATHER_CACHE_MS = 10 * 60 * 1000;
export const CONTEXT_WEATHER_DEADLINE_MS = 800;
const WEATHER_SOURCE = Object.freeze({name:'MET Norway',url:'https://www.met.no/en',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'});

function browserStorage(name) {
  try { return globalThis[name]; } catch { return null; }
}

function cleanWeather(value, now) {
  if (value?.available !== true || ![null,'rain','snow'].includes(value.condition)) return null;
  const forecastAt = Date.parse(value.forecastAt), forecastUntil = Date.parse(value.forecastUntil);
  if (!Number.isFinite(forecastAt) || !Number.isFinite(forecastUntil) || forecastAt > now || forecastUntil <= now || forecastUntil - forecastAt > 60 * 60 * 1000) return null;
  return {available:true,condition:value.condition,isForecast:true,forecastAt:new Date(forecastAt).toISOString(),forecastUntil:new Date(forecastUntil).toISOString(),source:WEATHER_SOURCE};
}

function cachedWeather(storage, now) {
  try {
    const cached = JSON.parse(storage?.getItem(CONTEXT_WEATHER_CACHE_KEY) || 'null');
    if (cached?.version !== 1 || !Number.isFinite(cached.savedAt) || cached.savedAt > now || now - cached.savedAt >= CONTEXT_WEATHER_CACHE_MS) return null;
    return cleanWeather(cached.weather,now);
  } catch { return null; }
}

function storeWeather(storage, weather, now) {
  try { storage?.setItem(CONTEXT_WEATHER_CACHE_KEY,JSON.stringify({version:1,savedAt:now,weather})); } catch {}
}

function resolveWeather({fetchImpl,weatherStorage,now,timeoutMs}) {
  const cached = cachedWeather(weatherStorage,now());
  if (cached) return Promise.resolve(cached);
  if (typeof fetchImpl !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    const controller = new AbortController();
    let settled = false;
    const finish = weather => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (weather) storeWeather(weatherStorage,weather,now());
      resolve(weather);
    };
    const timer = setTimeout(() => {
      finish(null);
      controller.abort();
    },Math.min(CONTEXT_WEATHER_DEADLINE_MS,Math.max(1,Number(timeoutMs) || CONTEXT_WEATHER_DEADLINE_MS)));
    Promise.resolve().then(async () => {
      const response = await fetchImpl('/api/weather',{signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
      if (!response.ok) return null;
      const declaredSize = Number(response.headers?.get('content-length'));
      if (declaredSize > 16_384) return null;
      const text = await response.text();
      if (text.length > 16_384) return null;
      return cleanWeather(JSON.parse(text),now());
    }).then(finish,() => finish(null));
  });
}

export function createContextSession({storage = browserStorage('localStorage'),weatherStorage = browserStorage('sessionStorage'),fetchImpl = globalThis.fetch,now = Date.now,timeoutMs = CONTEXT_WEATHER_DEADLINE_MS} = {}) {
  let pending = null;
  return {
    getContext({items = [],date = new Date(now())} = {}) {
      if (!pending) pending = resolveWeather({fetchImpl,weatherStorage,now,timeoutMs}).then(weather => ({choice:chooseVisitTheme({items,date,weather,storage}),weather}));
      return pending;
    }
  };
}

export function createVisitContextLoader(options = {}) {
  let session = null;
  return ({items = [],date,storage = options.storage} = {}) => {
    session ||= createContextSession({...options,...(storage === undefined ? {} : {storage})});
    return session.getContext({items,...(date === undefined ? {} : {date})});
  };
}

let defaultSession = null;
export function getContext(options) {
  defaultSession ||= createContextSession();
  return defaultSession.getContext(options);
}
