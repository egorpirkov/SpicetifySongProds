# Changelog

## 1.0.0
- Initial stable release.
- Added localization (i18n) for English and Russian.
- Introduced strict matching (Levenshtein distance) to prevent false positives for track titles and artists.
- Added options for custom Proxy URL to avoid CORS errors with Genius API.
- Re-architected caching and throttling.
- Upgraded DOM resilience with fallback selectors and debounced observer.
- Fully implemented extension lifecycle management and cleanup.
- Refined Settings UI with new configurations (Enable, Language, Disable on Local files).
