# Proxmox Userscripts

## Proxmox VM Memory Buttons

This script adds quick memory preset buttons and +/- 1 GiB controls to the Proxmox Create VM wizard.

Before installing it:

- Update the `@match` line to point at your Proxmox host.
- Add one `@match` line per server if you manage multiple hosts.
- Keep the matches narrow so the script only runs on the intended Proxmox UI.

Example:

```javascript
// @match        https://proxmox.example.com:8006/*
```

## Planned

The old slider variant was only an empty placeholder file, so it was removed. If a working slider-based version is added later, it should live in this folder next to the buttons script.
