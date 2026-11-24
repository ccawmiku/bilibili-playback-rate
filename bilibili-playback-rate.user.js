// ==UserScript==
// @name         B站多倍速调节（知识区黄金倍速 + 真实剩余时间 + 持续/单视频开关）
// @namespace    ccawmiku
// @version      1.5
// @description  聚焦 1.5x-2.0x 黄金倍速区间（无滚动条），实时显示按倍速折算的真实剩余时间，支持「持续倍速 / 仅当前视频倍速」独立开关与内联自定义倍速
// @author       ccawmiku (based on lgldlk)
// @homepageURL  https://github.com/ccawmiku/bilibili-playback-rate
// @supportURL   https://github.com/ccawmiku/bilibili-playback-rate/issues
// @downloadURL  https://raw.githubusercontent.com/ccawmiku/bilibili-playback-rate/main/bilibili-playback-rate.user.js
// @updateURL    https://raw.githubusercontent.com/ccawmiku/bilibili-playback-rate/main/bilibili-playback-rate.user.js
// @match        *://*.bilibili.com/video/*
// @match        *://*.bilibili.tv/video/*
// @match        *://*.bilibili.com/bangumi/*
// @match        *://*.bilibili.tv/bangumi/*
// @match        *://*.bilibili.com/list/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';

    const RATE_STORAGE_KEY = 'lgldl_rate_key';
    const PERSIST_STORAGE_KEY = 'lgldl_rate_persist_key';
    const MENU_MARK_ATTR = 'data-lgldlk-rate';
    const REMAIN_EL_ID = 'lgldlk-real-remain';

    const MIN_RATE = 0.1;
    const MAX_RATE = 16;
    // 聚焦 1.5 ~ 2.0 黄金区间，共 7 个预设（加开关与自定义共 9 项，无滚动条）
    const RATE_LIST = [2.0, 1.8, 1.75, 1.6, 1.5, 1.25, 1.0];

    const $ = (sel) => document.querySelector(sel);

    function isValidRate(rate) {
        return typeof rate === 'number' && Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE;
    }

    function getPersistEnabled() {
        try {
            const raw = localStorage.getItem(PERSIST_STORAGE_KEY);
            return raw === null ? true : raw === 'true';
        } catch {
            return true;
        }
    }

    function savePersistEnabled(enabled) {
        try {
            localStorage.setItem(PERSIST_STORAGE_KEY, String(Boolean(enabled)));
        } catch {
            // 忽略存储受限异常
        }
    }

    function getSavedRate() {
        try {
            const raw = localStorage.getItem(RATE_STORAGE_KEY);
            if (!raw) return 1;
            const parsed = Number(raw);
            return isValidRate(parsed) ? parsed : 1;
        } catch {
            return 1;
        }
    }

    function saveRate(rate) {
        try {
            localStorage.setItem(RATE_STORAGE_KEY, String(rate));
        } catch {
            // 忽略存储受限异常
        }
    }

    // 识别当前视频唯一标识（忽略 spm_id_from、t 等无关参数）
    function getVideoKey() {
        const path = location.pathname.replace(/\/+$/, '');
        const params = new URLSearchParams(location.search);
        const parts = [path];
        for (const k of ['p', 'bvid', 'aid', 'oid']) {
            const v = params.get(k);
            if (v && !(k === 'p' && v === '1')) {
                parts.push(`${k}=${v}`);
            }
        }
        return parts.join('|');
    }

    let persistEnabled = getPersistEnabled();
    let activeVideoKey = getVideoKey();
    let currentRate = persistEnabled ? getSavedRate() : 1;

    function getVideoElement() {
        return $('.bpx-player-video-wrap video') || $('video') || $('bwp-video');
    }

    function formatDuration(totalSeconds) {
        if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00';
        const sec = Math.floor(totalSeconds);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    function syncRemainTypography(badge, timeEl) {
        if (!badge || !timeEl) return;
        const labelEl = timeEl.querySelector('.bpx-player-ctrl-time-current')
            || timeEl.querySelector('.bpx-player-ctrl-time-label')
            || timeEl;
        const csLabel = getComputedStyle(labelEl);
        const csTime = getComputedStyle(timeEl);
        if (csLabel.fontSize && badge.style.fontSize !== csLabel.fontSize) {
            badge.style.fontSize = csLabel.fontSize;
        }
        if (csLabel.fontFamily && badge.style.fontFamily !== csLabel.fontFamily) {
            badge.style.fontFamily = csLabel.fontFamily;
        }
        if (csTime.height && csTime.height !== 'auto' && badge.style.height !== csTime.height) {
            badge.style.height = csTime.height;
        }
        badge.style.transform = '';
        const refRect = labelEl.getBoundingClientRect();
        const myRect = badge.getBoundingClientRect();
        if (refRect.height > 0 && myRect.height > 0) {
            const dy = (refRect.top + refRect.bottom) / 2 - (myRect.top + myRect.bottom) / 2;
            if (Math.abs(dy) > 0.4) {
                badge.style.transform = `translateY(${dy.toFixed(1)}px)`;
            }
        }
    }

    // 折算并更新真实剩余观看时间
    function updateRemainingTime(video) {
        const targetVideo = video || getVideoElement();
        const timeEl = $('.bpx-player-ctrl-time');
        if (!timeEl) return;

        let badge = document.getElementById(REMAIN_EL_ID);
        if (!badge) {
            badge = document.createElement('span');
            badge.id = REMAIN_EL_ID;
            badge.title = '按当前倍速折算的实际剩余观看时间';
            timeEl.insertAdjacentElement('afterend', badge);
        }
        syncRemainTypography(badge, timeEl);

        if (
            !targetVideo ||
            !Number.isFinite(targetVideo.duration) ||
            targetVideo.duration <= 0 ||
            !Number.isFinite(targetVideo.currentTime)
        ) {
            if (badge.textContent !== '') badge.textContent = '';
            return;
        }

        const rate = targetVideo.playbackRate > 0 ? targetVideo.playbackRate : currentRate;
        const rawRemain = Math.max(0, targetVideo.duration - targetVideo.currentTime);
        const realRemain = rawRemain / rate;
        const text = `实际剩 ${formatDuration(realRemain)}`;
        if (badge.textContent !== text) {
            badge.textContent = text;
        }
    }

    function updateRateText(rate) {
        const rateElement = $('.bpx-player-ctrl-playbackrate-result');
        if (rateElement) {
            rateElement.innerText = rate === 1 ? '倍速' : `${rate}x`;
        }
    }

    function updateMenuActive(rate) {
        const menuNode = $('ul.bpx-player-ctrl-playbackrate-menu');
        if (!menuNode) return;

        let matchedPreset = false;
        menuNode.querySelectorAll('li[data-rate-val]').forEach((li) => {
            const val = Number(li.getAttribute('data-rate-val'));
            const isActive = val === rate;
            if (isActive) matchedPreset = true;
            li.classList.toggle('bpx-state-active', isActive);
        });

        const customItem = menuNode.querySelector('li.lgldlk-custom-item');
        if (customItem) {
            customItem.classList.toggle('bpx-state-active', !matchedPreset);
        }
    }

    function applyRateToVideo(video, rate) {
        if (!video || !isValidRate(rate)) return;
        try {
            if ('preservesPitch' in video) {
                video.preservesPitch = true;
            }
            if (video.playbackRate !== rate) {
                video.playbackRate = rate;
            }
        } catch (err) {
            console.warn('[B站倍速脚本] 设置倍速失败:', err);
        }
    }

    function setRate(video, rate, { saveIfPersist = true } = {}) {
        if (!isValidRate(rate)) return;
        currentRate = rate;

        // 仅在开启「持续倍速」时写入持久化存储；关闭时只作用于当前视频内存态
        if (saveIfPersist && persistEnabled) {
            saveRate(rate);
        }

        const targetVideo = video || getVideoElement();
        applyRateToVideo(targetVideo, rate);
        updateRateText(rate);
        updateMenuActive(rate);
        updateRemainingTime(targetVideo);
    }

    // 切换视频 / 分P 时根据开关决定沿用倍速还是重置 1.0x
    function handleVideoChangeIfNeeded() {
        const newKey = getVideoKey();
        if (newKey === activeVideoKey) return false;

        activeVideoKey = newKey;
        const nextRate = persistEnabled ? getSavedRate() : 1;
        setRate(getVideoElement(), nextRate, { saveIfPersist: false });
        return true;
    }

    function injectStyle() {
        if ($('#lgldlk-rate-style')) return;
        const style = document.createElement('style');
        style.id = 'lgldlk-rate-style';
        style.textContent = `
            ul.bpx-player-ctrl-playbackrate-menu[${MENU_MARK_ATTR}] {
                min-width: 88px;
                max-height: 420px;
                overflow-y: auto;
                scrollbar-width: none;
            }
            ul.bpx-player-ctrl-playbackrate-menu[${MENU_MARK_ATTR}]::-webkit-scrollbar {
                display: none;
            }
            ul.bpx-player-ctrl-playbackrate-menu[${MENU_MARK_ATTR}] li.bpx-player-ctrl-playbackrate-menu-item {
                height: 32px;
                line-height: 32px;
            }
            ul.bpx-player-ctrl-playbackrate-menu[${MENU_MARK_ATTR}] li.lgldlk-persist-item {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                font-size: 12px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.12);
                margin-bottom: 2px;
                padding: 0 6px;
                white-space: nowrap;
            }
            .lgldlk-persist-tag {
                padding: 1px 5px;
                border-radius: 3px;
                font-size: 11px;
                line-height: 1.3;
                font-weight: 600;
                background: rgba(255, 255, 255, 0.16);
                color: #bbb;
            }
            .lgldlk-persist-tag.is-on {
                background: #00aeec;
                color: #fff;
            }
            ul.bpx-player-ctrl-playbackrate-menu[${MENU_MARK_ATTR}] li.lgldlk-custom-item {
                padding: 0 6px;
            }
            .lgldlk-custom-input {
                width: 58px;
                height: 22px;
                line-height: 22px;
                text-align: center;
                font-size: 12px;
                color: #fff;
                background: rgba(255, 255, 255, 0.16);
                border: 1px solid rgba(255, 255, 255, 0.35);
                border-radius: 4px;
                outline: none;
            }
            .lgldlk-custom-input:focus {
                border-color: #00aeec;
                background: rgba(0, 0, 0, 0.45);
            }
            #${REMAIN_EL_ID} {
                display: inline-flex;
                align-items: center;
                margin-left: 8px;
                margin-right: 4px;
                font-size: 12px;
                line-height: 1;
                vertical-align: middle;
                color: hsla(0, 0%, 100%, 0.78);
                white-space: nowrap;
                font-variant-numeric: tabular-nums;
                user-select: none;
                pointer-events: none;
                flex-shrink: 0;
            }
        `;
        document.head.appendChild(style);
    }

    function buildPersistSwitchItem(menuNode) {
        const switchItem = document.createElement('li');
        switchItem.className = 'bpx-player-ctrl-playbackrate-menu-item lgldlk-persist-item';
        switchItem.title = '开启：所有视频保持倍速；关闭：仅对当前视频生效，切视频恢复1x';

        const labelSpan = document.createElement('span');
        labelSpan.textContent = '持续';

        const tagSpan = document.createElement('span');
        tagSpan.className = 'lgldlk-persist-tag';

        const renderTag = () => {
            tagSpan.textContent = persistEnabled ? '开' : '关';
            tagSpan.classList.toggle('is-on', persistEnabled);
        };
        renderTag();

        switchItem.addEventListener('click', (e) => {
            e.stopPropagation();
            persistEnabled = !persistEnabled;
            savePersistEnabled(persistEnabled);
            if (persistEnabled) {
                saveRate(currentRate);
            }
            renderTag();
        });

        switchItem.appendChild(labelSpan);
        switchItem.appendChild(tagSpan);
        menuNode.appendChild(switchItem);
    }

    function buildCustomMenuItem(menuNode) {
        const customItem = document.createElement('li');
        customItem.className = 'bpx-player-ctrl-playbackrate-menu-item lgldlk-custom-item';
        customItem.innerText = '自定义';

        customItem.addEventListener('click', (e) => {
            e.stopPropagation();
            if (customItem.querySelector('input')) return;

            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.05';
            input.min = String(MIN_RATE);
            input.max = String(MAX_RATE);
            input.value = String(currentRate);
            input.className = 'lgldlk-custom-input';
            input.title = `输入 ${MIN_RATE} ~ ${MAX_RATE} 后按回车`;

            const commit = () => {
                const val = parseFloat(input.value);
                customItem.innerText = '自定义';
                if (isValidRate(val)) {
                    setRate(getVideoElement(), val);
                } else {
                    updateMenuActive(currentRate);
                }
            };

            input.addEventListener('click', (ev) => ev.stopPropagation());
            input.addEventListener('keydown', (ev) => {
                ev.stopPropagation();
                if (ev.key === 'Enter') {
                    commit();
                } else if (ev.key === 'Escape') {
                    customItem.innerText = '自定义';
                    updateMenuActive(currentRate);
                }
            });
            input.addEventListener('blur', commit);

            customItem.innerText = '';
            customItem.appendChild(input);
            input.focus();
            input.select();
        });

        menuNode.appendChild(customItem);
    }

    function initRateMenu() {
        const menuNode = $('ul.bpx-player-ctrl-playbackrate-menu');
        if (!menuNode || menuNode.getAttribute(MENU_MARK_ATTR) === 'true') return;

        injectStyle();
        menuNode.setAttribute(MENU_MARK_ATTR, 'true');
        menuNode.replaceChildren();

        buildPersistSwitchItem(menuNode);

        for (const rate of RATE_LIST) {
            const rateItem = document.createElement('li');
            rateItem.className = 'bpx-player-ctrl-playbackrate-menu-item';
            rateItem.setAttribute('data-rate-val', String(rate));
            rateItem.innerText = `${rate}x`;
            rateItem.addEventListener('click', (e) => {
                e.stopPropagation();
                setRate(getVideoElement(), rate);
            });
            menuNode.appendChild(rateItem);
        }

        buildCustomMenuItem(menuNode);

        handleVideoChangeIfNeeded();
        setRate(getVideoElement(), currentRate, { saveIfPersist: false });
    }

    function isMediaTarget(target) {
        return Boolean(target && (target.tagName === 'VIDEO' || target.tagName === 'BWP-VIDEO'));
    }

    const onMediaActive = (e) => {
        if (!isMediaTarget(e.target)) return;
        handleVideoChangeIfNeeded();
        if (e.target.playbackRate !== currentRate) {
            setRate(e.target, currentRate, { saveIfPersist: false });
        } else {
            updateRemainingTime(e.target);
        }
    };
    document.addEventListener('playing', onMediaActive, true);
    document.addEventListener('loadedmetadata', onMediaActive, true);

    const onMediaProgress = (e) => {
        if (!isMediaTarget(e.target)) return;
        updateRemainingTime(e.target);
    };
    document.addEventListener('timeupdate', onMediaProgress, true);
    document.addEventListener('seeked', onMediaProgress, true);
    document.addEventListener('ratechange', onMediaProgress, true);

    const hookHistoryMethod = (methodName) => {
        const orig = history[methodName];
        if (typeof orig !== 'function') return;
        history[methodName] = function (...args) {
            const ret = orig.apply(this, args);
            handleVideoChangeIfNeeded();
            return ret;
        };
    };
    hookHistoryMethod('pushState');
    hookHistoryMethod('replaceState');
    window.addEventListener('popstate', handleVideoChangeIfNeeded);
    window.addEventListener('hashchange', handleVideoChangeIfNeeded);
    document.addEventListener('fullscreenchange', () => {
        requestAnimationFrame(() => updateRemainingTime());
        setTimeout(() => updateRemainingTime(), 120);
        setTimeout(() => updateRemainingTime(), 350);
    });
    window.addEventListener('resize', () => updateRemainingTime(), { passive: true });

    let initScheduled = false;
    const scheduleInit = () => {
        if (initScheduled) return;
        initScheduled = true;
        requestAnimationFrame(() => {
            initScheduled = false;
            handleVideoChangeIfNeeded();
            initRateMenu();
            updateRemainingTime();
        });
    };

    const observer = new MutationObserver(() => {
        const menuNode = $('ul.bpx-player-ctrl-playbackrate-menu');
        const timeEl = $('.bpx-player-ctrl-time');
        const needMenu = menuNode && menuNode.getAttribute(MENU_MARK_ATTR) !== 'true';
        const needRemain = timeEl && !document.getElementById(REMAIN_EL_ID);
        if (needMenu || needRemain) {
            scheduleInit();
        }
    });

    const start = () => {
        initRateMenu();
        updateRemainingTime();
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
