# Games Lab Website

This repository powers the Games Lab marketing site built with Jekyll. Event scheduling data is now sourced from a shared Google Calendar instead of Google Sheets.

## Updating the event schedule snapshot

1. Ensure Ruby is available (Jekyll already requires it).
2. Run the sync script to download and normalise the calendar feed:
   ```bash
   ruby scripts/sync-events-from-ics.rb
   ```
   The script reads from the public Google Calendar ICS feed defined in `scripts/sync-events-from-ics.rb` or the `GOOGLE_CALENDAR_ICS_URL` environment variable.
3. To test with a local file (for example during development), provide the `GOOGLE_CALENDAR_ICS_FILE` variable:
   ```bash
   GOOGLE_CALENDAR_ICS_FILE=path/to/sample.ics ruby scripts/sync-events-from-ics.rb
   ```
4. Commit the updated `_data/event_schedule.json` file alongside any content changes.

The generated JSON powers:
- The homepage “Upcoming Events” cards (`_includes/cards-upcoming.html`).
- The “Explore Our Other Events” section (`_includes/cards-explore.html`).
- Event detail pages via `_includes/scripts-event-core.html`.

Only the schedule (dates, times, locations) comes from the calendar. Visuals, copy and ticketing details remain authored in the Markdown front matter inside `_events/` (or individual pages in `events/`).

## Gallery data

The gallery still loads from Google Sheets at runtime. No changes are required for gallery editors; only the event schedule moved to the calendar feed.
