const ENDPOINT = '/api/activity';
const STATUSES = new Set(['watched', 'want', 'avoid']);

export class ActivityError extends Error {
  constructor(code) { super(code); this.name = 'ActivityError'; this.code = code; }
}

export function activityErrorMessage(error) {
  return ({
    not_authenticated: '로그인하면 감상 상태와 별점을 기록할 수 있어요.',
    not_configured: '감상 기록 연결을 준비하고 있어요. 잠시 후 다시 이용해주세요.',
    unlinked: '로그인은 완료됐지만 감상 기록용 회원 연결이 아직 준비되지 않았어요.',
    conflict: '다른 화면에서 기록이 변경됐어요. 최신 기록을 확인하고 다시 선택해주세요.',
    invalid_request: '기록할 내용을 다시 확인해주세요.',
    content_not_found: '현재 기록할 수 없는 작품이에요. 작품 목록을 새로고침해주세요.',
    too_many_requests: '잠시 쉬었다가 다시 시도해주세요.',
    unavailable: '감상 기록을 불러오거나 저장하지 못했어요. 다시 시도해주세요.',
    stale_session: '로그인 상태가 변경됐어요. 다시 시도해주세요.'
  })[error?.code] || '감상 기록을 불러오거나 저장하지 못했어요. 다시 시도해주세요.';
}

function contentId(value) { return Number.isSafeInteger(value) && value > 0; }
function version(value) { return Number.isSafeInteger(value) && value >= 0; }
function validStars(value) { return value === null || (Number.isFinite(value) && value >= 0.5 && value <= 5 && Number.isInteger(value * 2)); }
export function validateActivityItem(value) {
  if (!value || !contentId(value.contentId) || !(value.status === null || STATUSES.has(value.status)) || !validStars(value.stars) || !version(value.version) || (value.status !== 'watched' && value.stars !== null)) throw new ActivityError('unavailable');
  return {...value};
}

/** Account-scoped in-memory state. Session changes invalidate every outstanding response. */
export function createActivityClient({fetchImpl = globalThis.fetch, timeoutMs = 8000, onChange = () => {}, uuid = () => crypto.randomUUID()} = {}) {
  let identity = '', generation = 0;
  const controllers = new Set(), states = new Map();
  function setAuth(auth) {
    const next = auth?.authenticated && typeof auth.user?.id === 'string' ? auth.user.id : '';
    if (next === identity) return false;
    identity = next; generation += 1; states.clear();
    for (const controller of controllers) controller.abort();
    controllers.clear(); return true;
  }
  async function request(query, body) {
    if (!identity) throw new ActivityError('not_authenticated');
    const requestGeneration = generation, controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${ENDPOINT}${query ? `?${new URLSearchParams(query)}` : ''}`, {method: body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store', headers:body ? {'Content-Type':'application/json','X-Chalpick-Activity':'1'} : {Accept:'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}), signal:controller.signal});
      if (requestGeneration !== generation) throw new ActivityError('stale_session');
      const text = await response.text();
      if (text.length > 1_000_000) throw new ActivityError('unavailable');
      const data = JSON.parse(text);
      if (requestGeneration !== generation) throw new ActivityError('stale_session');
      if (!response.ok) throw new ActivityError(typeof data?.error === 'string' ? data.error : 'unavailable');
      if (!data || data.status !== 'ready') throw new ActivityError('unavailable');
      return data;
    } catch (error) {
      if (requestGeneration !== generation) throw new ActivityError('stale_session');
      if (error instanceof ActivityError) throw error;
      throw new ActivityError('unavailable');
    } finally {clearTimeout(timer); controllers.delete(controller);}
  }
  async function get(content, {fresh = false} = {}) {
    if (!contentId(content)) throw new ActivityError('invalid_request');
    if (!identity) throw new ActivityError('not_authenticated');
    if (!fresh && states.has(content)) return states.get(content);
    const item = validateActivityItem((await request({contentId:String(content)})).item);
    if (item.contentId !== content) throw new ActivityError('unavailable');
    states.set(content, item); return item;
  }
  async function list({view = 'current', status = 'watched', offset = 0, before, limit = 20} = {}) {
    const query = {view,limit:String(limit)};
    if (view === 'current') Object.assign(query,{status,offset:String(offset)});
    else if (before !== undefined && before !== null) query.before = String(before);
    const data = await request(query);
    if (!Array.isArray(data.items) || data.items.length > 50 || typeof data.hasMore !== 'boolean') throw new ActivityError('unavailable');
    if (view === 'current') {
      data.items = data.items.map(validateActivityItem);
      for (const item of data.items) states.set(item.contentId,item);
    }
    return data;
  }
  async function save(content, {status,stars = null,expectedVersion}) {
    if (!contentId(content) || !(status === null || STATUSES.has(status)) || !validStars(stars) || !version(expectedVersion) || (status !== 'watched' && stars !== null)) throw new ActivityError('invalid_request');
    const data = await request(null,{contentId:content,status,stars,expectedVersion,requestId:uuid()});
    const item = validateActivityItem(data.item);
    if (item.contentId !== content) throw new ActivityError('unavailable');
    states.set(content,item); onChange(item); return item;
  }
  return {setAuth,get,list,save,isAuthenticated:() => Boolean(identity)};
}
