// ==UserScript==
// @name         IMDB Larger Photos
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Enlarges cast photos on IMDb full credits pages.
// @author       Landmine
// @match        https://www.imdb.com/title/*/fullcredits*
// @icon         https://www.imdb.com/favicon.ico
// @grant        GM_addStyle
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/imdb/imdb-larger-photos.user.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/imdb/imdb-larger-photos.user.js
// ==/UserScript==

(function () {
    'use strict';

    const AVATAR_SIZE_REM = 15;
    const LIST_ITEM_SELECTOR = 'li[data-testid="name-credits-list-item"]';

    GM_addStyle(`
        ${LIST_ITEM_SELECTOR} .ipc-metadata-list-summary-item__t.ipc-btn--not-interactable {
            display: none !important;
        }

        ${LIST_ITEM_SELECTOR} .ipc-avatar.name-credits--avatar {
            width: ${AVATAR_SIZE_REM}rem !important;
            height: ${AVATAR_SIZE_REM}rem !important;
            min-width: ${AVATAR_SIZE_REM}rem !important;
            flex-shrink: 0 !important;
            margin: 0 !important;
            border-radius: 0 !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
        }

        ${LIST_ITEM_SELECTOR} .ipc-media.ipc-media--circle-radius,
        ${LIST_ITEM_SELECTOR} .ipc-media.ipc-media--circle-radius ~ .ipc-lockup-overlay {
            border-radius: 0 !important;
        }

        ${LIST_ITEM_SELECTOR} .ipc-media--avatar,
        ${LIST_ITEM_SELECTOR} .ipc-media--avatar-m,
        ${LIST_ITEM_SELECTOR} .ipc-avatar__avatar-image,
        ${LIST_ITEM_SELECTOR} img.ipc-image {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
        }

        ${LIST_ITEM_SELECTOR} .ipc-lockup-overlay,
        ${LIST_ITEM_SELECTOR} .ipc-lockup-overlay__screen {
            display: none !important;
        }

        ${LIST_ITEM_SELECTOR} .ipc-metadata-list-summary-item__tc {
            position: relative !important;
            padding-left: calc(${AVATAR_SIZE_REM}rem + 1rem) !important;
            min-height: ${AVATAR_SIZE_REM}rem !important;
        }

        ${LIST_ITEM_SELECTOR} .ipc-metadata-list-summary-item__tc > * {
            width: auto !important;
            flex: 1 1 auto !important;
            padding-right: 0.75rem !important;
        }

        ${LIST_ITEM_SELECTOR} .name-credits--title-text-big {
            white-space: normal !important;
        }
    `);

    function styleListItem(listItem) {
        const avatar = listItem.querySelector('.ipc-avatar.name-credits--avatar');
        const media = listItem.querySelector('.ipc-media--avatar, .ipc-media--avatar-m');
        const image = listItem.querySelector('img.ipc-image');
        const content = listItem.querySelector('.ipc-metadata-list-summary-item__tc');
        const title = listItem.querySelector('.name-credits--title-text-big');

        if (avatar) {
            Object.assign(avatar.style, {
                width: `${AVATAR_SIZE_REM}rem`,
                height: `${AVATAR_SIZE_REM}rem`,
                minWidth: `${AVATAR_SIZE_REM}rem`,
                flexShrink: '0',
                margin: '0',
                borderRadius: '0',
                position: 'absolute',
                top: '0',
                left: '0',
            });
        }

        if (media) {
            Object.assign(media.style, {
                width: '100%',
                height: '100%',
                borderRadius: '0',
            });
        }

        if (image) {
            Object.assign(image.style, {
                width: '100%',
                height: '100%',
                objectFit: 'cover',
            });
        }

        if (content) {
            Object.assign(content.style, {
                position: 'relative',
                paddingLeft: `calc(${AVATAR_SIZE_REM}rem + 1rem)`,
                minHeight: `${AVATAR_SIZE_REM}rem`,
            });

            Array.from(content.children).forEach((child) => {
                Object.assign(child.style, {
                    width: 'auto',
                    flex: '1 1 auto',
                    paddingRight: '0.75rem',
                });
            });
        }

        if (title) {
            title.style.whiteSpace = 'normal';
        }
    }

    function applyStyles(root = document) {
        root.querySelectorAll(LIST_ITEM_SELECTOR).forEach(styleListItem);
    }

    let scheduled = false;

    function scheduleApplyStyles() {
        if (scheduled) {
            return;
        }

        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            applyStyles();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleApplyStyles, { once: true });
    } else {
        scheduleApplyStyles();
    }

    const observerTarget = document.body || document.documentElement;
    if (observerTarget) {
        new MutationObserver(scheduleApplyStyles).observe(observerTarget, {
            childList: true,
            subtree: true,
        });
    }
})();
