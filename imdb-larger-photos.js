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
    // avatarSizeRem: the size of each actor photo in rem units
    const avatarSizeRem = 15; // Controls the size of the cast member images

    // ——— CSS OVERRIDES (INITIAL STYLING) ———
    // This section injects CSS directly into the page using GM_addStyle.
    // These styles are applied on initial page load and cover the general appearance
    // of cast member items. This is the primary method for styling static elements.
    GM_addStyle(`
        /* Hide placeholder span for missing avatars */
        li[data-testid="name-credits-list-item"]
            .ipc-metadata-list-summary-item__t.ipc-btn--not-interactable {
            display: none !important;
        }

        /* Enlarge & square the avatar container for each cast member */
        li[data-testid="name-credits-list-item"]
            .ipc-avatar.name-credits--avatar {
            width: ${avatarSizeRem}rem !important;
            height: ${avatarSizeRem}rem !important;
            min-width: ${avatarSizeRem}rem !important;
            flex-shrink: 0 !important;
            margin: 0 !important;
            border-radius: 0 !important;
        }

        /* Remove ALL circle‑radius styles (including overlay) to make avatars square */
        li[data-testid="name-credits-list-item"]
            .ipc-media.ipc-media--circle-radius,
        li[data-testid="name-credits-list-item"]
            .ipc-media.ipc-media--circle-radius ~ .ipc-lockup-overlay {
            border-radius: 0 !important;
        }

        /* Make sure the image fills the avatar container fully */
        li[data-testid="name-credits-list-item"] .ipc-media--avatar,
        li[data-testid="name-credits-list-item"] .ipc-media--avatar-m,
        li[data-testid="name-credits-list-item"] .ipc-avatar__avatar-image,
        li[data-testid="name-credits-list-item"] img.ipc-image {
            width: 100% !important;
            height: 100% !important;
        }

        /* Remove hover overlay that appears on avatars */
        li[data-testid="name-credits-list-item"] .ipc-lockup-overlay,
        li[data-testid="name-credits-list-item"] .ipc-lockup-overlay__screen {
            display: none !important;
        }

        /* Pad the row so text sits to the right of the enlarged image */
        li[data-testid="name-credits-list-item"]
            .ipc-metadata-list-summary-item__tc {
            position: relative !important;
            padding-left: calc(${avatarSizeRem}rem + 1rem) !important;
            min-height: ${avatarSizeRem}rem !important;
        }

        /* Absolutely position the avatar in the row */
        li[data-testid="name-credits-list-item"]
            .ipc-avatar.name-credits--avatar {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
        }

        /* Fix IMDb's flex‑child % widths so text flows naturally */
        li[data-testid="name-credits-list-item"] .sc-4b344583-5.ihLwwk,
        li[data-testid="name-credits-list-item"] .sc-4b344583-3.ioidKJ {
            width: auto !important;
            flex: 1 1 auto !important;
            padding-right: 0.75rem !important;
        }

        /* Allow names to wrap onto multiple lines */
        li[data-testid="name-credits-list-item"] .name-credits--title-text-big {
            white-space: normal !important;
        }

        /* Reinforce size on wide screens (responsive) */
        @media screen and (min-width: 600px) {
            li[data-testid="name-credits-list-item"]
                .ipc-avatar.name-credits--avatar {
                width: ${avatarSizeRem}rem !important;
                height: ${avatarSizeRem}rem !important;
            }
        }
    `);

    // ——— DYNAMIC STYLE APPLICATION & REINFORCEMENT ———
    // The applyStyles function is crucial for two reasons:
    // 1. IMDb's cast list can load more items dynamically (e.g., scrolling, "load more" buttons).
    //    These new elements won't be affected by the initial GM_addStyle injection, so their
    //    styles need to be applied via JavaScript.
    // 2. IMDb's own JavaScript might sometimes override or interfere with our custom styles.
    //    This function re-applies and reinforces our desired styles directly on the elements.
    function applyStyles() {
        // Find each cast member row and update its elements
        document.querySelectorAll('li[data-testid="name-credits-list-item"]').forEach(li => {
            // avatar container element (holds the image)
            const avatar = li.querySelector('.ipc-avatar.name-credits--avatar');
            // media frame inside avatar (may wrap the image)
            const media  = li.querySelector('.ipc-media--avatar, .ipc-media--avatar-m');
            // actual image element
            const img    = li.querySelector('img.ipc-image');
            // row content (text and other info)
            const row    = li.querySelector('.ipc-metadata-list-summary-item__tc');
            // flexible columns for text layout
            const flex1  = li.querySelector('.sc-4b344583-5.ihLwwk');
            const flex2  = li.querySelector('.sc-4b344583-3.ioidKJ');
            // actor name/title
            const title  = li.querySelector('.name-credits--title-text-big');

            // Apply new dimensions and reset styling for avatar container
            if (avatar) Object.assign(avatar.style, {
                width:       `${avatarSizeRem}rem`,
                height:      `${avatarSizeRem}rem`,
                minWidth:    `${avatarSizeRem}rem`,
                flexShrink:  '0',
                margin:      '0',
                borderRadius:'0',
                position:    'absolute', // Place avatar at top-left of row
                top:         '0',
                left:        '0'
            });
            // Ensure media frame fills the avatar container without rounding
            if (media)  Object.assign(media.style, {
                width:  '100%',
                height: '100%',
                borderRadius: '0'
            });
            // Adjust actual image to fit width, preserving aspect ratio
            if (img)    Object.assign(img.style, {
                width:  '100%',
                height: 'auto' // Use 'auto' to preserve image aspect ratio
            });
            // Shift text content right to accommodate enlarged image
            if (row)    Object.assign(row.style, {
                position:    'relative',
                paddingLeft: `calc(${avatarSizeRem}rem + 1rem)`,
                minHeight:   `${avatarSizeRem}rem`
            });
            // Fix flexible columns so text flows naturally
            [flex1, flex2].forEach(el => {
                if (el) Object.assign(el.style, {
                    width:        'auto',
                    flex:         '1 1 auto',
                    paddingRight: '0.75rem'
                });
            });
            // Allow actor names to wrap onto multiple lines
            if (title)  title.style.whiteSpace = 'normal';
        });
    }

    applyStyles(); // Initial style application for already loaded elements
    // Use MutationObserver to re-apply styles when new cast rows are added dynamically (e.g., via AJAX)
    new MutationObserver(applyStyles).observe(document.body, {
        childList: true, // Watch for new child elements
        subtree:   true  // Watch all descendants
    });
})();
