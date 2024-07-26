// ==UserScript==
// @name         Load Reddit Images Directly
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Loads reddit images directly instead of referring to the HTML page containing the image.
// @match        *://www.reddit.com/r/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/reddit-load-images-directly.js
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/reddit-load-images-directly.js
// ==/UserScript==

(function() {
    'use strict';

    // Function to handle web requests (from background.js)
    function redirectImageRequests(details) {
        const url = new URL(details.url);
        if (url.hostname === 'www.reddit.com' && url.pathname.includes('/comments/')) {
            url.hostname = 'i.redd.it';
            return {redirectUrl: url.href};
        }
        return {};
    }

    // Add event listener for web requests (simulated for userscripts)
    if (typeof browser !== 'undefined' && browser.webRequest && browser.webRequest.onBeforeRequest) {
        browser.webRequest.onBeforeRequest.addListener(
            redirectImageRequests,
            {urls: ['*://www.reddit.com/r/*']},
            ['blocking']
        );
    }

    // Code from content.js
    document.addEventListener('DOMContentLoaded', function() {
        const images = document.querySelectorAll('img[src*="preview.redd.it"], img[src*="external-preview.redd.it"], img[src*="preview.redd.it"]');
        images.forEach(img => {
            const newSrc = img.src.replace('preview.redd.it', 'i.redd.it').replace('external-preview.redd.it', 'i.redd.it');
            img.src = newSrc;
        });
    });

    // Simulate popup settings (if needed)
    const settings = {
        redirectToOriginalImage: true,
        useOldAccept: false,
        disableLightbox: true
    };

    // Apply settings (if needed)
    if (settings.redirectToOriginalImage) {
        // Additional logic to handle settings
    }

})();
