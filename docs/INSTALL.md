# Installing These Userscripts

These scripts are meant for a userscript manager such as Tampermonkey, Violentmonkey, or Greasemonkey.

## Basic Install Flow

1. Install a userscript manager in your browser.
2. Open the raw `.user.js` URL for the script you want.
3. Review the requested matches and permissions before confirming the install.

## Updating

- Each script includes `@downloadURL` and `@updateURL` metadata that points at its raw GitHub path.
- If you fork or rename the repo, update those metadata lines so automatic updates keep working.

## Local Or Private Services

Some scripts target private infrastructure and need local configuration before install.

### Proxmox

- Edit the `@match` line in [scripts/proxmox/proxmox-vm-memory-buttons.user.js](../scripts/proxmox/proxmox-vm-memory-buttons.user.js) so it matches your Proxmox host.
- If you have multiple Proxmox servers, add one `@match` line per host.
- Keep the match specific to the actual host instead of using a broad wildcard.

Example:

```javascript
// @match        https://proxmox.example.com:8006/*
// @match        https://lab-proxmox.internal:8006/*
```
