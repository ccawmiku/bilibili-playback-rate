'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SCRIPT_PATH = path.resolve(__dirname, '../bilibili-playback-rate.user.js');

function loadUserscriptWithGlobals({ locationValue, localStorageValue } = {}) {
    delete require.cache[SCRIPT_PATH];

    const hadLocation = Object.prototype.hasOwnProperty.call(globalThis, 'location');
    const prevLocation = globalThis.location;
    const hadStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const prevStorage = globalThis.localStorage;

    if (locationValue !== undefined) {
        Object.defineProperty(globalThis, 'location', {
            value: locationValue,
            configurable: true,
            writable: true
        });
    } else {
        delete globalThis.location;
    }

    if (localStorageValue !== undefined) {
        Object.defineProperty(globalThis, 'localStorage', {
            value: localStorageValue,
            configurable: true,
            writable: true
        });
    } else {
        delete globalThis.localStorage;
    }

    try {
        return require(SCRIPT_PATH);
    } finally {
        if (hadLocation) {
            Object.defineProperty(globalThis, 'location', {
                value: prevLocation,
                configurable: true,
                writable: true
            });
        } else {
            delete globalThis.location;
        }

        if (hadStorage) {
            Object.defineProperty(globalThis, 'localStorage', {
                value: prevStorage,
                configurable: true,
                writable: true
            });
        } else {
            delete globalThis.localStorage;
        }
    }
}

function createMemoryStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        _dump() {
            return Object.fromEntries(store.entries());
        }
    };
}

test('isValidRate: 合法边界与非法非数值校验', () => {
    const mod = loadUserscriptWithGlobals();

    assert.equal(mod.isValidRate(0.1), true);
    assert.equal(mod.isValidRate(1), true);
    assert.equal(mod.isValidRate(1.75), true);
    assert.equal(mod.isValidRate(16), true);

    assert.equal(mod.isValidRate(0.09), false);
    assert.equal(mod.isValidRate(16.01), false);
    assert.equal(mod.isValidRate(0), false);
    assert.equal(mod.isValidRate(-1.5), false);
    assert.equal(mod.isValidRate(Number.NaN), false);
    assert.equal(mod.isValidRate(Number.POSITIVE_INFINITY), false);
    assert.equal(mod.isValidRate(Number.NEGATIVE_INFINITY), false);
    assert.equal(mod.isValidRate('1.5'), false);
    assert.equal(mod.isValidRate(null), false);
    assert.equal(mod.isValidRate(undefined), false);
    assert.equal(mod.isValidRate({}), false);
});

test('formatDuration: 秒/分/小时进位与异常输入兜底', () => {
    const mod = loadUserscriptWithGlobals();

    assert.equal(mod.formatDuration(0), '00:00');
    assert.equal(mod.formatDuration(5), '00:05');
    assert.equal(mod.formatDuration(59), '00:59');
    assert.equal(mod.formatDuration(59.9), '00:59');
    assert.equal(mod.formatDuration(60), '01:00');
    assert.equal(mod.formatDuration(65), '01:05');
    assert.equal(mod.formatDuration(3599), '59:59');
    assert.equal(mod.formatDuration(3600), '1:00:00');
    assert.equal(mod.formatDuration(3661), '1:01:01');
    assert.equal(mod.formatDuration(36000), '10:00:00');

    assert.equal(mod.formatDuration(-0.1), '00:00');
    assert.equal(mod.formatDuration(-100), '00:00');
    assert.equal(mod.formatDuration(Number.NaN), '00:00');
    assert.equal(mod.formatDuration(Number.POSITIVE_INFINITY), '00:00');
    assert.equal(mod.formatDuration(Number.NEGATIVE_INFINITY), '00:00');
    assert.equal(mod.formatDuration('60'), '00:00');
});

test('getVideoKey: 路径归一化、忽略无关查询参数并保留分P与视频ID', () => {
    const mod = loadUserscriptWithGlobals();

    try {
        globalThis.location = { pathname: '/video/BV1xx411c7mD/', search: '?spm_id_from=333.999&t=45&p=1' };
        assert.equal(mod.getVideoKey(), '/video/BV1xx411c7mD');

        globalThis.location = { pathname: '/video/BV1xx411c7mD', search: '' };
        assert.equal(mod.getVideoKey(), '/video/BV1xx411c7mD');

        globalThis.location = { pathname: '/video/BV1xx411c7mD/', search: '?p=2&t=120&vd_source=abc' };
        assert.equal(mod.getVideoKey(), '/video/BV1xx411c7mD|p=2');

        globalThis.location = { pathname: '/list/watchlater', search: '?oid=999&bvid=BV1ab&aid=777&p=3&spm_id_from=1' };
        assert.equal(mod.getVideoKey(), '/list/watchlater|p=3|bvid=BV1ab|aid=777|oid=999');

        globalThis.location = { pathname: '/', search: '' };
        assert.equal(mod.getVideoKey(), '');

        delete globalThis.location;
        assert.equal(mod.getVideoKey(), '');
    } finally {
        delete globalThis.location;
    }
});

test('Storage 读写: 默认值、非法值回退与异常降级', () => {
    const mem = createMemoryStorage();
    const mod = loadUserscriptWithGlobals({ localStorageValue: mem });

    // localStorage 全局缺失时安全降级
    assert.equal(mod.getPersistEnabled(), true);
    assert.equal(mod.getSavedRate(), 1);
    assert.doesNotThrow(() => mod.savePersistEnabled(false));
    assert.doesNotThrow(() => mod.saveRate(1.5));

    globalThis.localStorage = mem;
    try {
        assert.equal(mod.getPersistEnabled(), true);
        assert.equal(mod.getSavedRate(), 1);

        mod.savePersistEnabled(false);
        assert.equal(mem.getItem(mod.PERSIST_STORAGE_KEY), 'false');
        assert.equal(mod.getPersistEnabled(), false);

        mod.savePersistEnabled(1);
        assert.equal(mem.getItem(mod.PERSIST_STORAGE_KEY), 'true');
        assert.equal(mod.getPersistEnabled(), true);

        mem.setItem(mod.PERSIST_STORAGE_KEY, 'invalid-bool');
        assert.equal(mod.getPersistEnabled(), false);

        mod.saveRate(1.75);
        assert.equal(mod.getSavedRate(), 1.75);

        for (const bad of ['', '0', '0.05', '16.5', 'abc', 'Infinity', '-2']) {
            mem.setItem(mod.RATE_STORAGE_KEY, bad);
            assert.equal(mod.getSavedRate(), 1, `非法倍速 ${bad} 应回退到 1`);
        }

        // localStorage 在隐私模式或受限场景抛出异常时的容错
        globalThis.localStorage = {
            getItem() {
                throw new Error('SecurityError');
            },
            setItem() {
                throw new Error('QuotaExceededError');
            }
        };
        assert.equal(mod.getPersistEnabled(), true);
        assert.equal(mod.getSavedRate(), 1);
        assert.doesNotThrow(() => mod.savePersistEnabled(false));
        assert.doesNotThrow(() => mod.saveRate(2.0));
    } finally {
        delete globalThis.localStorage;
    }
});

test('isMediaTarget: 仅识别 VIDEO 与 BWP-VIDEO 元素', () => {
    const mod = loadUserscriptWithGlobals();

    assert.equal(mod.isMediaTarget({ tagName: 'VIDEO' }), true);
    assert.equal(mod.isMediaTarget({ tagName: 'BWP-VIDEO' }), true);
    assert.equal(mod.isMediaTarget({ tagName: 'DIV' }), false);
    assert.equal(mod.isMediaTarget(null), false);
    assert.equal(mod.isMediaTarget(undefined), false);
});
