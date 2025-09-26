# Contributing to Games Lab Website

Thanks for helping document or ship new event experiences! This guide lists the front matter schema for files in the `_events/` directory so that homepage cards and individual event pages stay in sync.

## `_events/` front matter schema

Each markdown file in `_events/` should use YAML front matter with the following keys:

### Homepage card fallbacks
These values power the static "Explore our other events" cards when a row is missing from the explore CSV, and also serve as defaults for other homepage callouts.

| Key | Required | Description |
| --- | --- | --- |
| `card_image` | Yes | URL of the 16:9 card art. Used on homepage cards when the spreadsheet omits an image. |
| `card_intro` | Yes | One-line intro or hook shown on card bodies. Also used as SEO description fallback. |
| `card_location_label` | Yes | Short location string (e.g., "Bengaluru • Games Lab"). Displayed on cards when no location is present in the sheet. |

### Hero & detail page content
These keys render the hero section and long-form sections on each event detail page. When a value is missing, the event template falls back to sensible defaults shown below.

| Key | Required | Description |
| --- | --- | --- |
| `banner` | Yes | Main hero image. Used on detail page hero and og:image fallback. |
| `tagline` | Yes | Short hook displayed under the title. |
| `highlights.format` | No | Label in the hero facts panel. Default: `Social deduction`. |
| `highlights.duration` | No | Duration string. Default: `3–4 hours`. |
| `highlights.group_size` | No | Group size detail. Default: `8–25 players`. |
| `highlights.difficulty` | No | Difficulty label. Default: `Beginner-friendly`. |
| `highlights.age` | No | Recommended minimum age. Default: `14+`. |
| `highlights.price` | No | Pricing string. Default: `₹ 350/-`. |
| `ticket_link` | No | URL for tickets or RSVP. Leave blank to hide CTA buttons. |
| `about_video` | No | Embedded YouTube URL shown on the About tab. Leave blank to hide the video section. |
| `recap_videos` | No | Array of YouTube URLs for recap section. |
| `about` | Yes | Markdown block for the first long-form section. |
| `what_makes_it_different` | Yes | Markdown block describing differentiators. |
| `how_it_works` | Yes | Markdown block listing the structure or agenda. |
| `why_join` | Yes | Markdown block outlining benefits. |
| `closing` | Yes | Markdown block for the closing call-to-action. |

## Workflow tips
1. Duplicate an existing file in `_events/` and update the front matter keys listed above.
2. If the event has a published page under `/events/`, make sure `slug` matches that permalink.
3. Leave `ticket_link` empty until the event is scheduled—the floating action button and CTA banner are hidden automatically.

For questions, open an issue or drop the core team a message on Slack.
