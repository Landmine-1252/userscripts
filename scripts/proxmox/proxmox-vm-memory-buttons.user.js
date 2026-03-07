// ==UserScript==
// @name         Proxmox VM Memory Buttons
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Adds quick memory adjustment buttons to the Proxmox Create VM wizard.
// @author       Landmine
// @match        https://10.0.0.100:8006/*
// @icon         https://www.proxmox.com/favicon.ico
// @grant        none
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/proxmox/proxmox-vm-memory-buttons.user.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/scripts/proxmox/proxmox-vm-memory-buttons.user.js
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_CONTAINER_ID = 'userscript-proxmox-memory-buttons';
    const MEMORY_LABEL_TEXT = 'Memory (MiB):';
    const PRESET_SIZES_GIB = [4, 8, 16, 32, 64];

    function gibToMib(gib) {
        return gib * 1024;
    }

    function roundToNearestGiB(mib) {
        return Math.round(mib / 1024) * 1024;
    }

    function isVisible(element) {
        return Boolean(element && element.getClientRects().length);
    }

    function getMemoryField() {
        const labels = Array.from(document.querySelectorAll('label.x-form-item-label'))
            .filter((label) => label.textContent.includes(MEMORY_LABEL_TEXT));
        const memoryLabel = labels.find(isVisible) || labels[0];
        const formItem = memoryLabel?.closest('.x-form-item');
        const input = formItem?.querySelector('input[name="memory"]');

        if (!formItem || !input) {
            return null;
        }

        return { formItem, input };
    }

    function updateInputField(input, nextValue) {
        input.value = String(Math.max(0, nextValue));
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
    }

    function createButton(label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.margin = '0 4px 4px 0';
        button.style.padding = '4px 10px';
        button.style.cursor = 'pointer';

        button.addEventListener('click', (event) => {
            event.preventDefault();
            const field = getMemoryField();
            if (!field) {
                return;
            }

            onClick(field.input);
        });

        return button;
    }

    function buildButtonContainer() {
        const container = document.createElement('div');
        container.id = BUTTON_CONTAINER_ID;
        container.style.display = 'flex';
        container.style.flexWrap = 'wrap';
        container.style.alignItems = 'center';
        container.style.margin = '6px 0 12px 105px';

        container.appendChild(createButton('-1GiB', (input) => {
            const currentValue = Number.parseInt(input.value, 10) || 0;
            updateInputField(input, Math.max(0, roundToNearestGiB(currentValue) - 1024));
        }));

        container.appendChild(createButton('+1GiB', (input) => {
            const currentValue = Number.parseInt(input.value, 10) || 0;
            updateInputField(input, roundToNearestGiB(currentValue) + 1024);
        }));

        PRESET_SIZES_GIB.forEach((size) => {
            container.appendChild(createButton(`${size}GiB`, (input) => {
                updateInputField(input, gibToMib(size));
            }));
        });

        return container;
    }

    function ensureButtons() {
        const field = getMemoryField();
        if (!field) {
            return;
        }

        if (field.formItem.nextElementSibling?.id === BUTTON_CONTAINER_ID) {
            return;
        }

        const detachedContainer = document.getElementById(BUTTON_CONTAINER_ID);
        if (detachedContainer?.parentElement) {
            detachedContainer.remove();
        }

        field.formItem.insertAdjacentElement('afterend', buildButtonContainer());
    }

    let scheduled = false;

    function scheduleEnsureButtons() {
        if (scheduled) {
            return;
        }

        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            ensureButtons();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleEnsureButtons, { once: true });
    } else {
        scheduleEnsureButtons();
    }

    const observerTarget = document.body || document.documentElement;
    if (observerTarget) {
        new MutationObserver(scheduleEnsureButtons).observe(observerTarget, {
            childList: true,
            subtree: true,
        });
    }
})();
