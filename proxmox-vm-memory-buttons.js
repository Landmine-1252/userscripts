
// ==UserScript==
// @name         Proxmox Quick Memory Buttons
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Add quick memory buttons to the `Create VM` Wizard
// @author       Landmine
// @match        https://10.0.0.100:8006
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Landmine-1252/userscripts/main/proxmox-vm-memory-buttons.js
// @updateURL    https://raw.githubusercontent.com/Landmine-1252/userscripts/main/proxmox-vm-memory-buttons.js
// ==/UserScript==

(function() {
    'use strict';

    // Converts GB to MiB
    function gbToMiB(gb) {
        return gb * 1024;
    }

    // Creates a button element
    function createButton(size) {
        const button = document.createElement('button');
        button.textContent = `${size}GiB`;
        button.style.marginRight = '4px';
        button.onclick = function() {
            const inputField = document.querySelector('input[name="memory"]');
            if (inputField) {
                inputField.value = gbToMiB(size);
                updateInputField(inputField);
            }
        };
        return button;
    }

    // Updates the input field with a new value
    function updateInputField(inputField) {
        inputField.focus();
        inputField.dispatchEvent(new Event('input', { bubbles: true }));
        inputField.dispatchEvent(new Event('change', { bubbles: true }));
        inputField.blur();
    }

    // Increments the memory size by 1024 MiB
    function incrementMemory() {
        const inputField = document.querySelector('input[name="memory"]');
        if (inputField) {
            let currentValue = parseInt(inputField.value) || 0;
            currentValue += 1024; // Increment by 1024 MiB
            inputField.value = currentValue;
            updateInputField(inputField);
        }
    }

    // Decrements the memory size by 1024 MiB, but not below 0
    function decrementMemory() {
        const inputField = document.querySelector('input[name="memory"]');
        if (inputField) {
            let currentValue = parseInt(inputField.value) || 0;
            currentValue = Math.max(0, currentValue - 1024); // Decrement by 1024 MiB, minimum 0
            inputField.value = currentValue;
            updateInputField(inputField);
        }
    }

    // Adds buttons to the panel
    function addButtons(panelBody) {
        const memorySizes = [4, 8, 16, 32, 64];
        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'custom-button-container';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.flexDirection = 'row';
        buttonContainer.style.alignItems = 'center';
        buttonContainer.style.justifyContent = 'flex-start';

        // Add Increment (+1024 MiB) Button
        const incrementButton = document.createElement('button');
        incrementButton.textContent = '+1G';
        incrementButton.style.marginRight = '4px';
        incrementButton.onclick = incrementMemory;
        buttonContainer.appendChild(incrementButton);

        // Add Decrement (-1024 MiB) Button
        const decrementButton = document.createElement('button');
        decrementButton.textContent = '-1G';
        decrementButton.style.marginRight = '4px';
        decrementButton.onclick = decrementMemory;
        buttonContainer.appendChild(decrementButton);

        memorySizes.forEach(size => {
            buttonContainer.appendChild(createButton(size));
        });

        panelBody.appendChild(buttonContainer);
    }

    // Main function to find the memory input and place buttons next to it
    function placeButtons() {
        const labels = document.querySelectorAll('label.x-form-item-label');
        const memoryLabel = Array.from(labels).find(label => label.textContent.includes('Memory (MiB):'));

        if (memoryLabel) {
            const inputFieldContainer = memoryLabel.closest('.x-form-item');
            const panel = inputFieldContainer.closest('.x-panel');

            let panelBody = panel.nextElementSibling.querySelector('.x-panel-body');
            if (!panelBody) {
                panelBody = document.createElement('div');
                panelBody.classList.add('x-panel-body', 'x-panel-body-default');
                panel.nextElementSibling.appendChild(panelBody);
            }

            panel.style.height = 'auto';
            panel.nextElementSibling.style.height = 'auto';
            panelBody.style.height = 'auto';

            if (!panelBody.querySelector('#custom-button-container')) {
                addButtons(panelBody);
            }
        }
    }

    // Use a MutationObserver to listen for changes in the DOM
    const observer = new MutationObserver(mutations => {
        let shouldPlaceButtons = false;

        for (const mutation of mutations) {
            if (mutation.addedNodes.length || mutation.type === 'attributes') {
                shouldPlaceButtons = true;
            }
        }

        if (shouldPlaceButtons) {
            placeButtons();
        }
    });

    observer.observe(document.body, {
        childList: true,
        attributes: true,
        subtree: true,
        attributeFilter: ['style', 'class']
    });

    placeButtons();
})();
