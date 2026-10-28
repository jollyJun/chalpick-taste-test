import {createActivityClient, activityErrorMessage} from './activity-client.js';

const STATUS_LABELS = {watched:'봤어요',want:'보고 싶어요',avoid:'안 보고 싶어요'};
const text = (tag, className, content) => {const element = document.createElement(tag); if (className) element.className = className; if (content !== undefined) element.textContent = content; return element;};
const action = (label, className = '') => {const button = text('button',className,label); button.type = 'button'; return button;};
const dateLabel = value => {const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'short',day:'numeric'}).format(date) : '';};
const starsLabel = stars => stars === null || stars === undefined ? '별점 미등록' : `별점 ${stars} / 5`;
function imageSource(value) {
  if (typeof value !== 'string') return null;
  try {const url = new URL(value,location.origin); return url.protocol === 'https:' || (url.origin === location.origin && url.pathname.startsWith('/assets/')) ? url.href : null;} catch {return null;}
}

export function initMyPage({getWork = () => null, onOpenWork = () => {}} = {}) {
  if (document.getElementById('my-page-dialog')) return null;
  if (!document.querySelector('link[data-chalpick-my-page-style]')) {const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/my-page.css'; style.dataset.chalpickMyPageStyle = ''; document.head.append(style);}
  let auth = {authenticated:false,user:null}, view = 'watched', lastFocus, listSequence = 0, loaded = [], nextBefore, hasMore = false, listPending = false;
  const mounted = new Set();
  const client = createActivityClient({onChange:item => document.dispatchEvent(new CustomEvent('chalpick:activitychange',{detail:{item}}))});
  const dialog = text('dialog','my-page-dialog'); dialog.id = 'my-page-dialog'; dialog.setAttribute('aria-labelledby','my-page-title');
  dialog.innerHTML = `<div class="my-page-heading"><div><p class="my-page-eyebrow">MY CHALPICK</p><h2 id="my-page-title">마이 페이지</h2></div><button type="button" class="my-page-close" aria-label="마이 페이지 닫기">×</button></div><div class="my-page-account"><div><p class="my-page-name"></p><p class="my-page-provider"></p></div><button type="button" class="my-page-logout">로그아웃</button></div><p class="my-page-description">본 작품과 다음에 보고 싶은 작품, 나의 별점을 모아보세요.</p><div class="my-page-tabs" role="group" aria-label="감상 기록 종류"></div><p class="my-page-message" role="status" aria-live="polite"></p><div class="my-page-list"></div><button type="button" class="my-page-more" hidden>기록 더보기</button>`;
  document.body.append(dialog);
  const message = dialog.querySelector('.my-page-message'), list = dialog.querySelector('.my-page-list'), more = dialog.querySelector('.my-page-more');
  const tabs = dialog.querySelector('.my-page-tabs');
  for (const [key,label] of [...Object.entries(STATUS_LABELS),['history','변경 이력']]) {
    const button = action(label,'my-page-tab'); button.dataset.view = key; button.setAttribute('aria-pressed',String(view === key));
    button.addEventListener('click',() => {if (view === key) return; view = key; renderTabs(); loadList();}); tabs.append(button);
  }
  function renderTabs(counts) {
    for (const button of tabs.children) {
      const key = button.dataset.view, count = counts?.[key];
      button.setAttribute('aria-pressed',String(view === key));
      button.textContent = `${STATUS_LABELS[key] || '변경 이력'}${Number.isSafeInteger(count) && count >= 0 ? ` ${count.toLocaleString('ko-KR')}` : ''}`;
    }
  }
  function renderAccount() {
    dialog.querySelector('.my-page-name').textContent = auth.user ? `${auth.user.name}님` : '';
    dialog.querySelector('.my-page-provider').textContent = auth.user ? `${auth.user.provider === 'kakao' ? '카카오' : auth.user.provider === 'naver' ? '네이버' : '소셜'} 계정으로 로그인했어요.` : '';
  }
  function close() {dialog.close(); if (lastFocus?.isConnected) lastFocus.focus({preventScroll:true});}
  function open() {
    if (!auth.authenticated) {document.dispatchEvent(new CustomEvent('chalpick:login')); return;}
    lastFocus = document.activeElement; renderAccount();
    if (!dialog.open) dialog.showModal();
    loadList();
  }
  function openWork(id) {close(); onOpenWork(id);}
  function renderRecords() {
    list.replaceChildren();
    for (const item of loaded) {
      const work = getWork(item.contentId), row = text('article','my-page-record');
      const title = work?.title || item.title || '등록한 작품', media = work?.type || work?.media || item.media || '';
      const summary = text('div','my-page-record-summary');
      const heading = action(title,'my-page-work-title'); heading.addEventListener('click',() => openWork(item.contentId)); summary.append(heading);
      if (view === 'history') {
        const before = item.previousStatus ? `${STATUS_LABELS[item.previousStatus] || ''}${item.previousStars != null ? ` · ${starsLabel(item.previousStars)}` : ''}` : '기록 없음';
        const after = item.status ? `${STATUS_LABELS[item.status] || ''}${item.stars != null ? ` · ${starsLabel(item.stars)}` : ''}` : '현재 기록 해제';
        summary.append(text('p','my-page-history-change',`${before} → ${after}`),text('p','my-page-record-meta',[media,dateLabel(item.occurredAt)].filter(Boolean).join(' · ')));
      } else {
        const source = imageSource(work?.image || work?.cover || work?.thumbnail || item.thumbnail);
        if (source) {const cover = text('img','my-page-cover'); cover.src = source; cover.alt = ''; cover.loading = 'lazy'; cover.referrerPolicy = 'no-referrer'; row.append(cover);}
        const recorded = item.status === 'watched' && item.watchedAt ? `감상 기록 ${dateLabel(item.watchedAt)}` : '';
        summary.append(text('p','my-page-record-state',`${STATUS_LABELS[item.status]}${item.status === 'watched' ? ` · ${starsLabel(item.stars)}` : ''}`),text('p','my-page-record-meta',[media,recorded,item.updatedAt ? `수정 ${dateLabel(item.updatedAt)}` : ''].filter(Boolean).join(' · ')));
        const edit = action('기록 수정','my-page-edit'); edit.addEventListener('click',() => openWork(item.contentId)); summary.append(edit);
      }
      row.append(summary); list.append(row);
    }
    more.hidden = !hasMore; more.disabled = listPending;
  }
  async function loadList(append = false) {
    const sequence = ++listSequence; listPending = true; more.disabled = true;
    if (!append) {loaded = []; nextBefore = undefined; hasMore = false; list.replaceChildren(); more.hidden = true;}
    message.textContent = '감상 기록을 불러오고 있어요.';
    try {
      const result = await client.list(view === 'history' ? {view:'history',before:append ? nextBefore : undefined} : {view:'current',status:view,offset:append ? loaded.length : 0});
      if (sequence !== listSequence || !auth.authenticated) return;
      loaded = append ? [...loaded,...result.items] : result.items;
      nextBefore = result.nextBefore; hasMore = result.hasMore; renderTabs(result.counts);
      message.textContent = loaded.length ? (view === 'history' ? '감상 상태와 별점을 변경한 이력이에요.' : '') : view === 'history' ? '아직 감상 기록의 변경 이력이 없어요.' : '아직 등록한 작품이 없어요. 작품 상세 화면에서 감상 상태를 선택해보세요.';
      renderRecords();
    } catch (error) {
      if (sequence !== listSequence || error.code === 'stale_session') return;
      message.textContent = activityErrorMessage(error);
      if (!message.querySelector('button')) {const retry = action('다시 시도','activity-retry'); retry.addEventListener('click',() => loadList(append)); message.append(retry);}
    } finally {if (sequence === listSequence) {listPending = false; more.disabled = false;}}
  }
  dialog.querySelector('.my-page-close').addEventListener('click',close);
  dialog.addEventListener('cancel',event => {event.preventDefault(); close();});
  dialog.addEventListener('click',event => {if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();});
  more.addEventListener('click',() => {if (!listPending) loadList(true);});
  dialog.querySelector('.my-page-logout').addEventListener('click',event => {event.currentTarget.disabled = true; document.dispatchEvent(new CustomEvent('chalpick:logout'));});
  document.addEventListener('chalpick:logoutresult',event => {dialog.querySelector('.my-page-logout').disabled = false; if (!event.detail?.ok) message.textContent = '로그아웃하지 못했어요. 다시 시도해주세요.';});
  document.addEventListener('chalpick:mypage',open);
  document.addEventListener('chalpick:authchange',event => {
    auth = event.detail || {authenticated:false,user:null}; const changed = client.setAuth(auth); renderAccount();
    if (!changed) return;
    listSequence += 1; loaded = []; list.replaceChildren(); message.textContent = ''; renderTabs();
    for (const controls of mounted) {if (!controls.host.isConnected) {controls.dispose(); continue;} controls.refresh();}
    if (!auth.authenticated && dialog.open) close(); else if (dialog.open) loadList();
  });
  document.addEventListener('chalpick:activitychange',event => {
    const item = event.detail?.item;
    for (const controls of mounted) {if (!controls.host.isConnected) {controls.dispose(); continue;} if (controls.contentId === item?.contentId) controls.update(item);}
    if (dialog.open) loadList();
  });

  function mountActivityControls(host, work) {
    const id = Number(work?.id); if (!host || !Number.isSafeInteger(id) || id <= 0) return () => {};
    let item = null, pending = false, disposed = false, sequence = 0, errorMessage = '', restoreControl = '';
    const controls = {host,contentId:id,dispose:() => {disposed = true; sequence += 1; mounted.delete(controls);},refresh,update:next => {item = next; errorMessage = ''; render();}};
    mounted.add(controls); host.classList.add('activity-controls'); host.setAttribute('aria-label','나의 감상 기록');
    function render() {
      if (disposed) return;
      host.setAttribute('aria-busy',String(pending));
      if (host.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON') restoreControl = document.activeElement.getAttribute('aria-label') || document.activeElement.textContent;
      host.replaceChildren(text('h3','activity-heading','나의 감상 기록'));
      if (!client.isAuthenticated()) {
        host.append(text('p','activity-note','로그인하면 감상 상태와 별점을 기록할 수 있어요.'));
        const login = action('로그인하고 기록하기','activity-login'); login.addEventListener('click',() => document.dispatchEvent(new CustomEvent('chalpick:login'))); host.append(login); return;
      }
      const choices = text('div','activity-status-buttons'); choices.setAttribute('role','group'); choices.setAttribute('aria-label','감상 상태');
      for (const [status,label] of Object.entries(STATUS_LABELS)) {
        const button = action(label,'activity-status'); button.setAttribute('aria-pressed',String(item?.status === status)); button.disabled = pending || !item;
        button.addEventListener('click',() => {if (item?.status === status) return; save(status,status === 'watched' ? item?.stars ?? null : null);}); choices.append(button);
      }
      host.append(choices);
      if (item?.status === 'watched') {
        const rating = text('div','activity-rating'); rating.setAttribute('role','group'); rating.setAttribute('aria-label','작품 별점'); rating.append(text('span','activity-rating-label','내 별점'));
        for (let star = 1; star <= 5; star += 1) {
          const button = action('★','activity-star'); button.setAttribute('aria-label',`${star}점`); button.setAttribute('aria-pressed',String(item.stars === star)); button.classList.toggle('is-filled',item.stars !== null && star <= item.stars); button.disabled = pending; button.addEventListener('click',() => {if (item.stars !== star) save('watched',star);}); rating.append(button);
        }
        rating.append(text('span','activity-rating-value',starsLabel(item.stars)));
        if (item.stars !== null) {const clearRating = action('별점 지우기','activity-clear'); clearRating.disabled = pending; clearRating.addEventListener('click',() => save('watched',null)); rating.append(clearRating);}
        host.append(rating);
      } else host.append(text('p','activity-note','‘봤어요’를 선택하면 별점을 남길 수 있어요.'));
      if (item?.status) {const clear = action('현재 기록 해제','activity-clear'); clear.disabled = pending; clear.addEventListener('click',() => save(null,null)); host.append(clear);}
      const feedback = text('p','activity-feedback',errorMessage || (pending ? '기록을 확인하고 있어요.' : item?.status ? '계정에 저장되며 마이 페이지에서 확인할 수 있어요.' : '감상 상태를 선택하면 계정에 기록돼요.')); feedback.setAttribute('role','status'); feedback.setAttribute('aria-live','polite'); host.append(feedback);
      if (errorMessage) {const retry = action('다시 불러오기','activity-retry'); retry.disabled = pending; retry.addEventListener('click',refresh); host.append(retry);}
      if (!pending && restoreControl) {const matching = [...host.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') || button.textContent) === restoreControl); (matching || choices.querySelector('button'))?.focus({preventScroll:true}); restoreControl = '';}
    }
    async function refresh() {
      const requestSequence = ++sequence; item = null; errorMessage = ''; pending = true; render();
      if (!client.isAuthenticated()) {pending = false; render(); return;}
      try {const result = await client.get(id,{fresh:true}); if (requestSequence === sequence && !disposed) item = result;}
      catch (error) {if (requestSequence === sequence && !disposed && error.code !== 'stale_session') errorMessage = activityErrorMessage(error);}
      finally {if (requestSequence === sequence && !disposed) {pending = false; render();}}
    }
    async function save(status,stars) {
      if (pending || !item || disposed) return;
      const requestSequence = ++sequence; pending = true; errorMessage = ''; render();
      try {const result = await client.save(id,{status,stars,expectedVersion:item.version}); if (requestSequence === sequence && !disposed) item = result;}
      catch (error) {
        if (requestSequence !== sequence || disposed || error.code === 'stale_session') return;
        errorMessage = activityErrorMessage(error);
        if (error.code === 'conflict') {try {item = await client.get(id,{fresh:true});} catch {item = null;}}
      } finally {if (requestSequence === sequence && !disposed) {pending = false; render();}}
    }
    refresh(); return controls.dispose;
  }
  return {open,mountActivityControls};
}
