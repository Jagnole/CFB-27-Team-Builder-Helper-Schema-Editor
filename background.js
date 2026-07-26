const URL_STORE_KEY = 'teamBuilderJsonUrls';
const MOCK_STORE_KEY = 'teamBuilderJsonMocks';
const STATUS_STORE_KEY = 'teamBuilderHelperStatus';
const PAGE_STORE_KEY = 'teamBuilderPages';
const MAX_URLS = 100;
const DEBUGGER_PROTOCOL_VERSION = '1.3';
const DEBUGGER_URL_PATTERN = 'https://cdn.mcr.ea.com/*/bundles-users/*/*/*nonce-primary.json*';
const attachedDebuggerTabs = new Set();

function isTeamBuilderJsonUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'cdn.mcr.ea.com'
      && /\/bundles-users\//i.test(parsed.pathname)
      && /nonce-primary\.json$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function getTeamBuilderAssetKey(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/(\d+)\/bundles-users\/([^/]+)\/([^/]+)\//i);
    return match ? `${match[1]}/bundles-users/${match[2]}/${match[3]}` : '';
  } catch {
    return '';
  }
}

function getTeamBuilderPageKey(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'www.ea.com') return '';
    const match = parsed.pathname.match(/\/games\/(?:ea-sports-college-football|madden-nfl)\/team-builder\/(?:team-create\/brand|preview)\/([^/?#]+)/i);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

async function readUrls() {
  const data = await chrome.storage.local.get(URL_STORE_KEY);
  return Array.isArray(data[URL_STORE_KEY]) ? data[URL_STORE_KEY] : [];
}

async function writeUrls(urls) {
  await chrome.storage.local.set({ [URL_STORE_KEY]: urls.slice(0, MAX_URLS) });
}

async function readPages() {
  const data = await chrome.storage.local.get(PAGE_STORE_KEY);
  return data[PAGE_STORE_KEY] && typeof data[PAGE_STORE_KEY] === 'object' ? data[PAGE_STORE_KEY] : {};
}

async function writePages(pages) {
  await chrome.storage.local.set({ [PAGE_STORE_KEY]: pages });
}

async function readMocks() {
  const data = await chrome.storage.local.get(MOCK_STORE_KEY);
  return data[MOCK_STORE_KEY] && typeof data[MOCK_STORE_KEY] === 'object' ? data[MOCK_STORE_KEY] : {};
}

async function writeMocks(mocks) {
  await chrome.storage.local.set({ [MOCK_STORE_KEY]: mocks });
}

async function readStatus() {
  const data = await chrome.storage.local.get(STATUS_STORE_KEY);
  return data[STATUS_STORE_KEY] && typeof data[STATUS_STORE_KEY] === 'object' ? data[STATUS_STORE_KEY] : {};
}

async function writeStatus(patch) {
  const current = await readStatus();
  await chrome.storage.local.set({
    [STATUS_STORE_KEY]: {
      ...current,
      ...patch,
      updatedAt: Date.now()
    }
  });
}

async function rememberRequestLog(entry) {
  const current = await readStatus();
  const recentRequests = Array.isArray(current.recentRequests) ? current.recentRequests : [];
  const normalized = {
    url: entry?.url || '',
    method: entry?.method || 'GET',
    source: entry?.source || 'unknown',
    status: Number(entry?.status) || 0,
    ok: Boolean(entry?.ok),
    preview: String(entry?.preview || '').slice(0, 500),
    ts: entry?.ts || Date.now()
  };
  await writeStatus({
    recentRequests: [normalized, ...recentRequests].slice(0, 30)
  });
}

async function rememberUrl(entry) {
  if (!isTeamBuilderJsonUrl(entry?.url)) return;

  const urls = await readUrls();
  const pageKey = entry.pageKey || getTeamBuilderPageKey(entry.pageUrl || '');
  const normalized = {
    url: entry.url,
    assetKey: getTeamBuilderAssetKey(entry.url),
    pageKey,
    pageUrl: entry.pageUrl || '',
    title: entry.title || '',
    source: entry.source || 'unknown',
    seenAt: entry.ts || Date.now()
  };

  const withoutDuplicate = urls.filter(item => item.url !== normalized.url);
  await writeUrls([normalized, ...withoutDuplicate]);
}

async function rememberPageState(entry, sender) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return;

  const pages = await readPages();
  const pageUrl = entry?.pageUrl || sender?.tab?.url || '';
  const pageKey = entry?.pageKey || getTeamBuilderPageKey(pageUrl);
  if (!pageKey) return;

  pages[String(tabId)] = {
    tabId,
    pageKey,
    pageUrl,
    title: entry?.title || sender?.tab?.title || '',
    visible: Boolean(entry?.visible),
    focused: Boolean(entry?.focused),
    seenAt: entry?.ts || Date.now()
  };

  await writePages(pages);
  await writeStatus({ activePage: pages[String(tabId)] });
}

async function getLiveTeamBuilderTabs() {
  const tabs = await chrome.tabs.query({
    url: [
      'https://www.ea.com/games/ea-sports-college-football/team-builder/*',
      'https://www.ea.com/games/madden-nfl/team-builder/*'
    ]
  });

  return tabs
    .filter(tab => typeof tab.id === 'number')
    .map(tab => ({
      tabId: tab.id,
      pageKey: getTeamBuilderPageKey(tab.url || ''),
      pageUrl: tab.url || '',
      title: tab.title || '',
      active: Boolean(tab.active),
      highlighted: Boolean(tab.highlighted),
      lastAccessed: Number(tab.lastAccessed) || 0
    }))
    .filter(tab => tab.pageKey);
}

async function getCleanPages() {
  const [pages, liveTabs] = await Promise.all([readPages(), getLiveTeamBuilderTabs()]);
  const liveIds = new Set(liveTabs.map(tab => String(tab.tabId)));
  const cleaned = Object.fromEntries(
    Object.entries(pages).filter(([tabId, page]) => liveIds.has(tabId) && page?.pageKey)
  );

  if (Object.keys(cleaned).length !== Object.keys(pages).length) {
    await writePages(cleaned);
  }

  return { pages: cleaned, liveTabs };
}

async function getSortedUrlsForActivePage() {
  const [urls, liveData] = await Promise.all([readUrls(), getCleanPages()]);
  const { pages, liveTabs } = liveData;
  const liveMap = new Map(liveTabs.map(tab => [String(tab.tabId), tab]));

  const activePage = liveTabs.find(tab => tab.active)
    || Object.values(pages)
      .filter(page => page?.pageKey && liveMap.has(String(page.tabId)))
      .sort((a, b) => {
        const aScore = (a.visible ? 2 : 0) + (a.focused ? 1 : 0);
        const bScore = (b.visible ? 2 : 0) + (b.focused ? 1 : 0);
        if (bScore !== aScore) return bScore - aScore;
        const aLast = liveMap.get(String(a.tabId))?.lastAccessed || 0;
        const bLast = liveMap.get(String(b.tabId))?.lastAccessed || 0;
        if (bLast !== aLast) return bLast - aLast;
        return (b.seenAt || 0) - (a.seenAt || 0);
      })[0]
    || liveTabs.sort((a, b) => {
      if (b.lastAccessed !== a.lastAccessed) return b.lastAccessed - a.lastAccessed;
      return Number(b.tabId) - Number(a.tabId);
    })[0]
    || null;

  const sorted = [...urls].sort((a, b) => {
    const aMatch = activePage?.pageKey && (a.pageKey === activePage.pageKey || a.assetKey?.endsWith(`/${activePage.pageKey}`));
    const bMatch = activePage?.pageKey && (b.pageKey === activePage.pageKey || b.assetKey?.endsWith(`/${activePage.pageKey}`));
    if (aMatch !== bMatch) return aMatch ? -1 : 1;
    return (b.seenAt || 0) - (a.seenAt || 0);
  });

  return { urls: sorted, activePage };
}

function toBase64Utf8(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function findMockForUrl(mocks, url) {
  if (!url || !mocks) return null;
  if (mocks[url]) return mocks[url];
  const cleanUrl = url.split('#')[0].split('?')[0];
  if (mocks[cleanUrl]) return mocks[cleanUrl];
  const assetKey = getTeamBuilderAssetKey(cleanUrl);
  if (!assetKey) return null;
  return Object.values(mocks).find(mock => mock?.assetKey === assetKey) || null;
}

async function findTeamBuilderTabId() {
  const liveTabs = await getLiveTeamBuilderTabs();
  const activeTab = liveTabs.find(tab => tab.active)
    || liveTabs.sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
  if (typeof activeTab?.tabId === 'number') return activeTab.tabId;

  const { activePage } = await getSortedUrlsForActivePage();
  return typeof activePage?.tabId === 'number' ? activePage.tabId : null;
}

async function forceActiveTeamBuilderScan() {
  const tabId = await findTeamBuilderTabId();
  if (typeof tabId !== 'number') return null;

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'TB_FORCE_SCAN' });
  } catch {}

  await new Promise(resolve => setTimeout(resolve, 180));
  return tabId;
}

async function enableNetworkMocking() {
  const tabId = await findTeamBuilderTabId();
  if (typeof tabId !== 'number') {
    throw new Error('No open EA Team Builder tab was found for network-level mocking.');
  }

  const target = { tabId };
  if (!attachedDebuggerTabs.has(tabId)) {
    try {
      await chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION);
      attachedDebuggerTabs.add(tabId);
    } catch (error) {
      if (!/Another debugger is already attached/i.test(error?.message || '')) throw error;
      attachedDebuggerTabs.add(tabId);
    }
  }

  await chrome.debugger.sendCommand(target, 'Fetch.enable', {
    patterns: [{
      urlPattern: DEBUGGER_URL_PATTERN,
      requestStage: 'Request'
    }]
  });

  await writeStatus({
    networkMocking: {
      enabled: true,
      tabId,
      enabledAt: Date.now()
    }
  });

  return { tabId };
}

async function disableNetworkMocking() {
  const tabIds = [...attachedDebuggerTabs];
  await Promise.all(tabIds.map(async tabId => {
    const target = { tabId };
    try {
      await chrome.debugger.sendCommand(target, 'Fetch.disable');
    } catch {}
    try {
      await chrome.debugger.detach(target);
    } catch {}
    attachedDebuggerTabs.delete(tabId);
  }));
  await writeStatus({ networkMocking: { enabled: false, disabledAt: Date.now() } });
}

chrome.debugger.onDetach.addListener(source => {
  if (typeof source?.tabId === 'number') {
    attachedDebuggerTabs.delete(source.tabId);
    writeStatus({ networkMocking: { enabled: false, detachedTabId: source.tabId, detachedAt: Date.now() } }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  Promise.resolve()
    .then(async () => {
      const pages = await readPages();
      if (pages[String(tabId)]) {
        delete pages[String(tabId)];
        await writePages(pages);
      }
    })
    .catch(() => {});
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== 'Fetch.requestPaused') return;

  Promise.resolve()
    .then(async () => {
      const url = params?.request?.url || '';
      const mocks = await readMocks();
      const mock = findMockForUrl(mocks, url);
      if (!mock) {
        await chrome.debugger.sendCommand(source, 'Fetch.continueRequest', {
          requestId: params.requestId
        });
        return;
      }

      await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responsePhrase: 'OK',
        responseHeaders: [
          { name: 'content-type', value: 'application/json; charset=utf-8' },
          { name: 'cache-control', value: 'public, max-age=31536000' },
          { name: 'access-control-allow-origin', value: '*' },
          { name: 'x-cfb-json-editor-helper', value: 'debugger' }
        ],
        body: toBase64Utf8(mock.text)
      });

      await writeStatus({
        lastMockHit: {
          url,
          assetKey: getTeamBuilderAssetKey(url),
          teamName: mock.teamName || '',
          source: 'debugger-fetch',
          pageUrl: '',
          usedAt: Date.now()
        },
        networkMocking: {
          enabled: true,
          tabId: source.tabId,
          lastFulfilledUrl: url,
          lastFulfilledAt: Date.now()
        }
      });

      // Chrome shows a visible debugger banner while attached. Detach after the
      // Team Builder JSON is fulfilled so the banner does not linger.
      setTimeout(() => {
        disableNetworkMocking().catch(() => {});
      }, 250);
    })
    .catch(async error => {
      try {
        await chrome.debugger.sendCommand(source, 'Fetch.failRequest', {
          requestId: params.requestId,
          errorReason: 'Failed'
        });
      } catch {}
      await rememberRequestLog({
        url: params?.request?.url || '',
        method: params?.request?.method || 'GET',
        source: 'debugger-fetch',
        status: 0,
        ok: false,
        preview: error?.message || ''
      });
    });
});

// Shared by chrome.runtime.onMessage (pages bundled in this same extension, e.g.
// the local editor.html) and chrome.runtime.onMessageExternal (json-editor-8e455.web.app,
// localhost dev). Returns null if the message type isn't one of these, so the caller
// can fall through to its own default handling.
function handleEditorRequest(message, sender, sendResponse) {
  if (message?.type === 'TB_GET_URLS') {
    forceActiveTeamBuilderScan()
      .then(() => getSortedUrlsForActivePage())
      .then(({ urls, activePage }) => sendResponse({ ok: true, urls, activePage }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'TB_CLEAR_URLS') {
    writeUrls([])
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'TB_GET_MOCKS') {
    readMocks()
      .then(mocks => sendResponse({ ok: true, mocks }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'TB_GET_STATUS') {
    Promise.resolve()
      .then(() => forceActiveTeamBuilderScan())
      .then(() => Promise.all([getSortedUrlsForActivePage(), readMocks(), readStatus()]))
      .then(([urlData, mocks, status]) => sendResponse({
        ok: true,
        helperVersion: chrome.runtime.getManifest().version,
        urls: urlData.urls,
        activePage: urlData.activePage,
        mocks,
        status
      }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'TB_SET_MOCK') {
    const { url, text, teamName } = message;
    if (!isTeamBuilderJsonUrl(url)) {
      sendResponse({ ok: false, error: 'Not a Team Builder nonce-primary JSON URL.' });
      return false;
    }

    try {
      JSON.parse(text);
    } catch (error) {
      sendResponse({ ok: false, error: `Edited payload is not valid JSON: ${error.message}` });
      return false;
    }

    Promise.resolve()
      .then(async () => {
        const assetKey = getTeamBuilderAssetKey(url);
        const mock = {
          url,
          assetKey,
          text,
          teamName: teamName || '',
          updatedAt: Date.now()
        };
        // Keep one active mock. This prevents stale team payloads and clears old oversized entries.
        await writeMocks({ [url]: mock });
        const networkMocking = await enableNetworkMocking();
        sendResponse({ ok: true, mock, networkMocking });
      })
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'TB_CLEAR_MOCK') {
    const { url } = message;
    readMocks()
      .then(async mocks => {
        const assetKey = getTeamBuilderAssetKey(url);
        if (url) delete mocks[url];
        if (assetKey) {
          Object.keys(mocks).forEach(key => {
            if (mocks[key]?.assetKey === assetKey) delete mocks[key];
          });
        }
        await writeMocks(mocks);
        await disableNetworkMocking();
        sendResponse({ ok: true });
      })
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'TB_FETCH_JSON') {
    const url = message.url;
    if (!isTeamBuilderJsonUrl(url)) {
      sendResponse({ ok: false, error: 'Not a Team Builder nonce-primary JSON URL.' });
      return false;
    }

    fetch(url, { cache: 'no-store' })
      .then(async response => {
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        sendResponse({ ok: true, text });
      })
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TB_JSON_URL_FOUND') {
    rememberUrl(message.payload);
    return false;
  }

  if (message?.type === 'TB_PAGE_STATE') {
    rememberPageState(message.payload, sender);
    return false;
  }

  if (message?.type === 'TB_MOCK_USED') {
    writeStatus({
      lastMockHit: {
        url: message.url || '',
        assetKey: getTeamBuilderAssetKey(message.url || ''),
        teamName: message.teamName || '',
        source: message.source || 'unknown',
        pageUrl: sender?.tab?.url || '',
        usedAt: Date.now()
      }
    }).catch(() => {});
    return false;
  }

  if (message?.type === 'TB_REQUEST_LOG') {
    rememberRequestLog(message.entry).catch(() => {});
    return false;
  }

  // Editor-facing types (used by the bundled editor.html page, opened from the
  // toolbar icon) share the exact same logic as the external-facing API below.
  const handled = handleEditorRequest(message, sender, sendResponse);
  if (handled !== null) return handled;

  return false;
});

chrome.action?.onClicked?.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const handled = handleEditorRequest(message, sender, sendResponse);
  if (handled !== null) return handled;

  sendResponse({ ok: false, error: 'Unknown message type.' });
  return false;
});
