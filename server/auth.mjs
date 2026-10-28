import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { readBoundedJSON, SECURITY_HEADERS } from './security.mjs';

const PROVIDERS = Object.freeze({
  naver: { name: '네이버', authorize: 'https://nid.naver.com/oauth2.0/authorize', token: 'https://nid.naver.com/oauth2.0/token', profile: 'https://openapi.naver.com/v1/nid/me', clientId: 'NAVER_CLIENT_ID', clientSecret: 'NAVER_CLIENT_SECRET' },
  kakao: { name: '카카오', authorize: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token', profile: 'https://kapi.kakao.com/v2/user/me', clientId: 'KAKAO_CLIENT_ID', clientSecret: 'KAKAO_CLIENT_SECRET' }
});
const STATE_SECONDS = 600;
const SESSION_SECONDS = 86400;
const BASE_HEADERS = { ...SECURITY_HEADERS, 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' };

function configuration(env) {
  let origin = null;
  try {
    const parsed = new URL(env.AUTH_BASE_URL || '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/' && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local && env.VERCEL_ENV !== 'production' && env.NODE_ENV !== 'production'))) origin = parsed.origin;
  } catch { /* Incomplete setup must not enable authentication. */ }
  let key = null;
  const secret = env.AUTH_SESSION_SECRET || '';
  if (/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    const decoded = Buffer.from(secret, 'base64url');
    if (decoded.length === 32 && decoded.toString('base64url') === secret) key = decoded;
  }
  return { origin, key, secure: origin?.startsWith('https:') === true, env };
}

function names(config) {
  const prefix = config.secure ? '__Host-' : '';
  return { session: prefix + 'chalpick_session', state: provider => prefix + 'chalpick_oauth_' + provider };
}

function cookie(name, value, seconds, secure) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}

function readCookie(request, name) {
  const matches = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

function seal(payload, config, purpose) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.key, iv);
  cipher.setAAD(Buffer.from(`chalpick:${purpose}:v1:${config.origin}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function unseal(value, config, purpose, now, maxAge) {
  if (!config.key || !config.origin || typeof value !== 'string' || value.length > 3800) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !parts.slice(1).every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const [iv, tag, ciphertext] = parts.slice(1).map(part => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || parts.slice(1).some((part, i) => [iv, tag, ciphertext][i].toString('base64url') !== part)) return null;
    const decipher = createDecipheriv('aes-256-gcm', config.key, iv);
    decipher.setAAD(Buffer.from(`chalpick:${purpose}:v1:${config.origin}`));
    decipher.setAuthTag(tag);
    const data = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    if (!Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp) || data.iat > now + 30 || data.exp <= now || data.exp <= data.iat || data.exp - data.iat > maxAge) return null;
    return data;
  } catch { return null; }
}

function constantEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function response(body, status = 200, cookies = [], extra = {}) {
  const headers = new Headers({ ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(destination, cookies = []) {
  const headers = new Headers({ ...BASE_HEADERS, Location: destination });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

function credentials(config, provider) {
  const spec = PROVIDERS[provider];
  return spec && config.origin && config.key && config.env[spec.clientId]?.trim() && config.env[spec.clientSecret]?.trim();
}

function validUser(user) {
  return user && Object.hasOwn(PROVIDERS, user.provider) && typeof user.id === 'string' && user.id.startsWith(user.provider + ':') && user.id.length <= 220 && typeof user.name === 'string' && user.name.length > 0 && user.name.length <= 80;
}

function userSession(request, config, now) {
  const data = unseal(readCookie(request, names(config).session), config, 'session', now, SESSION_SECONDS);
  return validUser(data?.user) ? data.user : null;
}

export function readAuthenticatedSession(request, { env = process.env, now = () => Date.now() } = {}) {
  const config = configuration(env);
  if (new URL(request.url).origin !== config.origin) return null;
  const user = userSession(request, config, Math.floor(now() / 1000));
  if (!user) return null;
  return { id: user.id, provider: user.provider, name: user.name, ...validatedDemographics(user, now()) };
}

function validatedDemographics(values, timestamp) {
  const gender = ['male', 'female'].includes(values?.gender) ? values.gender : null;
  const year = typeof values?.birthyear === 'number' ? values.birthyear : /^\d{4}$/.test(values?.birthyear || '') ? Number(values.birthyear) : null;
  const currentYear = new Date(timestamp).getUTCFullYear();
  const birthyear = Number.isInteger(year) && year >= currentYear - 120 && year <= currentYear ? year : null;
  return { gender, birthyear };
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, provider: user.provider, name: user.name, demographicsComplete: Boolean(user.gender && user.birthyear) };
}

function trustedMutation(request, config) {
  return Boolean(config.origin) && request.headers.get('origin') === config.origin && request.headers.get('sec-fetch-site') !== 'cross-site' && request.headers.get('x-chalpick-auth') === '1' && (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === 'application/json';
}

function callbackURL(config, provider) {
  const url = new URL('/api/auth', config.origin);
  url.searchParams.set('action', 'callback');
  url.searchParams.set('provider', provider);
  return url.href;
}

async function fetchJSON(fetchImpl, url, options) {
  const result = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!result.ok) throw new Error('provider_http_error');
  const data = await readBoundedJSON(result, 262_144);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('provider_invalid_response');
  return data;
}

async function authenticate(provider, code, state, config, fetchImpl, timestamp) {
  const spec = PROVIDERS[provider];
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.env[spec.clientId].trim(), client_secret: config.env[spec.clientSecret].trim(), redirect_uri: callbackURL(config, provider), code });
  if (provider === 'naver') body.set('state', state);
  const tokens = await fetchJSON(fetchImpl, spec.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' }, body });
  if (tokens.error || typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.access_token.length > 8192 || /[\r\n]/.test(tokens.access_token) || (tokens.token_type && String(tokens.token_type).toLowerCase() !== 'bearer')) throw new Error('provider_invalid_token');
  const profileURL = new URL(spec.profile);
  if (provider === 'kakao') profileURL.searchParams.set('property_keys', JSON.stringify(['kakao_account.profile.nickname', 'kakao_account.gender', 'kakao_account.birthyear']));
  const profile = await fetchJSON(fetchImpl, profileURL.href, { method: 'GET', headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } });
  let id, nickname;
  if (provider === 'naver') {
    if (profile.resultcode !== '00') throw new Error('provider_invalid_profile');
    id = profile.response?.id;
    nickname = profile.response?.nickname;
  } else {
    id = profile.id;
    nickname = profile.kakao_account?.profile?.nickname;
  }
  if ((typeof id !== 'string' && typeof id !== 'number') || (typeof id === 'number' && !Number.isSafeInteger(id)) || !String(id).trim() || String(id).length > 200) throw new Error('provider_missing_identity');
  const name = (typeof nickname === 'string' ? nickname.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '') || `${spec.name} 회원`;
  const demographics = validatedDemographics(provider === 'kakao' ? profile.kakao_account : {}, timestamp);
  return { id: `${provider}:${String(id)}`, provider, name, ...demographics };
}

/** Web Request/Response handler, shared by Vercel and the local Node adapter. */
export async function handleAuth(request, { env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (request.url.length > 8192) return response({ error: 'invalid_request' }, 414);
  const config = configuration(env);
  const timestamp = Math.floor(now() / 1000);
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'session';
  const provider = url.searchParams.get('provider');
  const cookieNames = names(config);
  const originMatches = config.origin === url.origin;
  const clearState = provider && Object.hasOwn(PROVIDERS, provider) ? [cookie(cookieNames.state(provider), '', 0, config.secure)] : [];
  const failCallback = reason => redirect(new URL('/?auth_error=' + reason, config.origin).href, clearState);

  if (['action', 'provider', 'code', 'state', 'error'].some(name => url.searchParams.getAll(name).length > 1)) return response({ error: 'invalid_request', message: '로그인 요청이 올바르지 않습니다.' }, 400);
  if (!['status', 'session', 'start', 'callback', 'logout'].includes(action)) return response({ error: 'not_found' }, 404);
  const expectedMethod = ['start', 'logout'].includes(action) ? 'POST' : 'GET';
  if (request.method !== expectedMethod) return response({ error: 'method_not_allowed' }, 405, [], { Allow: expectedMethod });

  if (action === 'status' || action === 'session') {
    const user = originMatches ? userSession(request, config, timestamp) : null;
    return response({ authenticated: Boolean(user), user: publicUser(user), providers: Object.entries(PROVIDERS).map(([id, spec]) => ({ id, name: spec.name, enabled: Boolean(originMatches && credentials(config, id)) })), available: Boolean(originMatches && config.key && Object.keys(PROVIDERS).some(id => credentials(config, id))) });
  }
  if (!config.origin || !originMatches) return response({ error: 'not_configured', message: '이 주소의 로그인 연결 설정이 완료되지 않았습니다.' }, 503);
  if (action === 'logout') {
    if (!trustedMutation(request, config)) return response({ error: 'invalid_origin', message: '이 페이지에서 다시 로그아웃해주세요.' }, 403);
    return response({ authenticated: false, user: null }, 200, [cookie(cookieNames.session, '', 0, config.secure), ...Object.keys(PROVIDERS).map(id => cookie(cookieNames.state(id), '', 0, config.secure))]);
  }
  if (!provider || !Object.hasOwn(PROVIDERS, provider)) return response({ error: 'invalid_provider', message: '지원하지 않는 로그인 방식입니다.' }, 400);
  if (!credentials(config, provider)) return action === 'callback' ? failCallback('unavailable') : response({ error: 'not_configured', message: '선택한 소셜 로그인의 연결 설정이 완료되지 않았습니다.' }, 503);

  if (action === 'start') {
    if (!trustedMutation(request, config)) return response({ error: 'invalid_origin', message: '이 페이지에서 다시 로그인을 시작해주세요.' }, 403);
    const state = randomBytes(32).toString('base64url');
    const stored = seal({ state, provider, iat: timestamp, exp: timestamp + STATE_SECONDS }, config, 'oauth-state');
    const destination = new URL(PROVIDERS[provider].authorize);
    destination.search = new URLSearchParams({ response_type: 'code', client_id: config.env[PROVIDERS[provider].clientId].trim(), redirect_uri: callbackURL(config, provider), state }).toString();
    if (provider === 'kakao') destination.searchParams.set('scope', 'profile_nickname,gender,birthyear');
    return response({ authorizationUrl: destination.href }, 200, [cookie(cookieNames.state(provider), stored, STATE_SECONDS, config.secure)]);
  }

  const state = url.searchParams.get('state');
  const stored = unseal(readCookie(request, cookieNames.state(provider)), config, 'oauth-state', timestamp, STATE_SECONDS);
  if (!state || state.length > 100 || stored?.provider !== provider || !constantEqual(state, stored?.state)) return failCallback('invalid_state');
  if (url.searchParams.has('error')) return failCallback(url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'provider_error');
  const code = url.searchParams.get('code');
  if (!code || code.length > 2048 || /[\r\n]/.test(code)) return failCallback('invalid_response');
  try {
    const user = await authenticate(provider, code, state, config, fetchImpl, now());
    const { synchronizeOAuthIdentity } = await import('./user-profiles.mjs');
    await synchronizeOAuthIdentity(user, { env, fetchImpl });
    const session = seal({ user, iat: timestamp, exp: timestamp + SESSION_SECONDS }, config, 'session');
    return redirect(new URL('/?auth=success', config.origin).href, [...clearState, cookie(cookieNames.session, session, SESSION_SECONDS, config.secure)]);
  } catch {
    // Never log authorization codes, provider response bodies, cookies, or tokens.
    return failCallback('provider_error');
  }
}

/** Local server adapter. Call only for /api/auth; it does not read or persist bodies. */
export async function handleNodeAuth(req, res, options) {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const request = new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), { method: req.method, headers });
    const result = await handleAuth(request, options);
    const outgoing = Object.fromEntries([...result.headers].filter(([name]) => name !== 'set-cookie'));
    const cookies = result.headers.getSetCookie();
    if (cookies.length) outgoing['Set-Cookie'] = cookies;
    res.writeHead(result.status, outgoing);
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    res.writeHead(400, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'invalid_request', message: '로그인 요청을 처리하지 못했습니다.' }));
  }
}
