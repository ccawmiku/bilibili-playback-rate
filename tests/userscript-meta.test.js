'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const SCRIPT_PATH = path.resolve(__dirname, '../bilibili-playback-rate.user.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

test('Userscript 元数据头完整性校验', () => {
    const headerMatch = SCRIPT_SOURCE.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
    assert.ok(headerMatch, '应包含标准 ==UserScript== 元数据头');

    const header = headerMatch[1];
    assert.match(header, /@name\s+.+/);
    assert.match(header, /@version\s+\S+/);
    assert.match(header, /@match\s+\*:\/\/\*\.bilibili\.com\/video\/\*/);
    assert.match(header, /@grant\s+none/);
    assert.match(header, /@run-at\s+document-idle/);
});

test('纯浏览器沙箱（无 module/require/process）零构建直接加载运行成功', async () => {
    const dom = new JSDOM(
        `<!DOCTYPE html>
        <html>
          <head></head>
          <body>
            <div class="bpx-player-video-wrap"><video></video></div>
            <div class="bpx-player-ctrl-playbackrate-result">倍速</div>
            <ul class="bpx-player-ctrl-playbackrate-menu"></ul>
            <div class="bpx-player-ctrl-time"><span class="bpx-player-ctrl-time-current">00:00</span></div>
          </body>
        </html>`,
        {
            url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
            runScripts: 'outside-only'
        }
    );

    const { window } = dom;
    if (window.document.readyState === 'loading') {
        await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }

    const video = window.document.querySelector('video');
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 120, configurable: true });

    // 显式以不带 CommonJS/Node 全局对象的浏览器上下文运行原脚本
    const sandbox = {
        window,
        document: window.document,
        location: window.location,
        history: window.history,
        localStorage: window.localStorage,
        URLSearchParams: window.URLSearchParams,
        MutationObserver: window.MutationObserver,
        getComputedStyle: window.getComputedStyle.bind(window),
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        setTimeout,
        clearTimeout,
        console
    };
    sandbox.globalThis = sandbox;

    vm.runInNewContext(SCRIPT_SOURCE, sandbox, { filename: 'bilibili-playback-rate.user.js' });

    const menu = window.document.querySelector('ul.bpx-player-ctrl-playbackrate-menu');
    assert.equal(menu.getAttribute('data-lgldlk-rate'), 'true');
    assert.equal(menu.querySelectorAll('li').length, 9);
    assert.equal(window.document.getElementById('lgldlk-real-remain').textContent, '实际剩 08:00');
    assert.equal(window.globalRateLeaked, undefined);

    dom.window.close();
});
