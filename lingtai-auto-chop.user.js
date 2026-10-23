// ==UserScript==
// @name         灵台自动连砍
// @namespace    https://k40.shengqainbang.cn/
// @version      1.7.1
// @description  按设定间隔点击“连砍 10 刀”，直到当前斧力归零。
// @match        https://k40.shengqainbang.cn/*
// @updateURL    https://raw.githubusercontent.com/zxl56123/lingtai-auto-chop/main/lingtai-auto-chop.user.js
// @downloadURL  https://raw.githubusercontent.com/zxl56123/lingtai-auto-chop/main/lingtai-auto-chop.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      k40.shengqainbang.cn
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'lingtai-auto-chop-panel';
  const STYLE_ID = 'lingtai-auto-chop-style';
  const INTERVAL_KEY = 'lingtai-auto-chop-interval';
  const POSITION_KEY = 'lingtai-auto-chop-position';
  const UPDATE_URL = 'https://raw.githubusercontent.com/zxl56123/lingtai-auto-chop/main/lingtai-auto-chop.user.js';
  const SCRIPT_VERSION = '1.7.1';
  const DEFAULT_INTERVAL = 1500;
  const MIN_INTERVAL = 300;
  const TARGET_PATH = /^\/lingtai(?:\/|$)/;
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  if (window.__lingtaiAutoChopLoaded) return;
  window.__lingtaiAutoChopLoaded = true;

  const state = {
    running: false,
    timer: null,
    elapsedTimer: null,
    clicks: 0,
    startedAt: 0,
    elapsedMs: 0,
    zeroMode: false,
    zeroAxeClicks: 0,
    zeroDisabledChecks: 0,
    inventoryBlocked: false,
    inventoryUsed: null,
    inventoryCap: null,
    inventoryChecking: false,
    lastAxe: null,
  };

  const getInterval = () => {
    const value = Number(pageWindow.localStorage.getItem(INTERVAL_KEY));
    return Number.isFinite(value) ? Math.max(MIN_INTERVAL, Math.round(value)) : DEFAULT_INTERVAL;
  };

  const formatNumber = (value) => Number(value).toLocaleString('zh-CN');

  function readAxe() {
    const nodes = [...document.querySelectorAll('span, p, div')];
    for (const node of nodes) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const match = text.match(/^斧力\s*([\d,]+)\s*\/\s*([\d,]+)$/);
      if (match) {
        const current = Number(match[1].replace(/,/g, ''));
        const max = Number(match[2].replace(/,/g, ''));
        if (Number.isFinite(current) && Number.isFinite(max)) return { current, max, node };
      }
    }
    return null;
  }

  function findBatchButton() {
    return [...document.querySelectorAll('button')].find((button) => {
      const text = (button.textContent || '').replace(/\s+/g, ' ').trim();
      return /连砍\s*10\s*刀/.test(text);
    }) || null;
  }

  function buttonBusy(button) {
    return !button || button.disabled || button.getAttribute('aria-disabled') === 'true';
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483647;
        width: 304px;
        box-sizing: border-box;
        padding: 15px;
        overflow: hidden;
        color: #f8f3e7;
        background: linear-gradient(145deg, rgba(49, 38, 21, .98), rgba(19, 24, 20, .98) 68%);
        border: 1px solid rgba(214, 158, 65, .46);
        border-radius: 16px;
        box-shadow: 0 16px 42px rgba(12, 10, 6, .35), inset 0 1px 0 rgba(255, 239, 190, .09);
        font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(12px);
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID}::before {
        content: "";
        position: absolute;
        top: 0;
        left: 18px;
        right: 18px;
        height: 2px;
        background: linear-gradient(90deg, transparent, #e0a84f, transparent);
        opacity: .85;
      }
      #${PANEL_ID} .lac-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; cursor: grab; user-select: none; touch-action: none; }
      #${PANEL_ID}.is-dragging .lac-head { cursor: grabbing; }
      #${PANEL_ID} .lac-icon {
        display: grid;
        width: 34px;
        height: 34px;
        place-items: center;
        color: #21170b;
        background: linear-gradient(145deg, #f0c56b, #b87923);
        border: 1px solid rgba(255, 233, 165, .65);
        border-radius: 10px;
        box-shadow: 0 5px 14px rgba(188, 123, 31, .22);
        font-size: 18px;
      }
      #${PANEL_ID} .lac-title-wrap { min-width: 0; flex: 1; }
      #${PANEL_ID} .lac-kicker { color: #d9a94e; font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
      #${PANEL_ID} .lac-title { margin: 1px 0 0; color: #fff8e8; font-size: 16px; font-weight: 750; letter-spacing: -.01em; }
      #${PANEL_ID} .lac-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #9ca3af; box-shadow: 0 0 0 4px rgba(156, 163, 175, .12); }
      #${PANEL_ID}.is-running .lac-dot { background: #8bd17c; box-shadow: 0 0 0 4px rgba(139, 209, 124, .14); animation: lac-pulse 1.8s ease-in-out infinite; }
      #${PANEL_ID}.is-done .lac-dot { background: #e0a84f; box-shadow: 0 0 0 4px rgba(224, 168, 79, .14); }
      @keyframes lac-pulse { 50% { opacity: .45; transform: scale(.8); } }
      #${PANEL_ID} .lac-row { display: flex; align-items: center; gap: 9px; margin: 0 0 12px; }
      #${PANEL_ID} .lac-row label { flex: 1; color: #d7cfbf; font-weight: 600; }
      #${PANEL_ID} .lac-field { display: flex; align-items: center; gap: 7px; padding: 3px 8px 3px 10px; background: rgba(9, 13, 11, .62); border: 1px solid rgba(210, 170, 97, .3); border-radius: 9px; }
      #${PANEL_ID} input {
        width: 68px;
        padding: 4px 0;
        color: #fff7e6;
        background: transparent;
        border: 0;
        outline: none;
        text-align: right;
        font: inherit;
        font-variant-numeric: tabular-nums;
      }
      #${PANEL_ID} input:focus { color: #f3c56d; }
      #${PANEL_ID} .lac-unit { color: #a89b84; font-size: 11px; }
      #${PANEL_ID} .lac-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 12px; }
      #${PANEL_ID} .lac-stat { padding: 9px 10px; background: rgba(7, 12, 9, .38); border: 1px solid rgba(210, 170, 97, .18); border-radius: 10px; }
      #${PANEL_ID} .lac-stat-label { color: #a89b84; font-size: 10px; }
      #${PANEL_ID} .lac-stat-value { margin-top: 2px; color: #fff3d2; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
      #${PANEL_ID} .lac-actions { display: flex; gap: 8px; margin-top: 0; }
      #${PANEL_ID} #lac-update {
        display: grid;
        place-items: center;
        flex: 0 0 32px;
        width: 32px;
        height: 32px;
        margin: 0 0 0 3px;
        padding: 0;
        color: #d9c8a5;
        background: rgba(95, 83, 63, .2);
        border: 1px solid rgba(210, 170, 97, .24);
        border-radius: 8px;
        font-size: 11px;
        font-weight: 600;
      }
      #${PANEL_ID} #lac-update:hover { color: #fff3d2; background: rgba(174, 111, 28, .2); }
      #${PANEL_ID} #lac-update:disabled { cursor: wait; opacity: .62; transform: none; filter: none; }
      #${PANEL_ID} #lac-update svg { display: block; width: 17px; height: 17px; }
      #${PANEL_ID} #lac-update:disabled svg { animation: lac-update-spin 1s linear infinite; }
      @keyframes lac-update-spin { to { transform: rotate(360deg); } }
      #${PANEL_ID} button {
        flex: 1;
        padding: 8px 10px;
        color: #fff8e8;
        border: 0;
        border-radius: 9px;
        cursor: pointer;
        font: inherit;
        font-weight: 600;
        transition: transform .16s ease, filter .16s ease, background .16s ease;
      }
      #${PANEL_ID} button:hover { filter: brightness(1.08); transform: translateY(-1px); }
      #${PANEL_ID} button:active { transform: translateY(0); }
      #${PANEL_ID} button:focus-visible { outline: 2px solid #f2c86e; outline-offset: 2px; }
      #${PANEL_ID} #lac-start { background: linear-gradient(135deg, #d89b3c, #a96a1f); box-shadow: 0 5px 14px rgba(174, 111, 28, .2); }
      #${PANEL_ID} #lac-stop { color: #d7cfbf; background: rgba(95, 83, 63, .42); border: 1px solid rgba(210, 170, 97, .22); }
      #${PANEL_ID} .lac-status {
        min-height: 42px;
        margin-top: 12px;
        padding: 8px 10px;
        color: #d7cfbf;
        background: rgba(7, 12, 9, .5);
        border: 1px solid rgba(210, 170, 97, .18);
        border-radius: 9px;
        white-space: pre-line;
      }
      #${PANEL_ID}.is-blocked .lac-status {
        color: #fecaca;
        background: rgba(127, 29, 29, .54);
        border-color: rgba(248, 113, 113, .7);
        box-shadow: 0 0 0 1px rgba(248, 113, 113, .12), 0 6px 18px rgba(127, 29, 29, .2);
        font-weight: 700;
      }
      #${PANEL_ID} .lac-status strong { color: #f1c86b; }
      #${PANEL_ID} .lac-hint { margin-top: 9px; color: #a89b84; font-size: 10px; }
      @media (max-width: 520px) { #${PANEL_ID} { right: 12px; bottom: 12px; left: 12px; width: auto; } }
      @media (prefers-reduced-motion: reduce) { #${PANEL_ID} *, #${PANEL_ID} *::before, #${PANEL_ID} *::after { animation: none !important; transition: none !important; } }
    `;
    document.head.appendChild(style);
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;
    addStyles();

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="lac-head">
        <div class="lac-icon" aria-hidden="true">🪓</div>
        <div class="lac-title-wrap"><div class="lac-kicker">灵木工具</div><div class="lac-title">自动连砍</div></div>
        <span class="lac-dot" aria-label="当前状态"></span>
        <button id="lac-update" type="button" title="检查更新" aria-label="检查更新" aria-busy="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M20 7v5h-5M4 17v-5h5" />
            <path d="M6.1 7a7 7 0 0 1 11.6-1L20 12M4 12l2.3 6A7 7 0 0 0 17.9 17" />
          </svg>
        </button>
      </div>
      <div class="lac-row">
        <label for="lac-interval">点击间隔</label>
        <div class="lac-field"><input id="lac-interval" type="number" min="${MIN_INTERVAL}" step="100" value="${getInterval()}" inputmode="numeric"><span class="lac-unit">ms</span></div>
      </div>
      <div class="lac-stats">
        <div class="lac-stat"><div class="lac-stat-label">剩余斧力</div><div id="lac-axe-current" class="lac-stat-value">--</div></div>
        <div class="lac-stat"><div class="lac-stat-label">本次连砍</div><div id="lac-click-count" class="lac-stat-value">0 次</div></div>
        <div class="lac-stat"><div class="lac-stat-label">运行用时</div><div id="lac-elapsed" class="lac-stat-value">00:00:00</div></div>
      </div>
      <div class="lac-actions">
        <button id="lac-start" type="button">开始连砍</button>
        <button id="lac-stop" type="button">停止</button>
      </div>
      <div id="lac-status" class="lac-status">准备就绪，等待开始。</div>
      <div class="lac-hint">间隔至少 ${MIN_INTERVAL}ms；斧力归零后自动停止。</div>
    `;
    document.body.appendChild(panel);
    restorePanelPosition(panel);

    const input = panel.querySelector('#lac-interval');
    const status = panel.querySelector('#lac-status');
    bindPanelDrag(panel, panel.querySelector('.lac-head'));
    panel.querySelector('#lac-start').addEventListener('click', start);
    panel.querySelector('#lac-stop').addEventListener('click', () => {
      if (state.running) stop('已手动停止。');
      else resetSession();
    });
    panel.querySelector('#lac-update').addEventListener('click', checkForUpdate);
    input.addEventListener('change', () => {
      const value = Math.max(MIN_INTERVAL, Math.round(Number(input.value) || DEFAULT_INTERVAL));
      input.value = String(value);
      pageWindow.localStorage.setItem(INTERVAL_KEY, String(value));
      if (state.running) updateStatus(`运行中：间隔 ${value}ms`);
    });

    window.__lingtaiAutoChop = { panel, input, status, updateButton: panel.querySelector('#lac-update'), axeCurrent: panel.querySelector('#lac-axe-current'), clickCount: panel.querySelector('#lac-click-count'), elapsed: panel.querySelector('#lac-elapsed') };
    updateStatus('准备就绪，等待开始。');
  }

  function isTargetPage() {
    return TARGET_PATH.test(window.location.pathname);
  }

  function removePanel() {
    clearTimer();
    if (state.running) state.running = false;
    stopElapsedClock();
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    delete window.__lingtaiAutoChop;
  }

  function syncPanelForRoute() {
    if (isTargetPage()) {
      if (!document.getElementById(PANEL_ID)) mountPanel();
    } else if (document.getElementById(PANEL_ID)) {
      removePanel();
    }
  }

  function installRouteWatcher() {
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        window.setTimeout(syncPanelForRoute, 0);
        return result;
      };
    }
    window.addEventListener('popstate', syncPanelForRoute);
  }

  function readSavedPosition() {
    try {
      const value = JSON.parse(pageWindow.localStorage.getItem(POSITION_KEY) || 'null');
      return value && Number.isFinite(value.left) && Number.isFinite(value.top) ? value : null;
    } catch (_) {
      return null;
    }
  }

  function clampPanelPosition(panel, left, top) {
    const rect = panel.getBoundingClientRect();
    const margin = 8;
    return {
      left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin)),
      top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin)),
    };
  }

  function applyPanelPosition(panel, left, top, save = false) {
    const position = clampPanelPosition(panel, left, top);
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    if (save) pageWindow.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    return position;
  }

  function restorePanelPosition(panel) {
    const saved = readSavedPosition();
    if (saved) applyPanelPosition(panel, saved.left, saved.top);
  }

  function bindPanelDrag(panel, handle) {
    if (!handle) return;
    let drag = null;

    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      if (event.button !== undefined && event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      panel.classList.add('is-dragging');
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      applyPanelPosition(panel, event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });

    const finishDrag = (event) => {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      const rect = panel.getBoundingClientRect();
      applyPanelPosition(panel, rect.left, rect.top, true);
      panel.classList.remove('is-dragging');
      drag = null;
      if (event.pointerId !== undefined) handle.releasePointerCapture?.(event.pointerId);
    };

    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', () => {
      const rect = panel.getBoundingClientRect();
      applyPanelPosition(panel, rect.left, rect.top, true);
    });
  }

  function updateStatus(message) {
    const ui = window.__lingtaiAutoChop;
    if (!ui) return;
    const axe = readAxe();
    state.lastAxe = axe;
    const suffix = axe ? `\n斧力：${formatNumber(axe.current)} / ${formatNumber(axe.max)}` : '';
    ui.status.textContent = `${message}${suffix}`;
    ui.axeCurrent.textContent = axe ? formatNumber(axe.current) : '--';
    ui.clickCount.textContent = `${state.clicks} 次`;
    renderElapsed();
    ui.panel.classList.toggle('is-running', state.running);
    ui.panel.classList.toggle('is-blocked', state.inventoryBlocked);
    ui.panel.classList.toggle('is-done', !state.running && /完成|归零/.test(message));
  }

  function compareVersions(left, right) {
    const parse = (value) => String(value).replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  function extractVersion(source) {
    const match = String(source).match(/^\s*\/\/\s*@version\s+([^\r\n]+)/m);
    return match ? match[1].trim() : null;
  }

  function fetchLatestSource(onSuccess, onError) {
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${UPDATE_URL}?t=${Date.now()}`,
        timeout: 10000,
        onload: (response) => response.status >= 200 && response.status < 300
          ? onSuccess(response.responseText)
          : onError(`GitHub 返回状态码 ${response.status}`),
        ontimeout: () => onError('检查更新超时'),
        onerror: () => onError('无法连接 GitHub'),
      });
      return;
    }
    fetch(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(onSuccess)
      .catch(() => onError('无法连接 GitHub'));
  }

  function checkForUpdate() {
    const ui = window.__lingtaiAutoChop;
    if (!ui || ui.updateButton?.disabled) return;
    ui.updateButton.disabled = true;
    ui.updateButton.setAttribute('aria-busy', 'true');
    ui.updateButton.setAttribute('aria-label', '正在检查更新');
    ui.updateButton.title = '正在检查更新…';
    updateStatus(`正在检查最新版本（当前 v${SCRIPT_VERSION}）……`);
    fetchLatestSource((source) => {
      const latestVersion = extractVersion(source);
      ui.updateButton.disabled = false;
      ui.updateButton.setAttribute('aria-busy', 'false');
      ui.updateButton.setAttribute('aria-label', '检查更新');
      ui.updateButton.title = '检查更新';
      if (!latestVersion) {
        updateStatus('无法识别 GitHub 上的版本号，请稍后重试。');
        return;
      }
      if (compareVersions(latestVersion, SCRIPT_VERSION) > 0) {
        updateStatus(`发现新版本 v${latestVersion}，正在打开更新安装页……`);
        window.open(UPDATE_URL, '_blank', 'noopener,noreferrer');
      } else {
        updateStatus(`已是最新版本 v${SCRIPT_VERSION}。`);
      }
    }, (message) => {
      ui.updateButton.disabled = false;
      ui.updateButton.setAttribute('aria-busy', 'false');
      ui.updateButton.setAttribute('aria-label', '检查更新');
      ui.updateButton.title = '检查更新';
      updateStatus(`${message}，请稍后重试。`);
    });
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  function renderElapsed() {
    const ui = window.__lingtaiAutoChop;
    if (!ui) return;
    const elapsed = state.running ? Date.now() - state.startedAt : state.elapsedMs;
    ui.elapsed.textContent = formatDuration(elapsed);
  }

  function startElapsedClock() {
    clearInterval(state.elapsedTimer);
    renderElapsed();
    state.elapsedTimer = window.setInterval(renderElapsed, 1000);
  }

  function stopElapsedClock() {
    if (state.running && state.startedAt) state.elapsedMs = Date.now() - state.startedAt;
    clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
    renderElapsed();
  }

  function resetSession() {
    state.running = false;
    clearTimer();
    stopElapsedClock();
    state.startedAt = 0;
    state.elapsedMs = 0;
    state.clicks = 0;
    state.zeroMode = false;
    state.zeroAxeClicks = 0;
    state.zeroDisabledChecks = 0;
    state.inventoryBlocked = false;
    state.inventoryUsed = null;
    state.inventoryCap = null;
    updateStatus('本次任务已重置，可以重新开始。');
  }

  function getGameDeviceId() {
    return pageWindow.localStorage.getItem('lottery_barrier_device_id') || '';
  }

  function apiRequest(method, path, body) {
    const token = pageWindow.localStorage.getItem('auth_token') || '';
    const url = `${window.location.origin}/api/v1${path}`;
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data: body === undefined ? undefined : JSON.stringify(body),
          timeout: 10000,
          onload: (response) => {
            if (response.status < 200 || response.status >= 300) {
              reject(new Error(`接口返回状态码 ${response.status}`));
              return;
            }
            try { resolve(JSON.parse(response.responseText)); }
            catch (_) { reject(new Error('接口返回格式无效')); }
          },
          ontimeout: () => reject(new Error('接口请求超时')),
          onerror: () => reject(new Error('接口请求失败')),
        });
      });
    }

    return fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`接口返回状态码 ${response.status}`);
      return response.json();
    });
  }

  function parseInventoryStatus(response) {
    const data = response && response.data ? response.data : response;
    const used = Number(data?.bag_used);
    const cap = Number(data?.bag_cap);
    if (!Number.isFinite(used) || !Number.isFinite(cap)) return null;
    return { used, cap };
  }

  async function getInventoryStatus() {
    const deviceId = getGameDeviceId();
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    const response = await apiRequest('GET', `/game/status${query}`);
    return parseInventoryStatus(response);
  }

  async function salvageLowGear() {
    return apiRequest('POST', '/game/salvage-batch', { max_color: 'blue' });
  }

  function pauseForInventory(message) {
    state.inventoryBlocked = true;
    stopElapsedClock();
    state.running = false;
    clearTimer();
    updateStatus(message);
  }

  async function ensureInventoryCapacity() {
    if (state.inventoryChecking) return false;
    state.inventoryChecking = true;
    try {
      let inventory = await getInventoryStatus();
      if (!inventory) throw new Error('无法读取仓库容量');
      state.inventoryUsed = inventory.used;
      state.inventoryCap = inventory.cap;

      if (inventory.used < inventory.cap) return true;

      updateStatus(`仓库已满 ${inventory.used}/${inventory.cap}，正在自动分解蓝色及以下装备……`);
      await salvageLowGear();
      inventory = await getInventoryStatus();
      if (!inventory) throw new Error('分解后无法读取仓库容量');
      state.inventoryUsed = inventory.used;
      state.inventoryCap = inventory.cap;

      if (inventory.used >= inventory.cap) {
        pauseForInventory(`仓库仍然溢出：${inventory.used}/${inventory.cap}\n请手动分解装备，处理后点击“开始连砍”。`);
        return false;
      }
      updateStatus(`已自动分解蓝色及以下装备，仓库 ${inventory.used}/${inventory.cap}，继续连砍。`);
      return true;
    } catch (error) {
      if (!state.running) return false;
      pauseForInventory(`无法自动处理仓库：${error.message}\n请手动检查装备，处理后点击“开始连砍”。`);
      return false;
    } finally {
      state.inventoryChecking = false;
    }
  }

  function saveIntervalFromInput() {
    const ui = window.__lingtaiAutoChop;
    const raw = ui ? Number(ui.input.value) : getInterval();
    const value = Math.max(MIN_INTERVAL, Math.round(Number.isFinite(raw) ? raw : DEFAULT_INTERVAL));
    if (ui) ui.input.value = String(value);
    pageWindow.localStorage.setItem(INTERVAL_KEY, String(value));
    return value;
  }

  function clearTimer() {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function stop(message = '已停止。') {
    stopElapsedClock();
    state.running = false;
    clearTimer();
    updateStatus(`${message}\n本次已调用 ${state.clicks} 次连砍。`);
  }

  function schedule(delay) {
    clearTimer();
    if (!state.running) return;
    state.timer = window.setTimeout(runOnce, delay);
  }

  async function runOnce() {
    if (!state.running) return;

    if (!(await ensureInventoryCapacity()) || !state.running) return;

    const axe = readAxe();
    if (axe && axe.current <= 0) state.zeroMode = true;

    const button = findBatchButton();
    if (!button) {
      updateStatus('等待“连砍 10 刀”按钮出现……');
      schedule(1000);
      return;
    }
    if (buttonBusy(button)) {
      if (state.zeroMode) {
        state.zeroDisabledChecks += 1;
        if (state.zeroDisabledChecks >= 5) {
          stop('任务完成：斧力为 0，按钮已连续 5 次禁用。');
          return;
        }
        updateStatus(`容错观察中：按钮禁用 ${state.zeroDisabledChecks}/5 次；额外连砍 ${state.zeroAxeClicks}/10 次。`);
      } else {
        updateStatus('等待上一批请求完成……');
      }
      schedule(Math.max(getInterval(), 500));
      return;
    }

    if (state.zeroMode) {
      state.zeroDisabledChecks = 0;
      if (state.zeroAxeClicks >= 10) {
        updateStatus('容错连砍已达到 10 次，继续观察按钮状态……');
        schedule(getInterval());
        return;
      }
    }

    button.click();
    state.clicks += 1;
    if (state.zeroMode) state.zeroAxeClicks += 1;
    updateStatus(state.zeroMode
      ? `容错连砍中：已额外调用 ${state.zeroAxeClicks}/10 次。`
      : `运行中：已调用 ${state.clicks} 次连砍。`);
    schedule(getInterval());
  }

  function start() {
    if (state.running) return;
    saveIntervalFromInput();
    const axe = readAxe();
    state.running = true;
    state.clicks = 0;
    state.startedAt = Date.now();
    state.elapsedMs = 0;
    state.zeroMode = Boolean(axe && axe.current <= 0);
    state.zeroAxeClicks = 0;
    state.zeroDisabledChecks = 0;
    state.inventoryBlocked = false;
    state.inventoryUsed = null;
    state.inventoryCap = null;
    startElapsedClock();
    updateStatus(state.zeroMode
      ? `斧力显示为 0，启动容错观察：最多额外连砍 10 次。`
      : `开始运行：间隔 ${getInterval()}ms。`);
    runOnce();
  }

  const observer = new MutationObserver((mutations) => {
    if (!state.running) return;
    const ui = window.__lingtaiAutoChop;
    if (ui && mutations.every((mutation) => ui.panel.contains(mutation.target))) return;
    const axe = readAxe();
    if (axe && axe.current <= 0) state.zeroMode = true;
  });

  function init() {
    installRouteWatcher();
    syncPanelForRoute();
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  if (document.body) init();
  else window.addEventListener('DOMContentLoaded', init, { once: true });
})();
