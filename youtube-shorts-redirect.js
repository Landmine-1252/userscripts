// ==UserScript==
// @name         YouTube Short Redirect
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  YouTube Short links are redirected to normal video links
// @author       Landmine
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
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