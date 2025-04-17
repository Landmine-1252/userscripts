// ==UserScript==
// @name         IMDB Larger Photos
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Modifies the default small images to a larger size on the IMDB Cast page.
// @author       Landmine
// @match        https://www.imdb.com/title/*/fullcredits*
// @icon         https://www.imdb.com/favicon.ico
// @grant        GM_addStyle
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/imdb-larger-photos.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/imdb-larger-photos.js
// ==/UserScript==


(function() {
    'use strict';

    // ——— CONFIG ———
    const avatarSizeRem = 15;

    // ——— CSS OVERRIDES ———
    GM_addStyle(`
        /* Hide placeholder span */
        li[data-testid="name-credits-list-item"]
            .ipc-metadata-list-summary-item__t.ipc-btn--not-interactable {
            display: none !important;
        }

        /* Enlarge & square the avatar container */
        li[data-testid="name-credits-list-item"]
            .ipc-avatar.name-credits--avatar {
            width: ${avatarSizeRem}rem !important;
            height: ${avatarSizeRem}rem !important;
            min-width: ${avatarSizeRem}rem !important;
            flex-shrink: 0 !important;
            margin: 0 !important;
            border-radius: 0 !important;
        }

        /* Remove ALL circle‑radius styles (including overlay) */
        li[data-testid="name-credits-list-item"]
            .ipc-media.ipc-media--circle-radius,
        li[data-testid="name-credits-list-item"]
            .ipc-media.ipc-media--circle-radius ~ .ipc-lockup-overlay {
            border-radius: 0 !important;
        }

        /* Fill that container fully */
        li[data-testid="name-credits-list-item"] .ipc-media--avatar,
        li[data-testid="name-credits-list-item"] .ipc-media--avatar-m,
        li[data-testid="name-credits-list-item"] .ipc-avatar__avatar-image,
        li[data-testid="name-credits-list-item"] img.ipc-image {
            width: 100% !important;
            height: 100% !important;
        }

        /* Remove hover overlay */
        li[data-testid="name-credits-list-item"] .ipc-lockup-overlay,
        li[data-testid="name-credits-list-item"] .ipc-lockup-overlay__screen {
            display: none !important;
        }

        /* Pad the row so text sits to the right */
        li[data-testid="name-credits-list-item"]
            .ipc-metadata-list-summary-item__tc {
            position: relative !important;
            padding-left: calc(${avatarSizeRem}rem + 1rem) !important;
            min-height: ${avatarSizeRem}rem !important;
        }

        /* Absolutely position the avatar */
        li[data-testid="name-credits-list-item"]
            .ipc-avatar.name-credits--avatar {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
        }

        /* Fix IMDb’s flex‑child % widths so text flows */
        li[data-testid="name-credits-list-item"] .sc-4b344583-5.ihLwwk,
        li[data-testid="name-credits-list-item"] .sc-4b344583-3.ioidKJ {
            width: auto !important;
            flex: 1 1 auto !important;
            padding-right: 0.75rem !important;
        }

        /* Allow names to wrap */
        li[data-testid="name-credits-list-item"] .name-credits--title-text-big {
            white-space: normal !important;
        }

        /* Reinforce size on wide screens */
        @media screen and (min-width: 600px) {
            li[data-testid="name-credits-list-item"]
                .ipc-avatar.name-credits--avatar {
                width: ${avatarSizeRem}rem !important;
                height: ${avatarSizeRem}rem !important;
            }
        }
    `);

    // ——— DYNAMIC RE‑APPLY ———
    function applyStyles() {
        document.querySelectorAll('li[data-testid="name-credits-list-item"]').forEach(li => {
            const avatar = li.querySelector('.ipc-avatar.name-credits--avatar');
            const media  = li.querySelector('.ipc-media--avatar, .ipc-media--avatar-m');
            const img    = li.querySelector('img.ipc-image');
            const row    = li.querySelector('.ipc-metadata-list-summary-item__tc');
            const flex1  = li.querySelector('.sc-4b344583-5.ihLwwk');
            const flex2  = li.querySelector('.sc-4b344583-3.ioidKJ');
            const title  = li.querySelector('.name-credits--title-text-big');

            if (avatar) Object.assign(avatar.style, {
                width:       `${avatarSizeRem}rem`,
                height:      `${avatarSizeRem}rem`,
                minWidth:    `${avatarSizeRem}rem`,
                flexShrink:  '0',
                margin:      '0',
                borderRadius:'0',
                position:    'absolute',
                top:         '0',
                left:        '0'
            });
            if (media)  Object.assign(media.style, {
                width:  '100%',
                height: '100%',
                borderRadius: '0'
            });
            if (img)    Object.assign(img.style, {
                width:  '100%',
                height: 'auto'
            });
            if (row)    Object.assign(row.style, {
                position:    'relative',
                paddingLeft: `calc(${avatarSizeRem}rem + 1rem)`,
                minHeight:   `${avatarSizeRem}rem`
            });
            [flex1, flex2].forEach(el => {
                if (el) Object.assign(el.style, {
                    width:        'auto',
                    flex:         '1 1 auto',
                    paddingRight: '0.75rem'
                });
            });
            if (title)  title.style.whiteSpace = 'normal';
        });
    }

    applyStyles();
    new MutationObserver(applyStyles).observe(document.body, {
        childList: true,
        subtree:   true
    });
})();
