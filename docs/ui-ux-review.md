# UI/UX review of the web app (2026-10-12)

A pass over `apps/web` (the Android app shows the same pages) using the **ui-ux-pro-max** rule set, in its order:
accessibility, touch, performance, style, layout, typography and colour, animation, forms, navigation, charts.
Screens checked at 375, 768, 1024 and 1440 px, light and dark. The layout, menus, names, URLs and the forest-green theme
are unchanged. The fixes below only change spacing, contrast, sizes, states and labels.

Each line: rule → where → fix. `[x]` = fixed in this pass, `[ ]` = left on purpose (reason given).

## 1. Accessibility
- [x] Contrast with a brand colour → every screen when a company picks a light brand colour (the demo's `#29b7db`: white
  button text and blue links were 2.4:1) → `lib/brand-colour.ts` keeps the hue but moves the lightness just enough for
  4.5:1 (deeper in light mode, lighter in dark mode); gradients and highlights keep the exact colour. Settings shows a note
  when this happens.
- [x] Contrast of status colours in light mode → green, amber, the Tasks and Admin accents on their light tints were
  3.2–4.0:1 → `packages/theme` light `--success` 0.55→0.50, `--warning` 0.60→0.53, `--app-tasks` 0.60→0.50,
  `--app-admin` 0.60→0.53 (now 4.6–5.5:1; dark mode unchanged; `tokens.native.ts` regenerated).
- [x] White text on red/green buttons in dark mode (3.4:1 / 2.3:1) → those buttons and the bell's count use dark text.
- [x] Sidebar section labels and "Press ? for shortcuts" (3.0–3.5:1, 10 px) → 5.3:1, 11–12 px.
- [x] Placeholders at 70 % muted (3.1:1) → full muted colour (5.9:1).
- [x] Account button initials took a random tone colour on the brand gradient → solid primary with its own text colour.
- [x] Focus was a faint 3 px ring at 25–40 % opacity → a solid 2 px outline in the primary colour on every button, link,
  tab and switch (bright accent inside the dark sidebar); fields keep their primary border.
- [x] Focus hidden under the sticky header / phone bottom bar → `scroll-padding` on the page.
- [x] Sortable table headers did not say their sort → `aria-sort`.
- [x] Menu / More buttons did not say whether the menu is open → `aria-haspopup` + `aria-expanded`.

## 2. Touch and interaction
- [x] Attendance section tabs 32 px, Tasks segmented chips 25–28 px, Assets status chips 34 px, Employees view switch
  30 px, Assets search / pickers / multi-selects 36 px, Assets scan and add buttons 32–36 px with 4 px between → 40–44 px
  on phones, 8 px apart; desktop sizes unchanged.
- [x] Small in-row buttons (Edit, Change roles, Duplicate, Archive, History, Mark…) were 36 px on phones → 40 px;
  "Holding assets" checkbox label → 40 px tall.
- [x] Search "clear" button 36 px on phones → 40 px; Esc-to-clear was lost when a screen passed its own key handler.
- [x] Taps waited for a double-tap check on older phone browsers → `touch-action: manipulation` on controls.
- [ ] Inline text links (e.g. asset names in tables) are under 44 px tall: allowed for links inside text (WCAG 2.5.8).

## 3. Performance
- [x] Progress bars animated `width` → `transform` (no layout per frame).
- [ ] Long lists, lazy pages, lite mode, offline copy: already done in §19.18.

## 4. Style
- [x] **Drop-downs had no arrow**: the select chevron was an SVG data URL with spaces inside a Tailwind class, so it was
  never generated (and it removed the select's card background) → chevron drawn in CSS in the theme's muted colour.
- [x] Gradient name in the Tasks greeting faded to 2.4:1 → solid primary.
- [ ] One icon set (Lucide) already used everywhere; no emoji icons.

## 5. Layout
- [x] Phone content could end under the bottom bar on phones with a gesture bar → bottom padding adds the safe area.
- [x] Toasts covered the phone bottom bar → they sit above it on phones.
- [x] Selected attendance tab could be scrolled off-screen on phones (e.g. "Live team") → the tab row scrolls it into view.
- [x] Tasks home filters had uneven widths on phones → they share the row.
- [x] "Leave left" on Home was cut with "…" → wraps to two lines, full text on hover.
- [ ] No horizontal page scroll found at 375 px on any screen checked.

## 6. Typography and colour
- [x] `text-xs` was 11.25 px on desktop (15 px base) → never under 12 px. The bell's count and mono eyebrows stay small.
- [x] Phone bottom bar labels stay 11 px so "Attendance" fits a 360 px phone (the one exception, like iOS / Material bars).
- [x] Numbers in Team performance and the Attendance dashboard were left-aligned → right-aligned, tabular figures.
- [x] Notification times at 10.5 px → 12 px; account role line 11 → 12 px; count pills 11 → 12 px.

## 7. Animation
- [ ] Reduced motion and lite mode already switch transitions off (§19.14, §19.18); nothing new animates.

## 8. Forms and feedback
- [x] Sign in was greyed out until both fields had text, with no reason given → always pressable; an empty field gets its
  own message and focus; "Caps Lock is on" under the password.
- [x] Notifications panel showed nothing while loading → "Loading notifications…".
- [x] "You cannot open …" had no way forward → "Go to Home" button.
- [x] Toasts were always light in dark mode → follow the theme.
- [ ] Closing a half-filled form sheet does not ask first: needs per-form "dirty" tracking; left for a later pass.

## 9. Navigation
- [ ] Bottom bar has 5 items, Home + sidebar groups, deep links, focus to the page heading: already in place (§19.14).

## 10. Charts
- [x] Bar charts (Team performance, Tasks dashboard by category, Leads per day) had values only on hover → values written
  above each bar (up to 24 bars), 12 px axis text, a text summary for screen readers.
- [x] Score bars were red / amber / green with no key → a key in words under the chart.

## 11. New theme: trust blue + orange (2026-10-12, PLAN.md §19.22)
The forest-green theme above was replaced by the founder's "trust blue + orange" (ui-ux-pro-max palette for a B2B SaaS
HR/workforce dashboard; flat style, glassmorphism rejected for low-end phones). Same screens, names and URLs.
- [x] Colour → every text token reaches 4.5:1 on its surface **and on its own tint** (badges, pills, active menu):
  primary `#2361e9` (5.3 / 4.7 on tint), CTA `#d14400` with white (4.6; the skill's `#EA580C` is 3.6 with white), success
  `#047857` (the suggested `#059669` is 3.8), amber warning `#975d00` (kept apart from the orange CTA); dark mode navy
  surfaces with `#60a5fa` primary and navy text on it (7.4). Brand colours aim at the same levels (5.3:1 / 6:1).
- [x] Primary action → one orange CTA per screen (`Button variant="cta"`): Punch in/out, Check in/out (the due one),
  Add person / task / lead / asset / employee, Apply for leave, Raise ticket, New request / idea / role, Add link.
- [x] Style → no gradients, glows, backdrop blur or hover lifts; one radius scale (6 / 8 / 12 px); three soft shadows.
- [x] Measured → computed contrast of every visible text node, 16 screens + menus/drawer/sign-in, 375 and 1440 px,
  light and dark, default theme and five brand colours: 0 under AA. Fixed on the way: faded weekend headers, picker
  placeholders, zero counts in Delegation, dimmed inactive people rows, stacked tints in the Assets status chips.
- [ ] Sticky table headers: tables scroll sideways inside their own box, so a sticky header would not stick to the page;
  left as is.
