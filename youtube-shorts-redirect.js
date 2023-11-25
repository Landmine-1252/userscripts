// ==UserScript==
// @name         YouTube Short Redirect
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  YouTube Short links are redirected to normal video links
// @author       Landmine
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/youtube-shorts-redirect.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/youtube-shorts-redirect.js
// ==/UserScript==

(function() {
    'use strict';

    const observer = new MutationObserver(mutations => {
        mutations.forEach(() => {
            if (window.location.href.includes("/shorts/")) {
                let url = window.location.href.replace('/shorts/', '/watch?v=');
                window.location.href = url;
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();