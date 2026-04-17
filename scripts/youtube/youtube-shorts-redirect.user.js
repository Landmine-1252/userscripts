// ==UserScript==
// @name         YouTube Shorts Redirect
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Redirect YouTube Shorts URLs to normal watch URLs as early as possible.
// @author       Landmine
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @match        *://m.youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/youtube/youtube-shorts-redirect.user.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/youtube/youtube-shorts-redirect.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SHORTS_PREFIX = '/shorts/';

    function getWatchUrl(urlString = window.location.href) {
        let url;

        try {
            url = new URL(urlString, window.location.origin);
        } catch {
            return null;
        }
        if (!url.pathname.startsWith(SHORTS_PREFIX)) {
            return null;
        }

        const videoId = url.pathname.slice(SHORTS_PREFIX.length).split('/')[0];
        if (!videoId) {
            return null;
        }

        url.pathname = '/watch';
        url.searchParams.set('v', videoId);
        return url.toString();
    }

    function redirectIfNeeded(urlString) {
        const targetUrl = getWatchUrl(urlString);
        if (targetUrl && targetUrl !== window.location.href) {
            window.location.replace(targetUrl);
        }
    }

    function wrapHistoryMethod(methodName) {
        const original = window.history[methodName];

        if (typeof original !== 'function') {
            return;
        }

        window.history[methodName] = function (...args) {
            const result = original.apply(this, args);

            if (args.length >= 3 && typeof args[2] === 'string') {
                redirectIfNeeded(args[2]);
            } else {
                redirectIfNeeded();
            }

            return result;
        };
    }

    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');

    window.addEventListener('popstate', () => redirectIfNeeded());
    document.addEventListener('yt-navigate-finish', () => redirectIfNeeded(), true);

    redirectIfNeeded();
})();
