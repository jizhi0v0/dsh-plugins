window.__ModuleLoader__.load({
  id: 'dsh-deepseek-balance',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const NS = 'deepseek-balance';
    const BASE = '/dsh-deepseek-balance';
    const REFRESH_KEY = 'dsh-deepseek-balance.refreshMs';
    const DEFAULT_REFRESH_MS = 60_000;
    const REFRESH_OPTIONS = [
      { ms: 30_000, key: 'interval.30s' },
      { ms: 60_000, key: 'interval.1m' },
      { ms: 300_000, key: 'interval.5m' },
      { ms: 900_000, key: 'interval.15m' },
      { ms: 0, key: 'interval.off' },
    ];

    const zh = {
      title: 'DeepSeek 官方 API 余额',
      subtitle: '账户余额与可用状态',
      'status.available': 'API 可用',
      'status.unavailable': 'API 不可用',
      'status.loading': '正在读取…',
      'status.unconfigured': '未配置 API Key',
      'status.error': '读取失败',
      updatedAt: '更新于',
      granted: '赠金',
      toppedUp: '充值',
      refresh: '刷新',
      settings: '设置',
      hideSettings: '收起设置',
      close: '关闭',
      apiKey: 'API Key',
      apiKeyPlaceholder: 'sk-...',
      currentKey: '当前：',
      save: '保存',
      saving: '保存中…',
      clear: '清除',
      clearing: '清除中…',
      show: '显示',
      hide: '隐藏',
      refreshInterval: '自动刷新',
      'interval.30s': '每 30 秒',
      'interval.1m': '每分钟',
      'interval.5m': '每 5 分钟',
      'interval.15m': '每 15 分钟',
      'interval.off': '关闭',
      getKey: '获取 API Key',
      'empty.balances': '暂无余额信息',
      footer: '数据来自 api.deepseek.com；密钥仅保存在 DSH 主机。',
      'notice.saved': '已保存',
      'notice.cleared': '已清除',
      'notice.savedWithError': '已保存，但余额读取失败',
      'error.no-key': '请先填写 DeepSeek API Key',
      'error.invalid-key': 'API Key 无效或已过期',
      'error.rate-limited': '请求过于频繁，请稍后再试',
      'error.network': '无法连接 api.deepseek.com',
      'error.timeout': '请求超时',
      'error.http': 'DeepSeek API 返回错误',
      'error.invalid-response': 'API 返回数据格式异常',
      'error.unavailable': '插件后端未挂载，请重启 DSH 后再试',
      'error.unauthorized': '登录已失效，请刷新页面',
      'error.forbidden': '请求被拒绝',
      'error.invalid-key-format': 'API Key 格式不正确',
      'error.invalid-body': '请求参数无效',
      'error.method-not-allowed': '请求方式不支持',
      'error.internal': '插件内部错误',
      'error.unsupported': '当前环境不支持网络请求',
      'error.unknown': '读取失败',
    };

    const en = {
      title: 'DeepSeek API Balance',
      subtitle: 'Account balance and availability',
      'status.available': 'API available',
      'status.unavailable': 'API unavailable',
      'status.loading': 'Loading…',
      'status.unconfigured': 'API key not set',
      'status.error': 'Could not load',
      updatedAt: 'Updated',
      granted: 'Granted',
      toppedUp: 'Topped up',
      refresh: 'Refresh',
      settings: 'Settings',
      hideSettings: 'Hide settings',
      close: 'Close',
      apiKey: 'API key',
      apiKeyPlaceholder: 'sk-...',
      currentKey: 'Current: ',
      save: 'Save',
      saving: 'Saving…',
      clear: 'Clear',
      clearing: 'Clearing…',
      show: 'Show',
      hide: 'Hide',
      refreshInterval: 'Auto refresh',
      'interval.30s': 'Every 30 seconds',
      'interval.1m': 'Every minute',
      'interval.5m': 'Every 5 minutes',
      'interval.15m': 'Every 15 minutes',
      'interval.off': 'Off',
      getKey: 'Get an API key',
      'empty.balances': 'No balance information returned',
      footer: 'Data from api.deepseek.com; the key stays on the DSH host.',
      'notice.saved': 'Saved',
      'notice.cleared': 'Cleared',
      'notice.savedWithError': 'Saved, but the balance could not be read',
      'error.no-key': 'Add a DeepSeek API key first',
      'error.invalid-key': 'The API key is invalid or expired',
      'error.rate-limited': 'Too many requests; try again later',
      'error.network': 'Could not reach api.deepseek.com',
      'error.timeout': 'The request timed out',
      'error.http': 'The DeepSeek API returned an error',
      'error.invalid-response': 'The API returned an unexpected response',
      'error.unavailable': 'The plugin host route is not mounted; restart DSH',
      'error.unauthorized': 'Sign-in expired; reload the page',
      'error.forbidden': 'The request was refused',
      'error.invalid-key-format': 'The API key format is invalid',
      'error.invalid-body': 'The request parameters are invalid',
      'error.method-not-allowed': 'The request method is not supported',
      'error.internal': 'Internal plugin error',
      'error.unsupported': 'This host does not support network requests',
      'error.unknown': 'Could not load',
    };

    const CSS = `
.dsb-root{position:relative;display:flex;flex-direction:column;align-items:flex-end;gap:6px;padding:4px 0 0;font-family:inherit;line-height:1.4}
.dsb-bar{display:flex;align-items:center;gap:2px}
.dsb-pill{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease}
.dsb-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsb-pill:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsb-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption);flex:none}
.dsb-dot.ok{background:var(--dsw-alias-state-success-primary)}
.dsb-dot.bad{background:var(--dsw-alias-state-error-primary)}
.dsb-name{color:var(--dsw-alias-label-tertiary)}
.dsb-value{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}
.dsb-icon{width:26px;height:26px;display:grid;place-items:center;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}
.dsb-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsb-icon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsb-icon:disabled{opacity:.45;cursor:default}
.dsb-popover{position:absolute;right:0;z-index:30;width:min(340px,calc(100vw - 32px));max-width:100%;isolation:isolate}
.dsb-popover.dsb-up{bottom:calc(100% + 8px)}
.dsb-popover.dsb-down{top:calc(100% + 8px)}
.dsb-popover::after{content:"";position:absolute;right:14px;width:12px;height:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base)));border:1px solid var(--dsw-alias-border-l1);transform:rotate(45deg);pointer-events:none;z-index:-1}
.dsb-popover.dsb-up::after{bottom:-7px;border-top:0;border-left:0}
.dsb-popover.dsb-down::after{top:-7px;border-right:0;border-bottom:0}
.dsb-card{box-sizing:border-box;width:100%;overflow:auto;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base)));border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-elevation-panel,0 8px 28px rgba(0,0,0,.14));padding:12px;color:var(--dsw-alias-label-primary)}
.dsb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.dsb-titleWrap{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsb-title{font-size:13px;font-weight:600}
.dsb-subtitle{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsb-close{width:24px;height:24px;display:grid;place-items:center;flex:none;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;cursor:pointer;padding:0}
.dsb-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsb-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsb-statusRow{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsb-muted{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;padding-left:8px}
.dsb-error{margin-top:8px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));border-left:3px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45;overflow-wrap:anywhere}
.dsb-empty{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsb-balances{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.dsb-balanceRow{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-base)}
.dsb-balanceMain{display:flex;align-items:baseline;gap:8px}
.dsb-currency{font-size:10px;color:var(--dsw-alias-label-tertiary);letter-spacing:.04em}
.dsb-amount{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}
.dsb-breakdown{display:flex;gap:12px;margin-top:4px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex-wrap:wrap}
.dsb-actions{display:flex;align-items:center;gap:6px;margin-top:10px;flex-wrap:wrap}
.dsb-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-family:inherit;cursor:pointer;white-space:nowrap;flex:none}
.dsb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsb-btn:disabled{opacity:.45;cursor:default}
.dsb-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsb-btnPrimary{background:var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary));border-color:transparent;color:#fff;font-weight:500}
.dsb-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--dsw-alias-button-info-fill,var(--dsw-alias-state-business-primary)));color:#fff}
.dsb-btnGhost{border-color:transparent}
.dsb-settings{margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:6px}
.dsb-label{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);margin-top:2px}
.dsb-hint{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dsb-keyRow{display:flex;gap:4px;align-items:center}
.dsb-input{box-sizing:border-box;width:100%;min-width:0;height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;padding:0 8px;outline:none}
.dsb-input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsb-link{display:inline-flex;align-items:center;gap:4px;margin-top:2px;font-size:11px;color:var(--dsw-alias-state-business-primary);text-decoration:none}
.dsb-link:hover{text-decoration:underline}
.dsb-notice{margin-top:8px;font-size:11px;color:var(--dsw-alias-state-success-primary)}
.dsb-noticeError{color:var(--dsw-alias-state-error-primary)}
.dsb-foot{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:1.4}
.dsb-spin{animation:dsb-spin 1s linear infinite}
@keyframes dsb-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.dsb-spin{animation:none}}
`;

    function readRefreshMs() {
      try {
        const raw = localStorage.getItem(REFRESH_KEY);
        if (raw !== null) {
          const value = Number(raw);
          if (REFRESH_OPTIONS.some((option) => option.ms === value)) return value;
        }
      } catch {
        /* storage can be unavailable in private or embedded contexts */
      }
      return DEFAULT_REFRESH_MS;
    }

    function formatMoney(value, currency) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'CNY';
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: code,
          currencyDisplay: 'narrowSymbol',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value);
      } catch {
        return `${code} ${value.toFixed(2)}`;
      }
    }

    function formatTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
      try {
        return new Date(ms).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      } catch {
        return new Date(ms).toISOString();
      }
    }

    function errorText(t, error) {
      if (!error) return '';
      const code = typeof error.code === 'string' ? error.code : 'unknown';
      const key = `error.${code}`;
      const text = t(key);
      if (text !== key) {
        if (code === 'http') {
          const match = typeof error.message === 'string' ? /HTTP\s+(\d+)/i.exec(error.message) : null;
          return match ? `${text} (HTTP ${match[1]})` : text;
        }
        return text;
      }
      return typeof error.message === 'string' && error.message !== ''
        ? error.message
        : t('error.unknown');
    }

    class ClientError extends Error {
      constructor(code, message) {
        super(message);
        this.name = 'ClientError';
        this.code = code;
      }
    }

    async function readJsonResponse(response) {
      const type = response.headers.get('content-type') || '';
      if (!type.includes('application/json')) return null;
      try {
        return await response.json();
      } catch {
        return null;
      }
    }

    async function requestState(force) {
      let response;
      try {
        response = await fetch(`${BASE}/state${force ? '?refresh=1' : ''}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
      } catch {
        throw new ClientError('network', 'Could not reach the plugin host.');
      }
      if (response.status === 401) throw new ClientError('unauthorized', 'Authentication required.');
      if (response.status === 403) throw new ClientError('forbidden', 'Request refused.');
      if (response.status === 404) {
        throw new ClientError('unavailable', 'The plugin host route is not available.');
      }
      const body = await readJsonResponse(response);
      if (!response.ok) {
        throw new ClientError(
          body?.error?.code || 'http',
          body?.error?.message || `HTTP ${response.status}`,
        );
      }
      if (!body || typeof body !== 'object') {
        throw new ClientError('unavailable', 'The plugin host route is not available.');
      }
      return body;
    }

    async function requestSaveKey(apiKey) {
      let response;
      try {
        response = await fetch(`${BASE}/key`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ apiKey }),
        });
      } catch {
        throw new ClientError('network', 'Could not reach the plugin host.');
      }
      if (response.status === 401) throw new ClientError('unauthorized', 'Authentication required.');
      if (response.status === 403) throw new ClientError('forbidden', 'Request refused.');
      if (response.status === 404) {
        throw new ClientError('unavailable', 'The plugin host route is not available.');
      }
      const body = await readJsonResponse(response);
      if (!response.ok) {
        throw new ClientError(
          body?.error?.code || 'http',
          body?.error?.message || `HTTP ${response.status}`,
        );
      }
      if (!body || typeof body !== 'object') {
        throw new ClientError('unavailable', 'The plugin host route is not available.');
      }
      return body;
    }

    function RefreshIcon({ spinning }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          'aria-hidden': true,
          focusable: 'false',
          className: spinning ? 'dsb-spin' : undefined,
        },
        h('path', {
          d: 'M13.2 6.2A5.6 5.6 0 1 0 13.4 9.4M13.2 6.2V2.9M13.2 6.2H9.9',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function GearIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: 'false' },
        h('circle', {
          cx: 8,
          cy: 8,
          r: 2.1,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
        }),
        h('path', {
          d: 'M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      );
    }

    function KeyIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: 'false' },
        h('circle', {
          cx: 5,
          cy: 8,
          r: 2.4,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
        }),
        h('path', {
          d: 'M7.4 8H14M11.4 8v2.1M13 8v1.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      );
    }

    function ExternalIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 11, height: 11, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M9.5 2.5H13.5V6.5M13.5 2.5L7.8 8.2M6.2 3.2H3.2V12.8H12.8V9.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function BalanceWidget({ translate: t }) {
      const [state, setState] = useState({ phase: 'loading', data: null, error: null });
      const [open, setOpen] = useState(false);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [keyDraft, setKeyDraft] = useState('');
      const [showKey, setShowKey] = useState(false);
      const [busyAction, setBusyAction] = useState(null);
      const busy = busyAction !== null;
      const [notice, setNotice] = useState(null);
      const [refreshMs, setRefreshMs] = useState(readRefreshMs);
      const alive = useRef(true);
      const inFlight = useRef(false);
      const noticeTimer = useRef(null);
      const rootRef = useRef(null);
      const [popover, setPopover] = useState({ placement: 'down', maxHeight: 460 });

      /** Pick the side with more room so a bottom composer opens upward. */
      const updatePopover = useCallback(() => {
        const element = rootRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const viewport = window.innerHeight || document.documentElement.clientHeight || 800;
        const placement = rect.top > viewport / 2 ? 'up' : 'down';
        const available = placement === 'up' ? rect.top - 16 : viewport - rect.bottom - 16;
        setPopover({
          placement,
          maxHeight: Math.max(220, Math.min(460, available)),
        });
      }, []);

      useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
          if (noticeTimer.current) clearTimeout(noticeTimer.current);
        };
      }, []);

      const load = useCallback(async (force) => {
        if (inFlight.current) return;
        inFlight.current = true;
        try {
          const data = await requestState(force);
          if (!alive.current) return;
          setState({
            phase: data.configured ? 'ready' : 'unconfigured',
            data,
            error: data.error || null,
          });
        } catch (error) {
          if (!alive.current) return;
          setState((previous) => ({
            phase: error.code === 'unavailable' ? 'unavailable' : 'error',
            data: previous.data,
            error: {
              code: error.code || 'unknown',
              message: error.message || '',
            },
          }));
        } finally {
          inFlight.current = false;
        }
      }, []);

      useEffect(() => {
        load(false);
      }, [load]);

      useEffect(() => {
        if (!refreshMs) return undefined;
        const timer = setInterval(() => load(true), refreshMs);
        return () => clearInterval(timer);
      }, [refreshMs, load]);

      useEffect(() => {
        const onVisible = () => {
          if (document.visibilityState === 'visible') load(false);
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
      }, [load]);

      useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            setSettingsOpen(false);
          }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [open]);

      useEffect(() => {
        if (!open) return undefined;
        updatePopover();
        const onResize = () => updatePopover();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, [open, updatePopover]);

      useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) {
            setOpen(false);
            setSettingsOpen(false);
          }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
      }, [open]);

      const data = state.data;
      const configured = data?.configured === true;
      const available = data?.isAvailable;
      const primary =
        data?.balances?.find((balance) => balance.currency === 'CNY') ||
        data?.balances?.[0] ||
        null;
      const hasError = Boolean(state.error && state.error.code !== 'no-key');
      const dotClass =
        state.phase === 'loading' && !data
          ? 'idle'
          : state.phase === 'unavailable'
            ? 'bad'
            : state.phase === 'error' && !data
              ? 'bad'
              : !configured
                ? 'idle'
                : hasError || available === false
                  ? 'bad'
                  : 'ok';
      const statusKey =
        state.phase === 'loading'
          ? 'status.loading'
          : state.phase === 'unavailable'
            ? 'status.unavailable'
            : state.phase === 'error' && !data
              ? 'status.error'
              : !configured
                ? 'status.unconfigured'
                : hasError
                  ? 'status.error'
                  : available === false
                    ? 'status.unavailable'
                    : 'status.available';
      const mainText =
        state.phase === 'loading' && !data
          ? t('status.loading')
          : state.phase === 'unavailable'
            ? t('status.unavailable')
            : state.phase === 'error' && !data
              ? t('status.error')
              : !configured
                ? t('status.unconfigured')
                : hasError
                  ? t('status.error')
                  : primary
                    ? formatMoney(primary.total, primary.currency)
                    : t('status.available');

      function flash(message, tone = 'success') {
        setNotice({ text: message, tone });
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => {
          if (alive.current) setNotice(null);
        }, 3000);
      }

      function openCard(settings) {
        updatePopover();
        setOpen(true);
        if (settings || state.phase === 'unconfigured') setSettingsOpen(true);
      }

      async function refresh() {
        if (busy) return;
        setBusyAction('refresh');
        try {
          await load(true);
        } finally {
          if (alive.current) setBusyAction(null);
        }
      }

      async function saveKey() {
        const key = keyDraft.trim();
        if (key === '' || busy) return;
        setBusyAction('save');
        try {
          const next = await requestSaveKey(key);
          if (!alive.current) return;
          setState({
            phase: next.configured ? 'ready' : 'unconfigured',
            data: next,
            error: next.error || null,
          });
          setKeyDraft('');
          setShowKey(false);
          flash(
            next.ok ? t('notice.saved') : t('notice.savedWithError'),
            next.ok ? 'success' : 'error',
          );
        } catch (error) {
          flash(errorText(t, { code: error.code, message: error.message }), 'error');
        } finally {
          if (alive.current) setBusyAction(null);
        }
      }

      async function clearKey() {
        if (busy) return;
        setBusyAction('clear');
        try {
          const next = await requestSaveKey('');
          if (!alive.current) return;
          setState({ phase: 'unconfigured', data: next, error: next.error || null });
          setKeyDraft('');
          setShowKey(false);
          flash(t('notice.cleared'));
        } catch (error) {
          flash(errorText(t, { code: error.code, message: error.message }), 'error');
        } finally {
          if (alive.current) setBusyAction(null);
        }
      }

      function changeRefresh(value) {
        const ms = Number(value);
        setRefreshMs(ms);
        try {
          localStorage.setItem(REFRESH_KEY, String(ms));
        } catch {
          /* storage can be unavailable in private or embedded contexts */
        }
      }

      return h(
        'div',
        { className: 'dsb-root', ref: rootRef },
        h('style', { key: 'style' }, CSS),
        h(
          'div',
          { className: 'dsb-bar', key: 'bar' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsb-pill',
              'aria-expanded': open,
              'aria-controls': 'dsb-card',
              title: `${t('title')} — ${t(statusKey)}`,
              onClick: () => {
                if (open) {
                  setOpen(false);
                  setSettingsOpen(false);
                } else {
                  openCard(false);
                }
              },
            },
            h('span', { className: `dsb-dot ${dotClass}`, 'aria-hidden': true }),
            h('span', { className: 'dsb-name' }, 'DeepSeek'),
            h('span', { className: 'dsb-value' }, mainText),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsb-icon',
              'aria-label': t('refresh'),
              title: t('refresh'),
              onClick: refresh,
              disabled: busy,
            },
            h(RefreshIcon, { spinning: busyAction === 'refresh' }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsb-icon',
              'aria-label': t('settings'),
              title: t('settings'),
              onClick: () => openCard(true),
            },
            h(GearIcon),
          ),
        ),
        open
          ? h(
              'div',
              {
                key: 'popover',
                className: `dsb-popover dsb-${popover.placement}`,
              },
              h(
                'div',
                {
                  id: 'dsb-card',
                  className: 'dsb-card',
                  style: { maxHeight: popover.maxHeight },
                  role: 'region',
                  'aria-label': t('title'),
                },
              h(
                'div',
                { className: 'dsb-head' },
                h(
                  'div',
                  { className: 'dsb-titleWrap' },
                  h('span', { className: 'dsb-title' }, t('title')),
                  h('span', { className: 'dsb-subtitle' }, t('subtitle')),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsb-close',
                    'aria-label': t('close'),
                    title: t('close'),
                    onClick: () => {
                      setOpen(false);
                      setSettingsOpen(false);
                    },
                  },
                  '×',
                ),
              ),
              h(
                'div',
                { className: 'dsb-statusRow' },
                h('span', { className: `dsb-dot ${dotClass}`, 'aria-hidden': true }),
                h('span', { className: 'dsb-statusText' }, t(statusKey)),
                data?.updatedAt
                  ? h(
                      'span',
                      { className: 'dsb-muted' },
                      `${t('updatedAt')} ${formatTime(data.updatedAt)}`,
                    )
                  : null,
              ),
              hasError
                ? h('div', { className: 'dsb-error', role: 'alert' }, errorText(t, state.error))
                : null,
              data?.balances?.length
                ? h(
                    'div',
                    { className: 'dsb-balances' },
                    data.balances.map((balance, index) =>
                      h(
                        'div',
                        {
                          className: 'dsb-balanceRow',
                          key: `${balance.currency}-${index}`,
                        },
                        h(
                          'div',
                          { className: 'dsb-balanceMain' },
                          h('span', { className: 'dsb-currency' }, balance.currency),
                          h(
                            'strong',
                            { className: 'dsb-amount' },
                            formatMoney(balance.total, balance.currency),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'dsb-breakdown' },
                          h(
                            'span',
                            null,
                            `${t('granted')} ${formatMoney(balance.granted, balance.currency)}`,
                          ),
                          h(
                            'span',
                            null,
                            `${t('toppedUp')} ${formatMoney(balance.toppedUp, balance.currency)}`,
                          ),
                        ),
                      ),
                    ),
                  )
                : configured && !hasError
                  ? h('div', { className: 'dsb-empty' }, t('empty.balances'))
                  : null,
              h(
                'div',
                { className: 'dsb-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsb-btn',
                    onClick: refresh,
                    disabled: busy,
                  },
                  h(RefreshIcon, { spinning: busyAction === 'refresh' }),
                  t('refresh'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsb-btn',
                    'aria-expanded': settingsOpen,
                    onClick: () => setSettingsOpen((previous) => !previous),
                  },
                  h(KeyIcon),
                  settingsOpen ? t('hideSettings') : t('settings'),
                ),
              ),
              settingsOpen
                ? h(
                    'div',
                    { className: 'dsb-settings' },
                    h('label', { className: 'dsb-label', htmlFor: 'dsb-key-input' }, t('apiKey')),
                    configured && data?.keyHint
                      ? h(
                          'div',
                          { className: 'dsb-hint' },
                          `${t('currentKey')}${data.keyHint}`,
                        )
                      : null,
                    h(
                      'div',
                      { className: 'dsb-keyRow' },
                      h('input', {
                        id: 'dsb-key-input',
                        className: 'dsb-input',
                        type: showKey ? 'text' : 'password',
                        value: keyDraft,
                        placeholder: t('apiKeyPlaceholder'),
                        autoComplete: 'off',
                        spellCheck: false,
                        onChange: (event) => setKeyDraft(event.target.value),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            saveKey();
                          }
                        },
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsb-btn dsb-btnGhost',
                          onClick: () => setShowKey((previous) => !previous),
                          disabled: keyDraft === '',
                        },
                        showKey ? t('hide') : t('show'),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'dsb-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsb-btn dsb-btnPrimary',
                          onClick: saveKey,
                          disabled: busy || keyDraft.trim() === '',
                        },
                        busyAction === 'save' ? t('saving') : t('save'),
                      ),
                      configured
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsb-btn dsb-btnGhost',
                              onClick: clearKey,
                              disabled: busy,
                            },
                            busyAction === 'clear' ? t('clearing') : t('clear'),
                          )
                        : null,
                    ),
                    h(
                      'a',
                      {
                        className: 'dsb-link',
                        href: 'https://platform.deepseek.com/api_keys',
                        target: '_blank',
                        rel: 'noreferrer noopener',
                      },
                      t('getKey'),
                      h(ExternalIcon),
                    ),
                    h('label', { className: 'dsb-label', htmlFor: 'dsb-interval' }, t('refreshInterval')),
                    h(
                      'select',
                      {
                        id: 'dsb-interval',
                        className: 'dsb-input',
                        value: String(refreshMs),
                        onChange: (event) => changeRefresh(event.target.value),
                      },
                      REFRESH_OPTIONS.map((option) =>
                        h('option', { key: option.ms, value: String(option.ms) }, t(option.key)),
                      ),
                    ),
                  )
                : null,
              notice
                ? h(
                    'div',
                    {
                      className: `dsb-notice${notice.tone === 'error' ? ' dsb-noticeError' : ''}`,
                      role: 'status',
                    },
                    notice.text,
                  )
                : null,
                h('div', { className: 'dsb-foot' }, t('footer')),
              ),
            )
          : null,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { zh, en }),
          'deepseek-balance: dictionaries',
        );
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'deepseek-balance',
              order: 20,
              locale: NS,
            },
            () => h(BalanceWidget, { translate: t }),
          ),
        );
      },
    };
  },
});
