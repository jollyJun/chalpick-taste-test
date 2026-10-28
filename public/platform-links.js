const officialHosts = new Set([
  'comic.naver.com', 'm.comic.naver.com', 'series.naver.com', 'm.series.naver.com',
  'www.netflix.com', 'netflix.com', 'qr.netflix.com', 'page.kakao.com', 'webtoon.kakao.com',
  'www.tving.com', 'tving.com', 'ridibooks.com', 'www.ridibooks.com',
  'utvmobile.onelink.me', 'www.wavve.com', 'wavve.com', 'deep.wavve.com',
  'watcha.com', 'www.watcha.com', 'www.coupangplay.com', 'coupangplay.com',
  'tv.apple.com', 'www.disneyplus.com', 'disneyplus.com'
]);

const androidAppLinks = [
  {host: 'www.netflix.com', path: /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?title\/[1-9]\d{0,11}\/?$/, packageName: 'com.netflix.mediaclient'},
  {host: 'www.tving.com', path: /^\/(?:contents\/[A-Za-z0-9_-]+|(?:movie|vod)\/player\/[A-Za-z0-9_-]+)\/?$/, packageName: 'net.cj.cjhv.gs.tving'},
  {host: 'www.wavve.com', path: /^\/player\/(?:movie|vod)\/?$/, packageName: 'kr.co.captv.pooqV2'},
  {host: 'watcha.com', path: /^\/(?:[a-z]{2}\/)?contents\/[A-Za-z0-9_-]+\/?$/, packageName: 'com.frograms.wplay'},
  {host: 'www.coupangplay.com', path: /^\/content\/[A-Za-z0-9-]+\/?$/, packageName: 'com.coupang.mobile.play'},
  {host: 'www.disneyplus.com', path: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:browse|movies|series|video)\/.+$/, packageName: 'com.disney.disneyplus'}
];

export function officialPlatformURL(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !officialHosts.has(url.hostname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function runtimeEnvironment() {
  return {
    userAgent: globalThis.navigator?.userAgent || '',
    navigatorPlatform: globalThis.navigator?.platform || '',
    maxTouchPoints: globalThis.navigator?.maxTouchPoints || 0
  };
}

function webtoonTitleId(url) {
  if (!['comic.naver.com', 'm.comic.naver.com'].includes(url.hostname) || !/^\/webtoon\/list(?:\.nhn)?\/?$/.test(url.pathname)) return '';
  const identifiers = url.searchParams.getAll('titleId');
  return identifiers.length === 1 && /^[1-9]\d{0,11}$/.test(identifiers[0]) ? identifiers[0] : '';
}

function androidIntent(resource, scheme, packageName, webURL) {
  return `intent://${resource}#Intent;scheme=${scheme};package=${packageName};S.browser_fallback_url=${encodeURIComponent(webURL)};end`;
}

export function platformDestination(value, environment = runtimeEnvironment()) {
  const webURL = officialPlatformURL(value);
  if (!webURL) return null;
  const userAgent = String(environment.userAgent || '');
  const android = /Android/i.test(userAgent);
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (environment.navigatorPlatform === 'MacIntel' && Number(environment.maxTouchPoints) > 1);
  const inApp = /;\s*wv\)|\bwv\b|KAKAOTALK|NAVER\(|FBAN|FBAV|Instagram|Line\/|DaumApps/i.test(userAgent);
  const chromiumAndroid = android && /Chrome\/|Chromium\/|SamsungBrowser\/|EdgA\//i.test(userAgent) && !inApp;
  const base = {href: webURL, webURL, target: android || ios ? '_self' : '_blank', mode: 'https'};
  if (!android && !ios) return base;
  const url = new URL(webURL);
  const titleId = webtoonTitleId(url);
  if (titleId && chromiumAndroid) {
    const fallback = `https://m.comic.naver.com/webtoon/list?titleId=${titleId}`;
    return {...base, href: androidIntent(`contentList?version=2&titleId=${titleId}&league=WEBTOON`, 'webtoonkr', 'com.nhn.android.webtoon', fallback), mode: 'android-intent'};
  }
  if (titleId && ios && !inApp) {
    return {...base, href: `https://apps.comic.naver.com/launchApp/contentList?version=2&titleId=${titleId}&league=WEBTOON`, mode: 'ios-universal'};
  }
  if (chromiumAndroid) {
    const verified = androidAppLinks.find(entry => entry.host === url.hostname && entry.path.test(url.pathname));
    if (verified) return {...base, href: androidIntent(`${url.host}${url.pathname}${url.search}`, 'https', verified.packageName, webURL), mode: 'android-app-link'};
  }
  return base;
}

export function installPlatformLinks(root = globalThis.document, getEnvironment = runtimeEnvironment) {
  if (!root?.addEventListener) return () => {};
  const handleClick = event => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.('a[data-platform-link]');
    if (!anchor || !root.contains(anchor) || anchor.hasAttribute('download')) return;
    const destination = platformDestination(anchor.getAttribute('href'), getEnvironment());
    if (!destination) {
      event.preventDefault();
      return;
    }
    if (destination.target !== '_self') return;
    const location = root.defaultView?.location || globalThis.location;
    if (typeof location?.assign !== 'function') return;
    event.preventDefault();
    location.assign(destination.href);
  };
  root.addEventListener('click', handleClick);
  return () => root.removeEventListener('click', handleClick);
}
