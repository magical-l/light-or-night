# Store Listing: Light or Night

## Short description (max 132 characters)

Turns pages to the light or dark you prefer — the site's own theme, else a color remap or filter. Per-site settings.

## Long description

Some websites just love the dark side. Your eyes at 2 PM on a Tuesday respectfully disagree.

**Light or Night** turns pages to the light or dark you prefer — **by itself**, the moment a page loads. No clicking through a menu on every site. Your preference is one setting (light, dark, or follow your system), and it applies everywhere.

**It tries the polite way first.** If a site ships its own light or dark theme, we find the switch that site itself uses and flip it. Nothing is repainted, nothing is inverted — it is the site's own theme. That covers Tailwind-style `dark` classes, `data-theme` and `data-bs-theme` attributes, GitHub-style `data-color-mode`, namespaced class names, and anything else whose counterpart can be found in the page's own stylesheets.

**If a site has no theme switch, a filter takes over.** A full-page filter flips the page, with an exactly-inverse counter-filter applied to `img`, `video` and `canvas` — so your photos, videos and canvases stay untouched, every time. (A background image set in CSS can't be spared — it flips with the page. If a site's main visual is one of those, use the color remap instead.) Toggling the filter off and on again returns every pixel to where it started.

**And if a filter is not precise enough, there is a color remap.** Instead of filtering the whole page, it goes element by element: a colored surface keeps **its own hue** and is graded into a soft tint, with text on it graded to match — the blue button stays blue, it just becomes a button that fits the page. Neutral surfaces (page, cards, panels) are graded by how light or dark they originally were, so the page keeps its sense of depth. Text is pushed to WCAG AA against whatever it sits on, in both directions.

**Verified, not assumed.** After switching, the extension re-measures the page and **rolls back** if the page did not actually end up in the tone you asked for — a site is never left half-converted.

**Every site is yours to set.** One global default, plus a per-site override with six modes:

- Off
- Native only
- Quick filter only
- Color remap only
- Native first, else quick filter *(default)*
- Native first, else color remap

**Features:**

- Automatic — pages in the other tone are converted as soon as they load
- Follows your system theme by default, or pin light / dark
- Native-first — prefers the site's own theme, so nothing is destroyed
- Rolls back when a switch turns out to do nothing
- Per-site exceptions, one click
- One-tap undo — restores the page and stops converting that site
- English and Chinese UI, following your browser language
- No tracking. No accounts. No remote code.

**How it works:**

1. Install it. It is on by default for every site, following your system theme.
2. Visit a website in the other tone — it is already flipped.
3. Want a different tone, or a site left alone? Open the popup.

Named after the Rolling Stones classic, because some things just shouldn't be painted black.

Made by Marcin Kleczek (marcin.kleczek@gmail.com). MIT License. 42 KB packaged.
