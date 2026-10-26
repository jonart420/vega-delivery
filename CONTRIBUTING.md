# Contributing

Thanks for helping! Bug reports, translations and pull requests are welcome.

- **Issues**: describe what you did, what you expected and what happened (logs without secrets).
- **Pull requests**: one topic per PR; run `npm run lint`, `npm test` and `npm run build` in
  `backend/`. New UI text goes into `backend/messages/en.json` **and** `de.json`.
- **Database changes**: add a new numbered file in `backend/db/migrations/` (never edit applied ones).
- **Translations**: copy `backend/messages/en.json` to a new language file and add the locale to
  `LOCALES` in `backend/lib/i18n-core.ts`.
- Code comments in English; match the style of the surrounding code.

By contributing you agree that your contribution is licensed under AGPL-3.0-only.
