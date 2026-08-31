# Jordnær availability CLI

A small, dependency-free, read-only CLI that checks Restaurant Jordnær's
public availability on Superb. It does not log in, hold a table, join a wait
list, or make a reservation.

## Requirements

- Node.js 20 or newer

## Usage

Run it directly from this repository:

```sh
node bin/jordnaer-availability.js
```

The default checks availability for two guests from today through Jordnær's
current booking horizon and prints up to ten dates with concrete time slots.

```sh
node bin/jordnaer-availability.js --guests 4
node bin/jordnaer-availability.js --from 2026-09-01 --to 2026-10-31
node bin/jordnaer-availability.js --days thu,fri
node bin/jordnaer-availability.js --days torsdag,fredag
node bin/jordnaer-availability.js --guests 2 --limit 1 --json
```

Use `--days` (or `-d`) to restrict results to particular weekdays. It accepts
comma-separated English or Danish names and common abbreviations. For example,
`--days thu,fri,sat` checks only Thursdays, Fridays, and Saturdays.

For a shell command named `jordnaer-availability`, link the package locally:

```sh
npm link
jordnaer-availability --guests 2
```

## Exit codes

- `0`: at least one available date was found
- `1`: the check succeeded, but no availability was found
- `2`: invalid arguments or a request failed

These codes make the CLI useful from cron or another monitoring process. JSON
output is available with `--json`.

## Notes

The checker follows the same public, read-only requests used by Superb's web
booking page. Superb can change that interface at any time. The web-client
compatibility key can be overridden with `SUPERB_WEB_CHALLENGE_KEY` if Superb
rotates it.

Keep automated checks infrequent and comply with Superb's and Jordnær's terms.
The CLI deliberately does not automate booking or bypass booking CAPTCHA.

## Development

```sh
npm test
npm run check
```
