# Landing, languages and carousel notes

Moved out of the main README.

## Languages

The landing is available in Spanish at `/` and in English at `/en/`, with an ES/EN selector in the header. The language
chosen there (or with `?lang=en`) is kept in the `verifireLang` cookie, because the other screens have a single route:
the buyer panel (`/app`) and the public pages `/verify` and `/batch` read it and answer in that language, as do their
dates and the document's `lang`.

- `src/i18n/landing.ts` holds the interface texts in both languages, including the accessible names of the controls. When adding a key, fill in both translations.
- `src/i18n/technical-landing.ts` holds the two-factor hero, the sample auditor, the five use cases and the integration docs in ES/EN.
- `src/i18n/consumer.ts` holds the buyer panel and `src/i18n/verify.ts` the public pages behind the printed QRs.
- `src/components/landing/content.ts` holds the examples and texts in Spanish; `src/i18n/landing-content.ts` gathers their English translations.
- Store sample dates as `YYYY-MM-DD`; the interface presents them with `Intl.DateTimeFormat` in the route's language.
- `UseCaseCarousel.tsx` uses `useCaseRotation.ts` to rotate watches, perfume, wine, auto parts and cosmetics every 4000 ms. It has previous/next arrows, keyboard navigation and five fixed-width indicators. `CaseSpecifications.tsx` presents the batch and the technical details of each example. `landing-motion.css` combines a 600 ms crossfade with a 1.05 → 1 scale on enter and 1 → 0.95 on exit, with a `cubic-bezier(.16, 1, .3, 1)` curve. Texts enter 75 ms later, over 550 ms. Panels share one grid cell to reserve the tallest one's height and avoid layout shifts. The bar uses a persistent 4000 ms linear animation: it pauses and resumes without being recreated and keeps its fill when it fades after a manual change. With reduced motion, movement and its delays are skipped, but products keep rotating. Hidden tabs suspend the timer until the page is visible again.
- The industry carousel keeps the remaining time while the mouse is over the card, a finger stays down, the keyboard is used or the history is open. Moving the mouse away, lifting the finger, removing focus or closing the history resumes it. Clicking an indicator with the mouse or a short tap does not leave playback paused.
- If Windows or the browser asks for reduced motion, the carousel uses a 350 ms fade without zoom or movement. This local exception keeps the global 0.01 ms rule from turning the change into an instant cut; it does not change the system preference.
- `AuditWidget.tsx` keeps Pulse ANC (VF-1043) fixed and independent of the carousel. Its only local state selects which QR to inspect; visual connectors tell the outer label from the inner seal. It presents illustrative data, without querying or simulating a real connection. Per-operation costs are not shown as a fixed dollar fee.
- Tailwind is integrated through Vite, with `tw:` utilities and no Preflight, to keep the rest of the app's CSS intact. Tokens, batch codes, internal routes and product identifiers are not translated.
