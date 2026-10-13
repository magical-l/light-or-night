# Store Listing: Light or Night

## Short description (max 132 characters)

Automatically turns dark pages light — the site's own theme when it has one, else a color remap or filter. Per-site settings.

## Long description

Some websites just love the dark side. Your eyes at 2 PM on a Tuesday respectfully disagree.

**Light or Night** turns dark pages light — **by itself**, the moment a page loads. No clicking through a menu on every site.

**It tries the polite way first.** If a site ships its own light theme, we find the switch that site itself uses and flip it. Nothing is repainted, nothing is inverted — it is the site's own light mode. That covers Tailwind-style `dark` classes, `data-theme` and `data-bs-theme` attributes, GitHub-style `data-color-mode`, namespaced class names, and anything else whose light counterpart can be found in the page's own stylesheets.

**If a site has no light theme, a filter takes over.** A full-page filter brings the page back to light, with an exactly-inverse counter-filter applied to images, video and canvas — so your photos stay untouched. Toggling the filter off and on again returns every pixel to where it started.

**And if a filter is not precise enough, there is a color remap.** Instead of filtering the whole page, it goes element by element: a colored surface keeps **its own hue** and is lightened into a soft tint, with text on it darkened to match — the blue button stays blue, it just becomes a light-mode blue button. Neutral dark surfaces (page, cards, panels) come out as a cream base, graded by how dark they originally were so the page keeps its sense of depth. Text is pushed to WCAG AA against whatever it sits on.

**Verified, not assumed.** After switching, the extension re-measures the page and **rolls back** if nothing actually got lighter — a site is never left half-converted.

**Every site is yours to set.** One global default, plus a per-site override with six modes:

- Off
- Native only
- Quick filter only
- Color remap only
- Native first, else quick filter *(default)*
- Native first, else color remap

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

Made by Marcin Kleczek (marcin.kleczek@gmail.com). MIT License. 32 KB packaged.
