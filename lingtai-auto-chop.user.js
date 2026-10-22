// ==UserScript==
// @name         灵台自动连砍
// @namespace    https://k40.shengqainbang.cn/
// @version      1.3.0
// @description  按设定间隔点击“连砍 10 刀”，直到当前斧力归零。
// @match        https://k40.shengqainbang.cn/lingtai*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'lingtai-auto-chop-panel';
  const STYLE_ID = 'lingtai-auto-chop-style';
  const INTERVAL_KEY = 'lingtai-auto-chop-interval';
  const POSITION_KEY = 'lingtai-auto-chop-position';
  const DEFAULT_INTERVAL = 1500;
  const MIN_INTERVAL = 300;

  if (window.__lingtaiAutoChopLoaded) return;
  window.__lingtaiAutoChopLoaded = true;

  const state = {
    running: false,
    timer: null,
    elapsedTimer: null,
    clicks: 0,
    startedAt: 0,
    elapsedMs: 0,
    lastAxe: null,
  };

  const getInterval = () => {
    const value = Number(localStorage.getItem(INTERVAL_KEY));
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
    panel.querySelector('#lac-stop').addEventListener('click', () => stop('已手动停止。'));
    input.addEventListener('change', () => {
      const value = Math.max(MIN_INTERVAL, Math.round(Number(input.value) || DEFAULT_INTERVAL));
      input.value = String(value);
      localStorage.setItem(INTERVAL_KEY, String(value));
      if (state.running) updateStatus(`运行中：间隔 ${value}ms`);
    });

    window.__lingtaiAutoChop = { panel, input, status, axeCurrent: panel.querySelector('#lac-axe-current'), clickCount: panel.querySelector('#lac-click-count'), elapsed: panel.querySelector('#lac-elapsed') };
    updateStatus('准备就绪，等待开始。');
  }

  function readSavedPosition() {
    try {
      const value = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
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
    if (save) localStorage.setItem(POSITION_KEY, JSON.stringify(position));
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
    ui.panel.classList.toggle('is-done', !state.running && /完成|归零/.test(message));
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
    state.elapsedMs = state.startedAt ? Date.now() - state.startedAt : state.elapsedMs;
    clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
    renderElapsed();
  }

  function saveIntervalFromInput() {
    const ui = window.__lingtaiAutoChop;
    const raw = ui ? Number(ui.input.value) : getInterval();
    const value = Math.max(MIN_INTERVAL, Math.round(Number.isFinite(raw) ? raw : DEFAULT_INTERVAL));
    if (ui) ui.input.value = String(value);
    localStorage.setItem(INTERVAL_KEY, String(value));
    return value;
  }

  function clearTimer() {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function stop(message = '已停止。') {
    state.running = false;
    clearTimer();
    stopElapsedClock();
    updateStatus(`${message}\n本次已调用 ${state.clicks} 次连砍。`);
  }

  function schedule(delay) {
    clearTimer();
    if (!state.running) return;
    state.timer = window.setTimeout(runOnce, delay);
  }

  function runOnce() {
    if (!state.running) return;

    const axe = readAxe();
    if (axe && axe.current <= 0) {
      stop(`任务完成：斧力已归零。`);
      return;
    }

    const button = findBatchButton();
    if (!button) {
      updateStatus('等待“连砍 10 刀”按钮出现……');
      schedule(1000);
      return;
    }
    if (buttonBusy(button)) {
      updateStatus('等待上一批请求完成……');
      schedule(Math.max(getInterval(), 500));
      return;
    }

    button.click();
    state.clicks += 1;
    updateStatus(`运行中：已调用 ${state.clicks} 次连砍。`);
    schedule(getInterval());
  }

  function start() {
    if (state.running) return;
    saveIntervalFromInput();
    const axe = readAxe();
    if (axe && axe.current <= 0) {
      updateStatus('今日斧力已经归零，无需继续。');
      return;
    }
    state.running = true;
    state.clicks = 0;
    state.startedAt = Date.now();
    state.elapsedMs = 0;
    startElapsedClock();
    updateStatus(`开始运行：间隔 ${getInterval()}ms。`);
    runOnce();
  }

  const observer = new MutationObserver((mutations) => {
    if (!state.running) return;
    const ui = window.__lingtaiAutoChop;
    if (ui && mutations.every((mutation) => ui.panel.contains(mutation.target))) return;
    const axe = readAxe();
    if (axe && axe.current <= 0) stop('任务完成：斧力已归零。');
  });

  function init() {
    mountPanel();
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  if (document.body) init();
  else window.addEventListener('DOMContentLoaded', init, { once: true });
})();
