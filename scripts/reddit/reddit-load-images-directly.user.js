// ==UserScript==
// @name         Load Reddit Images Directly
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Rewrites Reddit image post links to open the direct hosted image when possible.
// @author       Landmine
// @match        *://www.reddit.com/*
// @match        *://new.reddit.com/*
// @grant        none
// @icon         https://www.reddit.com/favicon.ico
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/reddit/reddit-load-images-directly.user.js
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/reddit/reddit-load-images-directly.user.js
// ==/UserScript==

(function () {
    'use strict';

    const PROCESSED_ATTR = 'data-direct-image-link';

    function toDirectRedditImage(urlString) {
        if (!urlString) {
            return null;
        }

        try {
            const url = new URL(urlString, window.location.href);

            if (url.hostname === 'preview.redd.it') {
                return `https://i.redd.it${url.pathname}`;
            }

            if (url.hostname === 'i.redd.it') {
                return url.toString();
            }

            if (url.hostname.endsWith('reddit.com') && url.pathname === '/media') {
                return toDirectRedditImage(url.searchParams.get('url'));
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    function extractImageCandidates(image) {
        const candidates = [];

        if (image.currentSrc) {
            candidates.push(image.currentSrc);
        }

        if (image.src) {
            candidates.push(image.src);
        }

        const srcset = image.getAttribute('srcset');
        if (srcset) {
            srcset.split(',').forEach((candidate) => {
                const url = candidate.trim().split(/\s+/)[0];
                if (url) {
                    candidates.push(url);
                }
            });
        }

        return candidates;
    }

    function isRedditPostLink(anchor) {
        try {
            const url = new URL(anchor.href, window.location.href);
            if (!url.hostname.endsWith('reddit.com')) {
                return false;
            }

            return url.pathname.includes('/comments/')
                || url.pathname.startsWith('/media')
                || url.pathname.includes('/s/');
        } catch (error) {
            return false;
        }
    }

    function findDirectImage(anchor) {
        const images = anchor.querySelectorAll('img');

        for (const image of images) {
            const candidates = extractImageCandidates(image);
            for (const candidate of candidates) {
                const directImage = toDirectRedditImage(candidate);
                if (directImage) {
                    return directImage;
                }
            }
        }

        return toDirectRedditImage(anchor.href);
    }

    function rewriteImageLinks(root = document) {
        root.querySelectorAll(`a[href]:not([${PROCESSED_ATTR}])`).forEach((anchor) => {
            if (!isRedditPostLink(anchor)) {
                return;
            }

            const directImage = findDirectImage(anchor);
            if (!directImage) {
                return;
            }

            anchor.dataset.redditPostUrl = anchor.href;
            anchor.href = directImage;
            anchor.setAttribute(PROCESSED_ATTR, 'true');
        });
    }

    let scheduled = false;

    function scheduleRewrite() {
        if (scheduled) {
            return;
        }

        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            rewriteImageLinks();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleRewrite, { once: true });
    } else {
        scheduleRewrite();
    }

    const observerTarget = document.body || document.documentElement;
    if (observerTarget) {
        new MutationObserver(scheduleRewrite).observe(observerTarget, {
            childList: true,
            subtree: true,
        });
    }
})();
