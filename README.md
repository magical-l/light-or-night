# Store Listing: Don't! Paint it black

## Short description (max 132 characters)

Dark pages converted to light automatically. Uses the site's own light theme when there is one; a CSS filter when there isn't.

## Long description

Some websites just love the dark side. Your eyes at 2 PM on a Tuesday respectfully disagree.

**Don't! Paint it black** turns dark pages light — **by itself**, the moment a page loads. No clicking through a menu on every site.

**It tries the polite way first.** If a site ships its own light theme, we find the switch that site itself uses and flip it. Nothing is repainted, nothing is inverted — it is the site's own light mode. That covers Tailwind-style `dark` classes, `data-theme` and `data-bs-theme` attributes, GitHub-style `data-color-mode`, namespaced class names, and anything else whose light counterpart can be found in the page's own stylesheets.

**If a site has no light theme, a filter takes over.** A full-page filter brings the page back to light, with an exactly-inverse counter-filter applied to images, video and canvas — so your photos stay untouched. Toggling the filter off and on again returns every pixel to where it started.

**Verified, not assumed.** After switching, the extension re-measures the page and **rolls back** if nothing actually got lighter — a site is never left half-converted.

**Every site is yours to set.** One global default, plus a per-site override with six modes:

- Off
- Native only
- Quick filter only
- Precise Solarized only
- Native first, else quick filter *(default)*
- Native first, else Precise Solarized

**Features:**

- Automatic — dark pages are converted as soon as they load
- Native-first — prefers the site's own light theme, so nothing is destroyed
- Rolls back when a switch turns out to do nothing
- Per-site exceptions, one click
- One-tap undo — restores the page and stops converting that site
- English and Chinese UI, following your browser language
- No tracking. No accounts. No remote code.

**How it works:**

1. Install it. It is on by default for every site.
2. Visit a dark website — it is already light.
3. Want a site left alone? Open the popup and set that site to *Off*.

Named after the Rolling Stones classic, because some things just shouldn't be painted black.

Made by Marcin Kleczek (marcin.kleczek@gmail.com). MIT License. 28 KB packaged.
