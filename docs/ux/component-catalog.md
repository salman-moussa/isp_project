# Orvex ISP component catalog

## Scope

The executable Phase-B reference lives in `packages/ui/src/catalog`. It composes existing `@isp/ui`
primitives and semantic tokens into one bilingual English/Arabic surface. It is intentionally a
reference fixture, not an application route, a live tenant view, or evidence that production
authorization and audit controls have run.

No standalone catalog app was added. The reference remains inside `@isp/ui`, which directly owns its
catalog test and build dependencies at the same pinned versions used by the web applications. The
package exposes explicit `test:catalog` and `build:catalog` scripts. A future browser harness can
import `ComponentCatalog` after the owning team chooses its route and deployment boundary.

## Implemented reference matrix

| Reference area       | Executable behavior                                                                                                                                   | Risk addressed                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Task navigation      | Named navigation landmark, real anchors, visible and programmatic current-page state                                                                  | Active location is not color-only                                       |
| Data table           | Caption, scoped column and row headers, labelled overflow region                                                                                      | Dense records retain relationships                                      |
| Compact record list  | Deliberate narrow-layout list with status, money, and action per record                                                                               | Meaning is not lost by squeezed columns                                 |
| Money pair           | USD and LBP remain visibly separate; numeric runs remain LTR in Arabic                                                                                | No blended or directionally ambiguous amount                            |
| Status and callout   | Text accompanies every semantic tone; reference-data disclosure is persistent                                                                         | Color is not the sole signal; fixtures cannot be mistaken for live data |
| Approval and support | Impact, reason, approval state, ticket, scope, expiry, and audit label remain visible; operational actions are disabled with visible reasons          | Sensitive context is not reduced to a generic or misleading button      |
| Audit timeline       | Ordered event examples include actor/context, reference, outcome, and explicit Asia/Beirut label                                                      | Events have readable evidence context without claiming persistence      |
| Operational states   | Loading, empty, safe-read error, and permission denial; safe fixture reads return live feedback, while escalation is visibly disabled                 | Uncertain writes are not described as failed or safe to repeat          |
| Keyboard and focus   | Skip link programmatically focuses the labelled main region; native controls, document order, heading focus, and a focusable labelled overflow region | Keyboard users receive predictable location and focus                   |
| Reduced motion       | Catalog and shared motion collapse to a single near-zero-duration iteration                                                                           | Sustained decorative motion is suppressed                               |
| RTL                  | Root language/direction change, logical CSS properties, stable technical and currency tokens                                                          | Arabic mirrors layout without reordering identifiers or values          |

## Copy and fixture rules

- All user-facing prose is in the typed `catalogCopy.en` and `catalogCopy.ar` objects.
- Section numbers, record/reference identifiers, times, `APV-DEMO`, `AUD-DEMO`, `CATALOG-DEMO`,
  `finance.approve`, `USD`, `LBP`, numeric amounts, and `Asia/Beirut` are rendered in explicit
  `bdi[dir="ltr"]` boundaries in both locales.
- Names, balances, workflow outcomes, support context, and audit events are fictional component
  fixtures. They must not be reused as seed data or production acceptance evidence.
- Error retry copy is limited to a read-only example. The catalog never says an uncertain financial
  write is safe to repeat.

## Automated evidence

The catalog tests cover both English/LTR and Arabic/RTL with axe-core, preserve state/context during
locale switching, verify table/list/overflow semantics, assert separate LTR currency runs and
technical-token isolation, exercise programmatic skip focus and fixture feedback, verify unavailable
actions, and inspect the responsive/reduced-motion/forced-colors stylesheet contract.

On 2026-08-11, the scoped catalog suite completed with 2 test files and 9 tests passing; the catalog
library build also completed with Vite 6.4.3. Lint, typecheck, and scoped Prettier checks passed in
the same validation run. This is automated source evidence only, not browser or assistive-technology
release acceptance.

Run from the repository root:

```text
npm run test:catalog --workspace=@isp/ui
npm run build:catalog --workspace=@isp/ui
npm run typecheck --workspace=@isp/ui
npm run lint --workspace=@isp/ui
npx prettier --check packages/ui/src/catalog packages/ui/package.json docs/ux/component-catalog.md docs/ux/visual-quality-scorecard.md
```

An axe/jsdom pass does not verify computed color contrast, layout, visibility under CSS breakpoints,
or assistive-technology announcements in a real browser.

## Browser and assistive-technology release evidence still required

- Capture English and Arabic at 320, 768, 1024, and 1440 CSS px.
- Review reflow at 200% and 400% zoom, including long Arabic text and the table-to-list transition.
- Complete keyboard-only traversal in Chrome or Firefox and verify focus visibility and skip-link
  landing.
- Run axe in the rendered browser and check computed contrast for text, focus, badges, and callouts.
- Verify `prefers-reduced-motion` and Windows forced-colors behavior.
- Complete NVDA + Chrome reading-order/table checks; VoiceOver + Safari remains required if Safari
  is in the supported release matrix.

These are residual release gates. This catalog does not claim they passed.
