// ==UserScript==
// @name         IMDB Larger Photos
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Enlarge Actor's Photos on IMDB
// @author       Landmine
// @match        https://*.imdb.com/*
// @match        http://*.imdb.com/*
// @match        https://imdb.com/*
// @match        http://imdb.com/*
// @icon         https://www.imdb.com/favicon.ico
// @grant        none
// @require      http://code.jquery.com/jquery-latest.min.js
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/imdb-larger-photos.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/imdb-larger-photos.js
// ==/UserScript==

(function() {
    'use strict';
    // Set desired dimensions
    var desiredWidth = 300;
    var desiredHeight = Math.round(desiredWidth * 1.375); // Maintain aspect ratio

    $(document).ready(function() {
        // Select images within the cast list
        var castImages = $('.cast_list .primary_photo a img');

        castImages.each(function() {
            // Set the new width and height attributes
            $(this).attr({ width: desiredWidth, height: desiredHeight });

            // Update the 'loadlate' attribute for lazy-loaded images
            if ($(this).attr('loadlate')) {
                $(this).attr('loadlate', function(_, val) {
                    return val.replace('_UX32_', '_UX' + desiredWidth + '_')
                              .replace('_UY44_', '_UY' + desiredHeight + '_')
                              .replace(',32,44', ',' + desiredWidth + ',' + desiredHeight);
                });
            } else {
                // Update the 'src' attribute for images already loaded
                $(this).attr('src', function(_, val) {
                    return val.replace('_UX32_', '_UX' + desiredWidth + '_')
                              .replace('_UY44_', '_UY' + desiredHeight + '_')
                              .replace(',32,44', ',' + desiredWidth + ',' + desiredHeight);
                });
            }
        });
    });
})();
