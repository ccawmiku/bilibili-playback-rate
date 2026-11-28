'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const SCRIPT_PATH = path.resolve(__dirname, '../bilibili-playback-rate.user.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

async function setupPlayerDOM({
    url = 'https://www.bilibili.com/video/BV1xx411c7mD/',
    savedRate = null,
    savedPersist = null,
    withPlayerDom = true,
    useBwpVideo = false,
    duration = 1200,
    currentTime = 300,
    preservesPitch = false,
    waitDomReady = true
} = {}) {
    const playerHtml = withPlayerDom
        ? `
            <div class="bpx-player-video-wrap">
                ${useBwpVideo ? '<bwp-video></bwp-video>' : '<video></video>'}
            </div>
            <div class="bpx-player-ctrl-playbackrate">
                <div class="bpx-player-ctrl-playbackrate-result">倍速</div>
                <ul class="bpx-player-ctrl-playbackrate-menu">
                    <li class="bpx-player-ctrl-playbackrate-menu-item">2.0x</li>
                    <li class="bpx-player-ctrl-playbackrate-menu-item">1.0x</li>
                </ul>
            </div>
            <div class="bpx-player-ctrl-time">
                <span class="bpx-player-ctrl-time-current">05:00</span>
            </div>
        `
        : '<div id="app"></div>';

    const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${playerHtml}</body></html>`, {
        url,
        runScripts: 'outside-only'
    });

    const { window } = dom;
    if (waitDomReady && window.document.readyState === 'loading') {
        await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }

    if (savedRate !== null) {
        window.localStorage.setItem('lgldl_rate_key', String(savedRate));
    }
    if (savedPersist !== null) {
        window.localStorage.setItem('lgldl_rate_persist_key', String(savedPersist));
    }

    const media = window.document.querySelector('video, bwp-video');
    if (media) {
        attachMediaProps(media, { duration, currentTime, playbackRate: 1, preservesPitch });
    }

    const rafQueue = [];
    const timers = new Set();

    const sandbox = {
        window,
        document: window.document,
        location: window.location,
        history: window.history,
        localStorage: window.localStorage,
        URLSearchParams: window.URLSearchParams,
        MutationObserver: window.MutationObserver,
        getComputedStyle: window.getComputedStyle.bind(window),
        requestAnimationFrame: (cb) => {
            const id = setTimeout(() => {
                timers.delete(id);
                cb(Date.now());
            }, 0);
            timers.add(id);
            rafQueue.push(id);
            return id;
        },
        setTimeout: (cb, ms) => {
            const id = setTimeout(() => {
                timers.delete(id);
                cb();
            }, ms);
            timers.add(id);
            return id;
        },
        clearTimeout,
        console
    };
    sandbox.globalThis = sandbox;

    vm.runInNewContext(SCRIPT_SOURCE, sandbox, { filename: 'bilibili-playback-rate.user.js' });

    const cleanup = () => {
        for (const id of timers) clearTimeout(id);
        timers.clear();
        window.close();
    };

    return { dom, window, document: window.document, cleanup };
}

function attachMediaProps(el, { duration = 1200, currentTime = 0, playbackRate = 1, preservesPitch = false } = {}) {
    let rate = playbackRate;
    let pitch = preservesPitch;
    Object.defineProperty(el, 'duration', { value: duration, configurable: true, writable: true });
    Object.defineProperty(el, 'currentTime', { value: currentTime, configurable: true, writable: true });
    Object.defineProperty(el, 'playbackRate', {
        get: () => rate,
        set: (v) => {
            rate = v;
        },
        configurable: true
    });
    Object.defineProperty(el, 'preservesPitch', {
        get: () => pitch,
        set: (v) => {
            pitch = v;
        },
        configurable: true
    });
}

function flushMicrotasksAndTimers(ms = 20) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test('菜单构建、样式注入、幂等性及预设倍速点击', async () => {
    const ctx = await setupPlayerDOM({ duration: 1800, currentTime: 0 });
    const { document, window, cleanup } = ctx;

    try {
        const style = document.getElementById('lgldlk-rate-style');
        assert.ok(style, '应注入样式 #lgldlk-rate-style');

        const menu = document.querySelector('ul.bpx-player-ctrl-playbackrate-menu');
        assert.equal(menu.getAttribute('data-lgldlk-rate'), 'true');

        const items = Array.from(menu.querySelectorAll('li'));
        assert.equal(items.length, 9, '应包含 1 开关 + 7 黄金倍速 + 1 自定义');
        assert.ok(items[0].classList.contains('lgldlk-persist-item'));
        assert.equal(items[0].querySelector('.lgldlk-persist-tag').textContent, '开');
        assert.ok(items[0].querySelector('.lgldlk-persist-tag').classList.contains('is-on'));

        const presetRates = items.slice(1, 8).map((li) => Number(li.getAttribute('data-rate-val')));
        assert.deepEqual(presetRates, [2, 1.8, 1.75, 1.6, 1.5, 1.25, 1]);
        assert.ok(items[8].classList.contains('lgldlk-custom-item'));
        assert.equal(items[8].textContent, '自定义');

        const resultEl = document.querySelector('.bpx-player-ctrl-playbackrate-result');
        assert.equal(resultEl.textContent, '倍速');
        assert.ok(menu.querySelector('li[data-rate-val="1"]').classList.contains('bpx-state-active'));

        // 点击 1.75x 预设
        const item175 = menu.querySelector('li[data-rate-val="1.75"]');
        item175.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        const video = document.querySelector('video');
        assert.equal(video.playbackRate, 1.75);
        assert.equal(video.preservesPitch, true);
        assert.equal(resultEl.textContent, '1.75x');
        assert.ok(item175.classList.contains('bpx-state-active'));
        assert.equal(menu.querySelector('li[data-rate-val="1"]').classList.contains('bpx-state-active'), false);
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.75');

        // 触发 DOM 变动但菜单已标记，不应重复注入样式或重置菜单项
        document.body.appendChild(document.createElement('div'));
        await flushMicrotasksAndTimers(10);
        assert.equal(document.querySelectorAll('#lgldlk-rate-style').length, 1);
        assert.equal(menu.querySelectorAll('li').length, 9);
    } finally {
        cleanup();
    }
});

test('初始化时若持久开关为关，则忽略历史保存倍速并从 1x 启动', async () => {
    const ctx = await setupPlayerDOM({
        savedRate: '2',
        savedPersist: 'false',
        duration: 600,
        currentTime: 0
    });
    const { document, window, cleanup } = ctx;

    try {
        const video = document.querySelector('video');
        const persistTag = document.querySelector('.lgldlk-persist-tag');
        const resultEl = document.querySelector('.bpx-player-ctrl-playbackrate-result');
        const remainEl = document.getElementById('lgldlk-real-remain');

        assert.equal(persistTag.textContent, '关');
        assert.equal(persistTag.classList.contains('is-on'), false);
        assert.equal(video.playbackRate, 1);
        assert.equal(resultEl.textContent, '倍速');
        assert.equal(remainEl.textContent, '实际剩 10:00');
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '2');
    } finally {
        cleanup();
    }
});

test('持续/单视频开关与跨视频、分P、无关参数切换隔离', async () => {
    const ctx = await setupPlayerDOM({
        url: 'https://www.bilibili.com/video/BV1abc/?p=1',
        savedRate: '1.8',
        savedPersist: 'true'
    });
    const { document, window, cleanup } = ctx;

    try {
        const video = document.querySelector('video');
        const menu = document.querySelector('ul.bpx-player-ctrl-playbackrate-menu');
        const persistItem = menu.querySelector('li.lgldlk-persist-item');
        const persistTag = persistItem.querySelector('.lgldlk-persist-tag');
        const resultEl = document.querySelector('.bpx-player-ctrl-playbackrate-result');

        // 初始化应恢复保存的 1.8x
        assert.equal(video.playbackRate, 1.8);
        assert.equal(resultEl.textContent, '1.8x');
        assert.equal(persistTag.textContent, '开');

        // 持续开启时：切换到 ?p=2 应沿用 1.8x
        window.history.pushState({}, '', '/video/BV1abc/?p=2');
        assert.equal(video.playbackRate, 1.8);

        // 点击开关关闭「持续倍速」
        persistItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(persistTag.textContent, '关');
        assert.equal(persistTag.classList.contains('is-on'), false);
        assert.equal(window.localStorage.getItem('lgldl_rate_persist_key'), 'false');

        // 关闭状态下切换为 1.5x：仅内存态生效，不覆盖 localStorage 中原保存的 '1.8'
        menu.querySelector('li[data-rate-val="1.5"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(video.playbackRate, 1.5);
        assert.equal(resultEl.textContent, '1.5x');
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.8');

        // URL 仅变动无关参数 t=60 / spm_id_from=xxx 时，不触发视频重置，维持 1.5x
        window.history.replaceState({}, '', '/video/BV1abc/?p=2&t=60&spm_id_from=333.1007');
        assert.equal(video.playbackRate, 1.5);

        // 切换到新视频 ?p=3 或 BV1new：自动恢复 1x，且不污染存储
        window.history.pushState({}, '', '/video/BV1new/');
        assert.equal(video.playbackRate, 1);
        assert.equal(resultEl.textContent, '倍速');
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.8');

        // 在关闭状态下调为 1.6x，随后点击开启「持续倍速」应立即持久化当前 1.6
        menu.querySelector('li[data-rate-val="1.6"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.8');

        persistItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(persistTag.textContent, '开');
        assert.equal(window.localStorage.getItem('lgldl_rate_persist_key'), 'true');
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.6');
    } finally {
        cleanup();
    }
});

test('自定义倍速输入: Enter 提交、Escape 取消防 blur 误提交、非法输入回退', async () => {
    const ctx = await setupPlayerDOM({ savedRate: '1.5' });
    const { document, window, cleanup } = ctx;

    try {
        const video = document.querySelector('video');
        const menu = document.querySelector('ul.bpx-player-ctrl-playbackrate-menu');
        const customItem = menu.querySelector('li.lgldlk-custom-item');
        const resultEl = document.querySelector('.bpx-player-ctrl-playbackrate-result');

        // 1. 点击自定义出现输入框，再次点击不重复创建
        customItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        let input = customItem.querySelector('input.lgldlk-custom-input');
        assert.ok(input);
        assert.equal(input.value, '1.5');
        customItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(customItem.querySelectorAll('input').length, 1);

        // 2. 输入合法自定义倍速 1.35 并按 Enter 提交
        input.value = '1.35';
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        // 模拟浏览器移除 DOM/失焦后可能随之触发的 blur
        input.dispatchEvent(new window.FocusEvent('blur'));

        assert.equal(customItem.querySelector('input'), null);
        assert.equal(customItem.textContent, '自定义');
        assert.equal(video.playbackRate, 1.35);
        assert.equal(resultEl.textContent, '1.35x');
        assert.ok(customItem.classList.contains('bpx-state-active'), '非预设倍速应高亮自定义项');
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.35');

        // 3. 输入 2.5 后按 Escape 取消，即使随后触发 blur 也绝不能误提交 2.5
        customItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        input = customItem.querySelector('input.lgldlk-custom-input');
        input.value = '2.5';
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        input.dispatchEvent(new window.FocusEvent('blur'));

        assert.equal(customItem.textContent, '自定义');
        assert.equal(video.playbackRate, 1.35);
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.35');
        assert.ok(customItem.classList.contains('bpx-state-active'));

        // 4. 输入越界或非法值并 blur 失焦提交：保持当前 1.35 不变
        for (const bad of ['', '0', '-1', '16.1', '1.5abc']) {
            customItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            input = customItem.querySelector('input.lgldlk-custom-input');
            // 对 type="number" 某些非法字符串赋值可能被浏览器置空，这里直接测空值和越界值及属性覆盖
            Object.defineProperty(input, 'value', { value: bad, configurable: true });
            input.dispatchEvent(new window.FocusEvent('blur'));

            assert.equal(customItem.textContent, '自定义');
            assert.equal(video.playbackRate, 1.35, `非法输入 "${bad}" 不应改变倍速`);
            assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.35');
        }

        // 5. blur 正常提交有效值 2.25，并验证输入期间按键与点击不向播放器冒泡
        customItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        input = customItem.querySelector('input.lgldlk-custom-input');

        let parentKeydownCount = 0;
        let parentClickCount = 0;
        menu.addEventListener('keydown', () => { parentKeydownCount += 1; });
        menu.addEventListener('click', () => { parentClickCount += 1; });

        input.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        assert.equal(parentClickCount, 0);
        assert.equal(parentKeydownCount, 0);

        input.value = '2.25';
        input.dispatchEvent(new window.FocusEvent('blur'));
        assert.equal(video.playbackRate, 2.25);
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '2.25');
    } finally {
        cleanup();
    }
});

test('实际剩余时间折算、缺失/异常媒体状态及 bwp-video 回退', async () => {
    const ctx = await setupPlayerDOM({
        useBwpVideo: true,
        duration: 3600,
        currentTime: 0
    });
    const { document, window, cleanup } = ctx;

    try {
        const bwpVideo = document.querySelector('bwp-video');
        const remainEl = document.getElementById('lgldlk-real-remain');
        assert.ok(remainEl, '应自动插入 #lgldlk-real-remain');
        assert.equal(remainEl.textContent, '实际剩 1:00:00');

        // 切换 2x 倍速后剩余时间折半 -> 30:00
        document.querySelector('li[data-rate-val="2"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(bwpVideo.playbackRate, 2);
        assert.equal(bwpVideo.preservesPitch, true);
        assert.equal(remainEl.textContent, '实际剩 30:00');

        // 模拟进度推进到 1800s，触发 timeupdate -> 剩 1800/2 = 900s = 15:00
        bwpVideo.currentTime = 1800;
        bwpVideo.dispatchEvent(new window.Event('timeupdate'));
        assert.equal(remainEl.textContent, '实际剩 15:00');

        // 触发 seeked 到 3000s -> 剩 600/2 = 300s = 05:00
        bwpVideo.currentTime = 3000;
        bwpVideo.dispatchEvent(new window.Event('seeked'));
        assert.equal(remainEl.textContent, '实际剩 05:00');

        // 外部触发 ratechange 回到 1x -> 剩 600/1 = 10:00
        bwpVideo.playbackRate = 1;
        bwpVideo.dispatchEvent(new window.Event('ratechange'));
        assert.equal(remainEl.textContent, '实际剩 10:00');

        // duration 为 NaN 或 0 时清空文本
        bwpVideo.duration = Number.NaN;
        bwpVideo.dispatchEvent(new window.Event('timeupdate'));
        assert.equal(remainEl.textContent, '');

        bwpVideo.duration = 0;
        bwpVideo.dispatchEvent(new window.Event('timeupdate'));
        assert.equal(remainEl.textContent, '');

        // currentTime 为 NaN 时清空文本；currentTime 超出 duration 时兜底为 00:00
        bwpVideo.duration = 600;
        bwpVideo.currentTime = Number.NaN;
        bwpVideo.dispatchEvent(new window.Event('timeupdate'));
        assert.equal(remainEl.textContent, '');

        bwpVideo.currentTime = 700;
        bwpVideo.dispatchEvent(new window.Event('timeupdate'));
        assert.equal(remainEl.textContent, '实际剩 00:00');

        // 缺失 video 元素时清空文本不崩溃
        bwpVideo.remove();
        window.dispatchEvent(new window.Event('resize'));
        assert.equal(remainEl.textContent, '');
    } finally {
        cleanup();
    }
});

test('SPA 路由、媒体事件捕获同步与 MutationObserver 播放器重建', async () => {
    const ctx = await setupPlayerDOM({
        withPlayerDom: false,
        savedRate: '1.75',
        savedPersist: 'true',
        waitDomReady: false
    });
    const { document, window, cleanup } = ctx;

    try {
        // 初始页面尚无播放器 DOM
        assert.equal(document.getElementById('lgldlk-real-remain'), null);

        // 动态插入播放器 DOM，验证 MutationObserver + scheduleInit 自动初始化
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="bpx-player-video-wrap"><video></video></div>
            <div class="bpx-player-ctrl-playbackrate-result">倍速</div>
            <ul class="bpx-player-ctrl-playbackrate-menu"></ul>
            <div class="bpx-player-ctrl-time"><span class="bpx-player-ctrl-time-current">00:00</span></div>
        `;
        document.body.appendChild(wrapper);
        const video = wrapper.querySelector('video');
        attachMediaProps(video, { duration: 1050, currentTime: 0, playbackRate: 1 });

        await flushMicrotasksAndTimers(25);

        const menu = document.querySelector('ul.bpx-player-ctrl-playbackrate-menu');
        assert.equal(menu.getAttribute('data-lgldlk-rate'), 'true');
        assert.equal(video.playbackRate, 1.75);
        assert.equal(document.getElementById('lgldlk-real-remain').textContent, '实际剩 10:00');

        // 模拟播放器换清晰度重建菜单与时间栏，同时新 video playbackRate 初始重置为 1
        menu.removeAttribute('data-lgldlk-rate');
        menu.replaceChildren();
        document.getElementById('lgldlk-real-remain').remove();
        video.playbackRate = 1;

        // 触发 DOM 变化使 MutationObserver 感知到重建
        const dummy = document.createElement('li');
        menu.appendChild(dummy);
        await flushMicrotasksAndTimers(25);

        assert.equal(menu.getAttribute('data-lgldlk-rate'), 'true');
        assert.equal(menu.querySelectorAll('li').length, 9);
        assert.equal(video.playbackRate, 1.75);
        assert.equal(document.getElementById('lgldlk-real-remain').textContent, '实际剩 10:00');

        // 模拟 loadedmetadata / playing 时播放器重设 playbackRate=1，捕获监听自动同步回 1.75
        video.playbackRate = 1;
        video.dispatchEvent(new window.Event('loadedmetadata', { bubbles: false }));
        assert.equal(video.playbackRate, 1.75);

        video.playbackRate = 1;
        video.dispatchEvent(new window.Event('playing', { bubbles: false }));
        assert.equal(video.playbackRate, 1.75);

        // 验证 popstate 与 hashchange 路由监听（关闭持续倍速后切换视频恢复 1x）
        menu.querySelector('li.lgldlk-persist-item').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        ctx.dom.reconfigure({ url: 'https://www.bilibili.com/video/BV1pop/?p=2' });
        window.dispatchEvent(new window.Event('popstate'));
        assert.equal(video.playbackRate, 1);

        menu.querySelector('li[data-rate-val="2"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(video.playbackRate, 2);

        // 同 key 的 hashchange 不重置倍速；不同 key 的 hashchange 重置为 1x
        ctx.dom.reconfigure({ url: 'https://www.bilibili.com/video/BV1pop/?p=2#reply' });
        window.dispatchEvent(new window.Event('hashchange'));
        assert.equal(video.playbackRate, 2);

        ctx.dom.reconfigure({ url: 'https://www.bilibili.com/video/BV1hash/?p=3#top' });
        window.dispatchEvent(new window.Event('hashchange'));
        assert.equal(video.playbackRate, 1);

        menu.querySelector('li[data-rate-val="2"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(video.playbackRate, 2);

        // fullscreenchange 不抛错并刷新剩余时间
        video.currentTime = 450; // 剩 600 / 2 = 300s = 05:00
        document.dispatchEvent(new window.Event('fullscreenchange'));
        await flushMicrotasksAndTimers(20);
        assert.equal(document.getElementById('lgldlk-real-remain').textContent, '实际剩 05:00');
    } finally {
        cleanup();
    }
});

test('视频 playbackRate setter 异常容错与 syncRemainTypography 垂直对齐', async () => {
    const ctx = await setupPlayerDOM({ savedRate: '1.5' });
    const { document, window, cleanup } = ctx;

    try {
        const video = document.querySelector('video');
        const timeEl = document.querySelector('.bpx-player-ctrl-time');
        const labelEl = timeEl.querySelector('.bpx-player-ctrl-time-current');
        const badge = document.getElementById('lgldlk-real-remain');

        labelEl.style.fontSize = '13px';
        labelEl.style.fontFamily = 'sans-serif';
        timeEl.style.height = '24px';
        labelEl.getBoundingClientRect = () => ({ top: 10, bottom: 30, height: 20 });
        badge.getBoundingClientRect = () => ({ top: 14, bottom: 30, height: 16 });

        video.currentTime = 600;
        video.dispatchEvent(new window.Event('timeupdate'));
        assert.equal(badge.style.fontSize, '13px');
        assert.equal(badge.style.height, '24px');
        assert.equal(badge.style.transform, 'translateY(-2.0px)');

        Object.defineProperty(video, 'playbackRate', {
            get: () => 1,
            set: () => {
                throw new Error('NotSupportedError');
            },
            configurable: true
        });

        const origWarn = console.warn;
        let warned = false;
        console.warn = () => {
            warned = true;
        };
        try {
            assert.doesNotThrow(() => {
                document.querySelector('li[data-rate-val="2"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            });
            assert.equal(warned, true);
        } finally {
            console.warn = origWarn;
        }
    } finally {
        cleanup();
    }
});

test('CommonJS 条件导出在 JSDOM 环境中完整挂载与全链路交互', async () => {
    const dom = new JSDOM(
        `<!DOCTYPE html><html><head></head><body>
            <div class="bpx-player-video-wrap"><video></video></div>
            <div class="bpx-player-ctrl-playbackrate">
                <div class="bpx-player-ctrl-playbackrate-result">倍速</div>
                <ul class="bpx-player-ctrl-playbackrate-menu"></ul>
            </div>
            <div class="bpx-player-ctrl-time"><span class="bpx-player-ctrl-time-current">00:00</span></div>
        </body></html>`,
        { url: 'https://www.bilibili.com/video/BV1cjs/', runScripts: 'outside-only' }
    );
    const { window } = dom;
    const { document } = window;
    if (document.readyState === 'loading') {
        await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }

    const video = document.querySelector('video');
    attachMediaProps(video, { duration: 900, currentTime: 0, playbackRate: 1 });
    const timeEl = document.querySelector('.bpx-player-ctrl-time');
    const labelEl = timeEl.querySelector('.bpx-player-ctrl-time-current');
    labelEl.style.fontSize = '14px';
    timeEl.style.height = '22px';
    labelEl.getBoundingClientRect = () => ({ top: 10, bottom: 26, height: 16 });

    const savedGlobals = new Map();
    const activeTimers = new Set();
    const injected = {
        window,
        document,
        location: window.location,
        history: window.history,
        localStorage: window.localStorage,
        MutationObserver: window.MutationObserver,
        getComputedStyle: window.getComputedStyle.bind(window),
        requestAnimationFrame: (cb) => {
            const id = setTimeout(() => {
                activeTimers.delete(id);
                cb(Date.now());
            }, 0);
            activeTimers.add(id);
            return id;
        }
    };

    for (const [key, val] of Object.entries(injected)) {
        savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { value: val, configurable: true, writable: true });
    }

    let mod = null;
    try {
        delete require.cache[SCRIPT_PATH];
        mod = require(SCRIPT_PATH);
        const menu = document.querySelector('ul.bpx-player-ctrl-playbackrate-menu');
        assert.equal(menu.getAttribute('data-lgldlk-rate'), 'true');

        labelEl.style.fontFamily = 'sans-serif';
        const badge = document.getElementById('lgldlk-real-remain');
        badge.getBoundingClientRect = () => ({ top: 12, bottom: 28, height: 16 });

        // 点击预设倍速
        menu.querySelector('li[data-rate-val="1.5"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(mod.getState().currentRate, 1.5);
        assert.equal(badge.textContent, '实际剩 10:00');
        assert.equal(badge.style.fontFamily, 'sans-serif');
        assert.equal(badge.style.transform, 'translateY(-2.0px)');

        // 测试自定义输入 Enter / Escape / blur / 非法输入
        const customItem = menu.querySelector('li.lgldlk-custom-item');
        customItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        let input = customItem.querySelector('input');
        input.value = '2.5';
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.equal(mod.getState().currentRate, 2.5);

        customItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        input = customItem.querySelector('input');
        input.value = '3.0';
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        input.dispatchEvent(new window.FocusEvent('blur'));
        assert.equal(mod.getState().currentRate, 2.5);

        customItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        input = customItem.querySelector('input');
        input.value = '';
        input.dispatchEvent(new window.FocusEvent('blur'));
        assert.equal(mod.getState().currentRate, 2.5);

        // 测试媒体捕获事件与 progress 事件
        video.playbackRate = 1;
        video.dispatchEvent(new window.Event('loadedmetadata'));
        assert.equal(video.playbackRate, 2.5);

        video.currentTime = 400;
        video.dispatchEvent(new window.Event('timeupdate'));
        assert.equal(badge.textContent, '实际剩 03:20');

        video.duration = 0;
        video.dispatchEvent(new window.Event('ratechange'));
        assert.equal(badge.textContent, '');
        video.duration = 900;
        video.currentTime = 0;
        video.dispatchEvent(new window.Event('seeked'));
        assert.equal(badge.textContent, '实际剩 06:00');

        // 测试持续开关关闭后切换再重新开启立即持久化
        const persistItem = menu.querySelector('li.lgldlk-persist-item');
        persistItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(mod.getState().persistEnabled, false);
        window.history.pushState({}, '', '/video/BV1next/');
        assert.equal(mod.getState().currentRate, 1);

        menu.querySelector('li[data-rate-val="1.75"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        persistItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(mod.getState().persistEnabled, true);
        assert.equal(window.localStorage.getItem('lgldl_rate_key'), '1.75');

        // 测试 fullscreenchange 与 DOMContentLoaded loading 分支
        document.dispatchEvent(new window.Event('fullscreenchange'));
        await flushMicrotasksAndTimers(20);

        // 测试重建触发 MutationObserver
        menu.removeAttribute('data-lgldlk-rate');
        menu.replaceChildren();
        menu.appendChild(document.createElement('li'));
        await flushMicrotasksAndTimers(25);
        assert.equal(menu.getAttribute('data-lgldlk-rate'), 'true');

        // 测试 loading 状态挂载 DOMContentLoaded 分支
        Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
        menu.removeAttribute('data-lgldlk-rate');
        menu.replaceChildren();
        mod.mountLifecycle();
        assert.equal(menu.getAttribute('data-lgldlk-rate'), null);
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        assert.equal(menu.getAttribute('data-lgldlk-rate'), 'true');

        // 测试 playbackRate setter 抛异常容错
        Object.defineProperty(video, 'playbackRate', {
            get: () => 1,
            set: () => {
                throw new Error('NotSupportedError');
            },
            configurable: true
        });
        const origWarn = console.warn;
        console.warn = () => {};
        try {
            assert.doesNotThrow(() => mod.setRate(video, 2));
        } finally {
            console.warn = origWarn;
        }
    } finally {
        if (mod && typeof mod.unmountLifecycle === 'function') {
            mod.unmountLifecycle();
        }
        for (const id of activeTimers) {
            clearTimeout(id);
        }
        activeTimers.clear();
        window.close();
        delete require.cache[SCRIPT_PATH];
        for (const [key, desc] of savedGlobals.entries()) {
            if (desc) {
                Object.defineProperty(globalThis, key, desc);
            } else {
                delete globalThis[key];
            }
        }
    }
});
