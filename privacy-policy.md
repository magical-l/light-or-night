# Privacy Policy — Don't! Paint it black

**Last updated:** April 2, 2026

## The short version

This extension does not collect, store, or transmit any personal data. Period.

## The slightly longer version

**Don't! Paint it black** is a browser extension that modifies the visual appearance of web pages locally in your browser. Here is exactly what it does and does not do:

### What the extension DOES

- Reads the visual properties (CSS colors, classes, attributes) of the current page to detect if it uses a dark theme
- Modifies CSS styles, HTML attributes, or injects CSS filters locally in your browser to convert dark pages to light
- Analyzes image pixels locally (via HTML Canvas) to determine if images have dark backgrounds
- Stores your per-site preferences (enabled/disabled) in your browser's local storage (`chrome.storage.local`)

### What the extension DOES NOT do

- Collect, store, or transmit any personal information
- Track your browsing history or behavior
- Send any data to external servers — there are no analytics, no telemetry, no phone-home mechanisms
- Access, read, or modify any form data, passwords, cookies, or authentication tokens
- Inject any third-party scripts, ads, or tracking pixels
- Communicate with any remote server whatsoever

### Data storage

The only data stored is your per-site preferences (e.g., "disabled on example.com"), saved locally in your browser via `chrome.storage.local`. This data never leaves your device and is automatically deleted if you uninstall the extension.

### Changes to this policy

If this policy ever changes, the updated version will be published here. Given that the extension has zero network capabilities, it's hard to imagine what would change, but transparency matters.

### Author

Marcin Kleczek — marcin.kleczek@gmail.com

### Contact

If you have questions about this privacy policy, contact the author at marcin.kleczek@gmail.com or open an issue on the project's GitHub repository.
