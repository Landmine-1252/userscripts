// ==UserScript==
// @name         IMDB Larger Photos
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Enlarges real credit photos on IMDb full credits pages and opens larger photos in-page.
// @author       Landmine
// @match        https://www.imdb.com/title/*/fullcredits*
// @icon         https://www.imdb.com/favicon.ico
// @grant        GM_addStyle
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/refs/heads/main/scripts/imdb/imdb-larger-photos.user.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/refs/heads/main/scripts/imdb/imdb-larger-photos.user.js
// ==/UserScript==

(function () {
    'use strict';

    const AVATAR_SIZE_REM = 15;
    const AVATAR_GAP_REM = 1;
    const PHOTO_URL_ATTRIBUTE = 'data-landmine-imdb-photo-url';
    const PHOTO_FALLBACK_URL_ATTRIBUTE = 'data-landmine-imdb-photo-fallback-url';
    const MODAL_ID = 'landmine-imdb-photo-modal';
    const ITEM_CLASS = 'landmine-imdb-large-photo-item';
    const CONTENT_CLASS = 'landmine-imdb-large-photo-content';
    const LAYOUT_CLASS = 'landmine-imdb-large-photo-layout';
    const PHOTO_COLUMN_CLASS = 'landmine-imdb-large-photo-column';
    const DETAILS_COLUMN_CLASS = 'landmine-imdb-credit-details';
    const LIST_ITEM_SELECTOR = 'li[data-testid="name-credits-list-item"]';

    GM_addStyle(`
        ${LIST_ITEM_SELECTOR} .ipc-metadata-list-summary-item__t.ipc-btn--not-interactable {
            display: none !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .${CONTENT_CLASS} {
            min-height: ${AVATAR_SIZE_REM}rem !important;
            padding-left: 0 !important;
            position: relative !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .${LAYOUT_CLASS} {
            align-items: start !important;
            display: grid !important;
            gap: ${AVATAR_GAP_REM}rem !important;
            grid-template-columns: ${AVATAR_SIZE_REM}rem minmax(0, 1fr) !important;
            width: 100% !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .${PHOTO_COLUMN_CLASS} {
            align-items: stretch !important;
            display: flex !important;
            flex: 0 0 ${AVATAR_SIZE_REM}rem !important;
            flex-direction: column !important;
            gap: 0.5rem !important;
            min-width: 0 !important;
            padding-right: 0 !important;
            width: ${AVATAR_SIZE_REM}rem !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .${DETAILS_COLUMN_CLASS} {
            align-self: start !important;
            align-items: baseline !important;
            display: grid !important;
            gap: 0.75rem !important;
            grid-template-columns: minmax(10rem, 18rem) minmax(0, 1fr) !important;
            min-width: 0 !important;
            padding-right: 0.75rem !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-avatar.name-credits--avatar {
            width: ${AVATAR_SIZE_REM}rem !important;
            height: ${AVATAR_SIZE_REM}rem !important;
            min-width: ${AVATAR_SIZE_REM}rem !important;
            flex-shrink: 0 !important;
            margin: 0 !important;
            border-radius: 0 !important;
            overflow: hidden !important;
            position: relative !important;
            top: auto !important;
            left: auto !important;
            cursor: zoom-in !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-media.ipc-media--circle-radius,
        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-media.ipc-media--circle-radius ~ .ipc-lockup-overlay {
            border-radius: 0 !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-media--avatar,
        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-media--avatar-m,
        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-avatar__avatar-image,
        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} img.ipc-image {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-lockup-overlay,
        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-lockup-overlay__screen {
            display: none !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .${PHOTO_COLUMN_CLASS} .name-credits--title-text-big {
            display: none !important;
        }

        ${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .name-credits--title-text-small {
            display: inline !important;
            line-height: 1.25 !important;
            margin-top: 0 !important;
            overflow-wrap: anywhere !important;
            text-align: left !important;
            white-space: normal !important;
        }

        #${MODAL_ID}[hidden] {
            display: none !important;
        }

        #${MODAL_ID} {
            align-items: center !important;
            background: rgba(0, 0, 0, 0.88) !important;
            box-sizing: border-box !important;
            display: flex !important;
            inset: 0 !important;
            justify-content: center !important;
            padding: 2rem !important;
            position: fixed !important;
            z-index: 2147483647 !important;
        }

        #${MODAL_ID} .landmine-imdb-photo-modal__content {
            align-items: center !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 0.75rem !important;
            max-height: 96vh !important;
            max-width: 96vw !important;
            position: relative !important;
        }

        #${MODAL_ID} .landmine-imdb-photo-modal__image {
            background: #111 !important;
            box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.5) !important;
            max-height: 88vh !important;
            max-width: 94vw !important;
            object-fit: contain !important;
        }

        #${MODAL_ID} .landmine-imdb-photo-modal__caption {
            color: #fff !important;
            font: 600 1rem/1.35 Arial, sans-serif !important;
            max-width: 94vw !important;
            overflow-wrap: anywhere !important;
            text-align: center !important;
        }

        #${MODAL_ID} .landmine-imdb-photo-modal__close {
            appearance: none !important;
            background: #fff !important;
            border: 0 !important;
            border-radius: 0.25rem !important;
            color: #111 !important;
            cursor: pointer !important;
            font: 700 0.875rem/1 Arial, sans-serif !important;
            padding: 0.5rem 0.75rem !important;
            position: absolute !important;
            right: 0 !important;
            top: 0 !important;
            transform: translateY(calc(-100% - 0.5rem)) !important;
        }
    `);

    function addClass(element, className) {
        if (element) {
            element.classList.add(className);
        }
    }

    function clearStyles(element, properties) {
        if (!element) {
            return;
        }

        properties.forEach((property) => {
            element.style[property] = '';
        });
    }

    function removeManagedLayout(listItem, content, title, smallTitle) {
        listItem.classList.remove(ITEM_CLASS);

        listItem.querySelectorAll([
            `.${CONTENT_CLASS}`,
            `.${LAYOUT_CLASS}`,
            `.${PHOTO_COLUMN_CLASS}`,
            `.${DETAILS_COLUMN_CLASS}`,
        ].join(',')).forEach((element) => {
            element.classList.remove(
                CONTENT_CLASS,
                LAYOUT_CLASS,
                PHOTO_COLUMN_CLASS,
                DETAILS_COLUMN_CLASS,
            );
        });

        clearStyles(content, ['position', 'paddingLeft', 'minHeight']);
        Array.from(content?.children || []).forEach((child) => {
            clearStyles(child, ['width', 'flex', 'paddingRight']);
        });
        clearStyles(title, [
            'display',
            'lineHeight',
            'marginTop',
            'overflowWrap',
            'textAlign',
            'whiteSpace',
            'width',
        ]);
        clearStyles(smallTitle, [
            'display',
            'lineHeight',
            'marginTop',
            'overflowWrap',
            'textAlign',
            'whiteSpace',
        ]);
    }

    function hasUsablePhoto(avatar, image) {
        return Boolean(avatar && image && (image.currentSrc || image.src || image.srcset));
    }

    function getPhotoColumn(listItem, avatar, title) {
        const existingPhotoColumn = listItem.querySelector(`.${PHOTO_COLUMN_CLASS}`);
        if (existingPhotoColumn) {
            return existingPhotoColumn;
        }

        if (!avatar) {
            return null;
        }

        if (avatar && title && avatar.parentElement?.parentElement === title.parentElement) {
            return title.parentElement;
        }

        return avatar.parentElement || null;
    }

    function getDetailsColumn(layout, photoColumn, smallTitle) {
        if (smallTitle?.parentElement) {
            return smallTitle.parentElement;
        }

        return Array.from(layout?.children || []).find((child) => child !== photoColumn) || null;
    }

    function getBestSrcsetUrl(image) {
        const candidates = [];
        const srcset = image.getAttribute('srcset') || '';
        for (const match of srcset.matchAll(/(\S+)\s+(\d+)w/g)) {
            candidates.push({
                url: match[1],
                width: Number.parseInt(match[2], 10) || 0,
            });
        }

        candidates.sort((left, right) => right.width - left.width);
        return candidates[0]?.url || null;
    }

    function getOriginalImageUrl(urlString) {
        if (!urlString) {
            return null;
        }

        try {
            const url = new URL(urlString, window.location.href);
            if (url.hostname.endsWith('media-amazon.com')) {
                url.pathname = url.pathname.replace(
                    /\._V1_[^/]*_\.(jpe?g|png|webp)$/i,
                    '._V1_.$1',
                );
            }

            return url.toString();
        } catch {
            return urlString;
        }
    }

    function getPhotoUrls(image) {
        const fallbackUrl = getBestSrcsetUrl(image) || image.currentSrc || image.src;
        return {
            fallbackUrl,
            photoUrl: getOriginalImageUrl(fallbackUrl),
        };
    }

    function getNameText(listItem, image) {
        return listItem.querySelector('.name-credits--title-text-big')?.textContent.trim()
            || image.alt
            || 'IMDb photo';
    }

    function styleListItem(listItem) {
        const avatar = listItem.querySelector('.ipc-avatar.name-credits--avatar');
        const media = listItem.querySelector('.ipc-media--avatar, .ipc-media--avatar-m');
        const image = listItem.querySelector('img.ipc-image');
        const content = listItem.querySelector('.ipc-metadata-list-summary-item__tc');
        const title = listItem.querySelector('.name-credits--title-text-big');
        const smallTitle = listItem.querySelector('.name-credits--title-text-small');

        if (!hasUsablePhoto(avatar, image)) {
            removeManagedLayout(listItem, content, title, smallTitle);
            return;
        }

        const photoColumn = getPhotoColumn(listItem, avatar, title);
        const layout = photoColumn?.parentElement || null;
        const detailsColumn = getDetailsColumn(layout, photoColumn, smallTitle);

        addClass(listItem, ITEM_CLASS);
        addClass(content, CONTENT_CLASS);
        addClass(layout, LAYOUT_CLASS);
        addClass(photoColumn, PHOTO_COLUMN_CLASS);
        addClass(detailsColumn, DETAILS_COLUMN_CLASS);

        if (avatar) {
            const { fallbackUrl, photoUrl } = getPhotoUrls(image);

            Object.assign(avatar.style, {
                width: `${AVATAR_SIZE_REM}rem`,
                height: `${AVATAR_SIZE_REM}rem`,
                minWidth: `${AVATAR_SIZE_REM}rem`,
                flexShrink: '0',
                margin: '0',
                borderRadius: '0',
                overflow: 'hidden',
                position: 'relative',
                top: 'auto',
                left: 'auto',
                cursor: 'zoom-in',
            });
            avatar.tabIndex = 0;
            avatar.setAttribute('aria-label', `Open larger photo for ${getNameText(listItem, image)}`);
            avatar.setAttribute(PHOTO_URL_ATTRIBUTE, photoUrl);
            avatar.setAttribute(PHOTO_FALLBACK_URL_ATTRIBUTE, fallbackUrl);
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
            image.sizes = `${AVATAR_SIZE_REM}rem`;
        }

        if (content) {
            Object.assign(content.style, {
                position: 'relative',
                paddingLeft: '0',
                minHeight: `${AVATAR_SIZE_REM}rem`,
            });
        }

        if (title) {
            Object.assign(title.style, {
                display: 'none',
                lineHeight: '1.25',
                marginTop: '0',
                overflowWrap: 'anywhere',
                textAlign: 'left',
                whiteSpace: 'normal',
                width: '100%',
            });
        }

        if (smallTitle) {
            Object.assign(smallTitle.style, {
                display: 'inline',
                lineHeight: '1.25',
                marginTop: '0',
                overflowWrap: 'anywhere',
                textAlign: 'left',
                whiteSpace: 'normal',
            });
        }
    }

    function getModal() {
        const existingModal = document.getElementById(MODAL_ID);
        if (existingModal) {
            return existingModal;
        }

        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.hidden = true;
        modal.innerHTML = `
            <div class="landmine-imdb-photo-modal__content" role="dialog" aria-modal="true">
                <button class="landmine-imdb-photo-modal__close" type="button">Close</button>
                <img class="landmine-imdb-photo-modal__image" alt="">
                <div class="landmine-imdb-photo-modal__caption"></div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (event) => {
            if (
                event.target === modal
                || event.target.closest('.landmine-imdb-photo-modal__close')
            ) {
                closeModal();
            }
        });

        return modal;
    }

    function closeModal() {
        const modal = document.getElementById(MODAL_ID);
        if (!modal) {
            return;
        }

        modal.hidden = true;
        const image = modal.querySelector('.landmine-imdb-photo-modal__image');
        image.removeAttribute('src');
        image.removeAttribute('data-fallback-url');
        image.onerror = null;
    }

    function openModal(photoUrl, fallbackUrl, captionText) {
        const modal = getModal();
        const image = modal.querySelector('.landmine-imdb-photo-modal__image');
        const caption = modal.querySelector('.landmine-imdb-photo-modal__caption');

        image.alt = captionText;
        image.dataset.fallbackUrl = fallbackUrl;
        image.onerror = () => {
            if (fallbackUrl && image.src !== fallbackUrl) {
                image.src = fallbackUrl;
            }
        };
        image.src = photoUrl;
        caption.textContent = captionText;
        modal.hidden = false;
        modal.querySelector('.landmine-imdb-photo-modal__close').focus();
    }

    function openAvatarPhoto(avatar) {
        const image = avatar.querySelector('img.ipc-image');
        const listItem = avatar.closest(LIST_ITEM_SELECTOR);
        if (!image || !listItem) {
            return false;
        }

        const photoUrl = avatar.getAttribute(PHOTO_URL_ATTRIBUTE);
        const fallbackUrl = avatar.getAttribute(PHOTO_FALLBACK_URL_ATTRIBUTE);
        if (!photoUrl) {
            return false;
        }

        openModal(photoUrl, fallbackUrl, getNameText(listItem, image));
        return true;
    }

    function handlePhotoClick(event) {
        const avatar = event.target.closest?.(`${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-avatar.name-credits--avatar`);
        if (!avatar || !openAvatarPhoto(avatar)) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            closeModal();
            return;
        }

        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const avatar = event.target.closest?.(`${LIST_ITEM_SELECTOR}.${ITEM_CLASS} .ipc-avatar.name-credits--avatar`);
        if (!avatar || !openAvatarPhoto(avatar)) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
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

    document.addEventListener('click', handlePhotoClick, true);
    document.addEventListener('keydown', handleKeydown, true);

    const observerTarget = document.body || document.documentElement;
    if (observerTarget) {
        new MutationObserver(scheduleApplyStyles).observe(observerTarget, {
            childList: true,
            subtree: true,
        });
    }
})();
