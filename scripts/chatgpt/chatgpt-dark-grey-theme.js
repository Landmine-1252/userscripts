// ==UserScript==
// @name         ChatGPT Dark Grey Theme
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Restores ChatGPT's charcoal dark theme instead of the OLED black theme.
// @author       Landmine
// @match        https://chatgpt.com/*
// @icon         https://chatgpt.com/favicon.ico
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/chatgpt/chatgpt-dark-grey-theme.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/chatgpt/chatgpt-dark-grey-theme.js
// ==/UserScript==

(function () {
    'use strict';

    const STYLE_ID = 'custom-chatgpt-dark-grey-theme';
    const OLED_ATTRIBUTE = 'data-oled';
    const THEME_VARIABLES = {
        '--bg-primary': '#303030',
        '--main-surface-primary': '#212121',
        '--bg-secondary-surface': '#212121',
        '--bg-elevated-secondary': '#161616',
        '--sidebar-surface-primary': '#161616',
    };

    function buildVariableDeclarations() {
        return Object.entries(THEME_VARIABLES)
            .map(([name, value]) => `            ${name}: ${value} !important;`)
            .join('\n');
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const target = document.head || document.documentElement;
        if (!target) {
            document.addEventListener('DOMContentLoaded', installStyle, { once: true });
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
        .dark.dark {
${buildVariableDeclarations()}
        }

        html.dark.dark,
        html.dark :not(:where(.light, .light *)) {
${buildVariableDeclarations()}
        }
        `;

        target.appendChild(style);
    }

    function removeOledTheme() {
        document.documentElement?.removeAttribute(OLED_ATTRIBUTE);
    }

    function observeOledTheme() {
        if (typeof MutationObserver !== 'function' || !document.documentElement) {
            return;
        }

        new MutationObserver(removeOledTheme).observe(document.documentElement, {
            attributeFilter: [OLED_ATTRIBUTE],
            attributes: true,
        });
    }

    installStyle();
    removeOledTheme();
    observeOledTheme();
})();
