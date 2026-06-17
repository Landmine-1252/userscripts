// ==UserScript==
// @name         YouTube Shorts Redirect
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Redirect YouTube Shorts URLs to normal watch URLs and rewrite Shorts links in-page.
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
    const SHORTS_REDIRECT_ATTRIBUTE = 'data-shorts-redirect-url';
    const SHORTS_LINK_SELECTOR = 'a[href*="/shorts/"]';
    const SHORTS_EVENT_LINK_SELECTOR = `${SHORTS_LINK_SELECTOR},a[${SHORTS_REDIRECT_ATTRIBUTE}]`;

    function isYouTubeHost(hostname) {
        return hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
    }

    function getWatchUrl(urlString = window.location.href) {
        let url;

        try {
            url = new URL(urlString, window.location.origin);
        } catch {
            return null;
        }
        if (!isYouTubeHost(url.hostname)) {
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

    function rewriteShortsLink(link) {
        if (link?.localName !== 'a') {
            return null;
        }

        const targetUrl = getWatchUrl(link.href);
        if (targetUrl) {
            link.setAttribute(SHORTS_REDIRECT_ATTRIBUTE, targetUrl);

            if (targetUrl !== link.href) {
                link.href = targetUrl;
            }

            return targetUrl;
        }

        const storedTargetUrl = link.getAttribute(SHORTS_REDIRECT_ATTRIBUTE);
        if (storedTargetUrl && storedTargetUrl === link.href) {
            return storedTargetUrl;
        }

        link.removeAttribute(SHORTS_REDIRECT_ATTRIBUTE);
        return null;
    }

    function rewriteShortsLinks(root = document) {
        if (!root) {
            return;
        }

        if (root.nodeType === Node.ELEMENT_NODE && root.matches(SHORTS_LINK_SELECTOR)) {
            rewriteShortsLink(root);
        }

        root.querySelectorAll?.(SHORTS_LINK_SELECTOR).forEach(rewriteShortsLink);
    }

    function shouldHandleClick(event, link) {
        return event.type === 'click'
            && event.button === 0
            && !event.defaultPrevented
            && !event.altKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.shiftKey
            && !link.hasAttribute('download')
            && (!link.target || link.target.toLowerCase() === '_self');
    }

    function rewriteEventLink(event) {
        const link = event.target?.closest?.(SHORTS_EVENT_LINK_SELECTOR);
        if (!link) {
            return;
        }

        const targetUrl = rewriteShortsLink(link);
        if (targetUrl && shouldHandleClick(event, link) && targetUrl !== window.location.href) {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.location.assign(targetUrl);
        }
    }

    function observeShortsLinks() {
        rewriteShortsLinks();

        if (typeof MutationObserver !== 'function') {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    rewriteShortsLink(mutation.target);
                    continue;
                }

                mutation.addedNodes.forEach(rewriteShortsLinks);
            }
        });

        observer.observe(document, {
            attributeFilter: ['href'],
            attributes: true,
            childList: true,
            subtree: true,
        });
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
    document.addEventListener('pointerdown', rewriteEventLink, true);
    document.addEventListener('click', rewriteEventLink, true);
    document.addEventListener('auxclick', rewriteEventLink, true);
    document.addEventListener('yt-navigate-finish', () => redirectIfNeeded(), true);
    document.addEventListener('yt-navigate-finish', () => rewriteShortsLinks(), true);

    observeShortsLinks();
    redirectIfNeeded();
})();
