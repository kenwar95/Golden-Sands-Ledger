# Golden Sands Trading Ledger — Phase 6.2

This build is specifically designed to bypass stale CSS caching.

## Upload these files to the repository root
- index.html
- app.js
- medieval-v2.css

## Important
You can leave the old `styles.css` in the repository. Phase 6.2 no longer loads it.

The HTML now loads:
`medieval-v2.css?v=62`

That new filename plus query string forces GitHub Pages and the browser to fetch the new medieval stylesheet.
