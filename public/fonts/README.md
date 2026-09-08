# Self-hosted fonts

Broadsheet is one typeface: **Source Serif 4**. Nothing here is fetched from a
third-party font host, and the Content-Security-Policy would not permit it if
something tried — `font-src` is `'self'`.

Until the files are here, the stack falls back to Georgia, which is a serif and
holds the design. To ship the intended face:

1. Get the Source Serif 4 WOFF2 files (SIL Open Font License).
2. Drop them in this directory.
3. Add the `@font-face` blocks to `src/app/globals.css`, above the token block:

   ```css
   @font-face {
     font-family: 'Source Serif 4';
     src: url('/fonts/SourceSerif4-Regular.woff2') format('woff2');
     font-weight: 400;
     font-style: normal;
     font-display: swap;
   }
   ```

   Repeat for the 600 weight and the 400 italic — those are the three the
   design uses, and no others.

Weights beyond 400, 600 and true italic 400 are not part of this system.
