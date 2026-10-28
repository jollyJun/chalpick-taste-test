import { readBoundedJSON, SECURITY_HEADERS } from './security.mjs';

// City-level weather context. User IPs, precise locations and cookies never go to MET.
const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const HOUR = 60 * 60 * 1000;
const SOURCE = Object.freeze({
  name: 'MET Norway',
  url: 'https://www.met.no/en',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  description: 'MET Norway의 현재 시간대 1시간 예보를 찰픽의 비/폭풍·눈 테마로 분류했습니다.'
});
const REGIONS = { '11': '서울', '26': '부산', '27': '대구', '28': '인천', '29': '광주', '30': '대전', '31': '울산', '41': '경기', '42': '강원', '43': '충북', '44': '충남', '45': '전북', '46': '전남', '47': '경북', '48': '경남', '49': '제주', '50': '세종' };
const CITIES = { seoul: '서울', busan: '부산', daegu: '대구', incheon: '인천', gwangju: '광주', daejeon: '대전', ulsan: '울산', sejong: '세종', suwon: '수원', seongnam: '성남', jeju: '제주', chuncheon: '춘천', cheongju: '청주', jeonju: '전주', changwon: '창원' };
const defaultCache = new Map();
const defaultPending = new Map();

function safeLabel(value) {
  try { return decodeURIComponent(value || '').replace(/[\p{Cc}<>]/gu, '').slice(0, 80).trim(); }
  catch { return ''; }
}

/** Trust these headers only inside a Vercel deployment, never on the local server. */
export function visitorRegion(request, env = process.env) {
  if (env.VERCEL !== '1') return null;
  const latText = request.headers.get('x-vercel-ip-latitude');
  const lonText = request.headers.get('x-vercel-ip-longitude');
  if (!latText?.trim() || !lonText?.trim()) return null;
  const latitude = Number(latText), longitude = Number(lonText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const country = safeLabel(request.headers.get('x-vercel-ip-country'));
  const city = safeLabel(request.headers.get('x-vercel-ip-city'));
  const state = safeLabel(request.headers.get('x-vercel-ip-country-region'));
  const region = (country === 'KR' ? CITIES[city.toLowerCase()] || city || REGIONS[state] : city || country) || '접속 지역';
  // Approximate 10 km grid: appropriate for IP-derived location and global forecast resolution.
  return { latitude: Number(latitude.toFixed(1)), longitude: Number(longitude.toFixed(1)), region };
}

export function weatherCondition(symbol) {
  if (typeof symbol !== 'string') return null;
  if (/snow|sleet/.test(symbol)) return 'snow';
  if (/rain|thunder/.test(symbol)) return 'rain';
  return null;
}

export function currentForecast(payload, now = Date.now()) {
  const timeseries = payload?.properties?.timeseries;
  if (!Array.isArray(timeseries)) return null;
  // Do not mistake tomorrow's rain or an old forecast for current weather.
  const point = timeseries.find(entry => {
    const timestamp = Date.parse(entry?.time);
    return Number.isFinite(timestamp) && timestamp <= now && timestamp + HOUR > now && typeof entry?.data?.next_1_hours?.summary?.symbol_code === 'string';
  });
  if (!point) return null;
  const symbol = point.data.next_1_hours.summary.symbol_code;
  return { condition: weatherCondition(symbol), forecastAt: point.time, forecastUntil: new Date(Date.parse(point.time) + HOUR).toISOString(), updatedAt: payload.properties.meta?.updated_at || null };
}

function unavailable(reason, region = null) {
  return { available: false, condition: null, region, isForecast: true, reason, source: SOURCE };
}

function expiry(response, now) {
  const expires = Date.parse(response.headers.get('expires'));
  return Number.isFinite(expires) && expires > now ? expires : now + 10 * 60 * 1000;
}

function remember(cache, key, value) {
  if (!cache.has(key) && cache.size >= 512) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

function failureExpiry(response, now) {
  const retry = response?.headers?.get('retry-after');
  const seconds = Number(retry);
  const date = Date.parse(retry);
  return Math.max(now + 60 * 1000, retry && Number.isFinite(seconds) ? now + seconds * 1000 : Number.isFinite(date) ? date : now + 5 * 60 * 1000);
}

async function fetchForecast(location, options) {
  const { fetchImpl, now, cache, pending, env } = options;
  const key = `${location.latitude.toFixed(1)},${location.longitude.toFixed(1)}`;
  const cached = cache.get(key);
  if (cached && cached.expires > now()) return cached.payload;
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    const headers = { 'User-Agent': env.WEATHER_USER_AGENT || 'Chalpick/1.0 https://chalpick.kr' };
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    const url = new URL(MET_URL);
    url.searchParams.set('lat', location.latitude.toFixed(1));
    url.searchParams.set('lon', location.longitude.toFixed(1));
    try {
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(4500), redirect: 'error' });
      if (response.status === 304 && cached?.payload) {
        remember(cache, key, { ...cached, expires: expiry(response, now()) });
        return cached.payload;
      }
      if (!response.ok) {
        remember(cache, key, { payload: null, expires: failureExpiry(response, now()) });
        return null;
      }
      const payload = await readBoundedJSON(response, 524_288);
      if (!Array.isArray(payload?.properties?.timeseries)) throw new Error('Invalid forecast');
      remember(cache, key, { payload, lastModified: response.headers.get('last-modified'), expires: expiry(response, now()) });
      return payload;
    } catch {
      remember(cache, key, { payload: null, expires: now() + 60 * 1000 });
      return null;
    }
  })();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}

export async function handleWeather(request, options = {}) {
  const env = options.env || process.env;
  const headers = { ...SECURITY_HEADERS, 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json; charset=utf-8' };
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
  const location = visitorRegion(request, env);
  if (!location) return Response.json(unavailable('region_unavailable'), { headers });
  const now = options.now || Date.now;
  const payload = await fetchForecast(location, { env, now, fetchImpl: options.fetchImpl || fetch, cache: options.cache || defaultCache, pending: options.pending || defaultPending });
  const forecast = payload && currentForecast(payload, now());
  if (!forecast) return Response.json(unavailable(payload ? 'forecast_unavailable' : 'provider_unavailable', location.region), { headers });
  return Response.json({ available: true, ...forecast, region: location.region, isForecast: true, source: SOURCE }, { headers });
}

export async function handleNodeWeather(req, res) {
  // Local previews have no trusted geographic headers; never infer a default city.
  const request = new Request(new URL(req.url, 'http://localhost'), { method: req.method, headers: req.headers });
  const response = await handleWeather(request, { env: { ...process.env, VERCEL: '0' } });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}
