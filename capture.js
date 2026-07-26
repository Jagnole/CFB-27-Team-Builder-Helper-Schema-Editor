(function () {
  const pattern = /^https:\/\/cdn\.mcr\.ea\.com\/\d+\/bundles-users\/[^/]+\/[^/]+\/[^/]*nonce-primary\.json(?:[?#].*)?$/i;
  let mocks = {};

  window.__cfbJsonEditorHelper = {
    version: '0.3.0',
    mocksCount: 0,
    lastMockedUrl: ''
  };

  function toUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.href;
      if (input instanceof Request) return input.url;
      return String(input || '');
    } catch {
      return '';
    }
  }

  function report(url, source) {
    if (!pattern.test(url)) return;
    window.postMessage({ type: 'CFB_TB_JSON_URL_FOUND', url, source }, '*');
  }

  function getAssetKey(url) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/^\/(\d+)\/bundles-users\/([^/]+)\/([^/]+)\//i);
      return match ? `${match[1]}/bundles-users/${match[2]}/${match[3]}` : '';
    } catch {
      return '';
    }
  }

  function findMock(url) {
    if (!url || !mocks) return null;
    if (mocks[url]) return mocks[url];
    const cleanUrl = url.split('#')[0].split('?')[0];
    if (mocks[cleanUrl]) return mocks[cleanUrl];

    const assetKey = getAssetKey(cleanUrl);
    if (!assetKey) return null;

    return Object.values(mocks).find(mock => mock?.assetKey === assetKey) || null;
  }

  function notifyMockUsed(url, mock, source) {
    window.__cfbJsonEditorHelper.lastMockedUrl = url;
    window.postMessage({
      type: 'CFB_TB_MOCK_USED',
      url,
      teamName: mock?.teamName || '',
      source
    }, '*');
  }

  function notifyRequestLog(entry) {
    window.postMessage({
      type: 'CFB_TB_REQUEST_LOG',
      entry: {
        url: entry.url || '',
        method: entry.method || 'GET',
        source: entry.source || 'fetch',
        status: Number(entry.status) || 0,
        ok: Boolean(entry.ok),
        preview: String(entry.preview || '').slice(0, 500),
        ts: Date.now()
      }
    }, '*');
  }

  async function buildMockResponse(mock, url, realResponsePromise) {
    let init = {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=31536000',
        'x-cfb-json-editor-helper': '1'
      }
    };

    try {
      const realResponse = await realResponsePromise;
      if (realResponse) {
        init = {
          status: realResponse.status || 200,
          statusText: realResponse.statusText || 'OK',
          headers: realResponse.headers
        };
      }
    } catch {}

    const response = new Response(mock.text, {
      ...init
    });

    decorateMockResponse(response, mock, url, init);

    return response;
  }

  function decorateMockResponse(response, mock, url, init) {
    // Tweak keeps native response metadata because it mocks below the page runtime.
    // Mirror the bits most app code commonly carries into later save/submit work.
    try {
      Object.defineProperties(response, {
        url: { configurable: true, value: url },
        type: { configurable: true, value: 'cors' },
        redirected: { configurable: true, value: false },
        ok: { configurable: true, value: response.status >= 200 && response.status < 300 }
      });
    } catch {}

    try {
      Object.defineProperty(response, 'clone', {
        configurable: true,
        value: () => {
          const clone = new Response(mock.text, { ...init });
          decorateMockResponse(clone, mock, url, init);
          return clone;
        }
      });
    } catch {}
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.type === 'CFB_TB_MOCKS_UPDATE') {
      mocks = data.mocks || {};
      window.__cfbJsonEditorHelper.mocksCount = Object.keys(mocks).length;
    }
  });

  if (!window.__cfbJsonEditorFetchPatched) {
    window.__cfbJsonEditorFetchPatched = true;
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const url = toUrl(args[0]);
      report(url, 'fetch');
      const mock = findMock(url);
      if (mock) {
        notifyMockUsed(url, mock, 'fetch');
        return buildMockResponse(mock, url, originalFetch.apply(this, args));
      }
      const result = originalFetch.apply(this, args);
      result.then(async response => {
        if (response?.ok) return;
        let preview = '';
        try {
          preview = await response.clone().text();
        } catch {}
        notifyRequestLog({
          url,
          method: args[1]?.method || args[0]?.method || 'GET',
          source: 'fetch',
          status: response?.status,
          ok: response?.ok,
          preview
        });
      }).catch(error => {
        notifyRequestLog({
          url,
          method: args[1]?.method || args[0]?.method || 'GET',
          source: 'fetch',
          status: 0,
          ok: false,
          preview: error?.message || ''
        });
      });
      return result;
    };
  }

  if (!window.__cfbJsonEditorXhrPatched) {
    window.__cfbJsonEditorXhrPatched = true;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      const requestUrl = toUrl(url);
      report(requestUrl, 'xhr');
      this.__cfbJsonEditorMockUrl = requestUrl;
      this.__cfbJsonEditorMethod = method || 'GET';
      this.__cfbJsonEditorMock = findMock(requestUrl);
      if (this.__cfbJsonEditorMock) {
        this.__cfbJsonEditorAsync = rest.length ? rest[0] !== false : true;
        return;
      }
      const opened = originalOpen.call(this, method, url, ...rest);
      try {
        this.addEventListener('loadend', () => {
          if (this.status >= 200 && this.status < 400) return;
          let preview = '';
          try {
            preview = typeof this.responseText === 'string' ? this.responseText : '';
          } catch {}
          notifyRequestLog({
            url: requestUrl,
            method: this.__cfbJsonEditorMethod,
            source: 'xhr',
            status: this.status,
            ok: this.status >= 200 && this.status < 400,
            preview
          });
        });
      } catch {}
      return opened;
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const mock = this.__cfbJsonEditorMock;
      if (!mock) {
        const xhr = this;
        const url = xhr.__cfbJsonEditorMockUrl;
        const method = xhr.__cfbJsonEditorMethod || 'GET';
        const logFailure = () => {
          let status = 0;
          let preview = '';
          try { status = xhr.status || 0; } catch {}
          if (status >= 200 && status < 400) return;
          try { preview = typeof xhr.responseText === 'string' ? xhr.responseText : ''; } catch {}
          notifyRequestLog({
            url,
            method,
            source: 'xhr-send',
            status,
            ok: false,
            preview
          });
        };

        try {
          const priorLoadEnd = xhr.onloadend;
          xhr.onloadend = function (...eventArgs) {
            logFailure();
            if (typeof priorLoadEnd === 'function') {
              return priorLoadEnd.apply(this, eventArgs);
            }
          };
          const priorReadyState = xhr.onreadystatechange;
          xhr.onreadystatechange = function (...eventArgs) {
            try {
              if (xhr.readyState === 4) logFailure();
            } catch {}
            if (typeof priorReadyState === 'function') {
              return priorReadyState.apply(this, eventArgs);
            }
          };
        } catch {}

        return originalSend.apply(this, args);
      }

      const xhr = this;
      const url = xhr.__cfbJsonEditorMockUrl;
      const complete = async () => {
        notifyMockUsed(url, mock, 'xhr');

        let responseHeaders = 'content-type: application/json; charset=utf-8\r\nx-cfb-json-editor-helper: 1\r\n';
        try {
          const realResponse = await originalFetch(url, { cache: 'no-store' });
          responseHeaders = '';
          realResponse.headers.forEach((value, key) => {
            responseHeaders += `${key}: ${value}\r\n`;
          });
        } catch {}

        const responseValue = xhr.responseType === 'json'
          ? JSON.parse(mock.text)
          : mock.text;

        Object.defineProperties(xhr, {
          readyState: { configurable: true, value: 4 },
          status: { configurable: true, value: 200 },
          statusText: { configurable: true, value: 'OK' },
          responseURL: { configurable: true, value: url },
          responseText: { configurable: true, value: mock.text },
          response: { configurable: true, value: responseValue }
        });

        xhr.getResponseHeader = name => String(name || '').toLowerCase() === 'content-type'
          ? 'application/json; charset=utf-8'
          : null;
        xhr.getAllResponseHeaders = () => responseHeaders;

        xhr.onreadystatechange?.();
        xhr.dispatchEvent(new Event('readystatechange'));
        xhr.onload?.();
        xhr.dispatchEvent(new Event('load'));
        xhr.onloadend?.();
        xhr.dispatchEvent(new Event('loadend'));
      };

      if (xhr.__cfbJsonEditorAsync === false) {
        complete();
      } else {
        setTimeout(complete, 0);
      }
    };
  }
}());
