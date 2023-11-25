# userscripts

Some userscripts to make my life a little easier and some websites in my opinion a little better.

## IMDB Larger Photos - imdb-larger-photos.js

Modifies the default small images to a larger size on the IMDB Cast page.

![Screenshot](/images/imdb-larger-photos.png)

## Proxmox VM Memory Buttons - proxmox-vm-memory-buttons.js

Adds quick memory adjustment buttons to the "Create VM" wizard.

### Features

Features

- **Quick Memory Selection:** Adds preset buttons for common memory sizes (4, 8, 16, 32, 64 GiB) for quick selection.
- **Increment/Decrement Buttons:** Includes +1G and -1G buttons to easily adjust the memory in increments or decrements of 1024 MiB.
- **Rounded Adjustments:** Adjusts memory values to the nearest 1024 MiB, ensuring rounded memory configurations for better compatibility.

![Screenshot](/images/proxmox-vm-memory-buttons.png)

### Configuration

The script uses the @match directive to determine which pages it should run on. The current configuration is set to `https://10.0.0.100:8006`, which is specific to a certain Proxmox instance.

Change the @match directive to the URL of your Proxmox server. For example, if your Proxmox server is accessible at `https://proxmox.mydomain.com`, update the line to:

```javascript
// @match        https://proxmox.mydomain.com
```

If you have multiple servers you can add multiple `@match` lines

- Each URL pattern needs its own @match line.
- Patterns should be specific to avoid security risks associated with overly broad matches.

## proxmox-vm-memory-slider.js (WIP)

This is based on `proxmox-vm-memory-buttons.js` but would display the UI to the user as a slider bar like you would see in VMWare Workstation or VirtualBox.

## YouTube Short Redirect - youtube-shorts-redirect.js

YouTube Short links are redirected to normal video links to enable video controls.
