const TB_JSON_URL_PATTERN = /^https:\/\/cdn\.mcr\.ea\.com\/\d+\/bundles-users\/[^/]+\/[^/]+\/[^/]*nonce-primary\.json(?:[?#].*)?$/i;
const seenUrls = new Set();
let lastReportedPageUrl = '';

function getPageKey(url = location.href) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/games\/(?:ea-sports-college-football|madden-nfl)\/team-builder\/(?:team-create\/brand|preview)\/([^/?#]+)/i);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function reportPageState(force = false) {
  const pageUrl = location.href;
  const pageKey = getPageKey(pageUrl);
  if (!pageKey) return;

  const signature = `${pageUrl}|${document.visibilityState}|${document.hasFocus()}`;
  if (!force && signature === lastReportedPageUrl) return;
  lastReportedPageUrl = signature;

  chrome.runtime.sendMessage({
    type: 'TB_PAGE_STATE',
    payload: {
      pageUrl,
      pageKey,
      title: document.title,
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
      ts: Date.now()
    }
  });
}

function reportUrl(url, source) {
  if (!url || !TB_JSON_URL_PATTERN.test(url) || seenUrls.has(url)) return;
  seenUrls.add(url);
  chrome.runtime.sendMessage({
    type: 'TB_JSON_URL_FOUND',
    payload: {
      url,
      source,
      pageUrl: location.href,
      pageKey: getPageKey(),
      title: document.title,
      ts: Date.now()
    }
  });
}

function scanPerformanceEntries() {
  try {
    performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .forEach(url => reportUrl(url, 'performance'));
  } catch {}
}

window.addEventListener('message', event => {
  if (event.source !== window) return;
  const data = event.data;
  if (data?.type === 'CFB_TB_JSON_URL_FOUND') {
    reportUrl(data.url, data.source || 'page-hook');
  } else if (data?.type === 'CFB_TB_REQUEST_LOG') {
    chrome.runtime.sendMessage({
      type: 'TB_REQUEST_LOG',
      entry: data.entry || {}
    });
  }
});

try {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('capture.js');
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script);
} catch {}

try {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      reportUrl(entry.name, 'performance-observer');
    }
  }).observe({ entryTypes: ['resource'] });
} catch {}

scanPerformanceEntries();
reportPageState(true);
setInterval(scanPerformanceEntries, 2000);
setInterval(() => reportPageState(), 1000);

window.addEventListener('focus', () => reportPageState(true));
window.addEventListener('pageshow', () => reportPageState(true));
document.addEventListener('visibilitychange', () => reportPageState(true));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'TB_FORCE_SCAN') return false;
  scanPerformanceEntries();
  reportPageState(true);
  sendResponse({
    ok: true,
    pageKey: getPageKey(),
    pageUrl: location.href
  });
  return false;
});
