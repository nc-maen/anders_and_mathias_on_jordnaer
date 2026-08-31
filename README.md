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

## Render cron job with SMS alerts

The included `render.yaml` defines a Render cron job that checks every 30
minutes for a table for two on Fridays or Saturdays. Most runs are silent. The
notification schedule is:

- one SMS when a newly deployed Git commit runs for the first time
- one SMS on the first positive availability result, after which alerts pause
- one weekly SMS heartbeat showing whether alerts are armed or paused
- operational failures recorded in the Render logs only

Reply `ARM` to the Twilio sender after an availability alert to resume alerts.
`REARM` and `RESUME` work too. The next positive result sends one more SMS and
pauses alerts again. This latch prevents a still-available table from producing
an SMS every 30 minutes.

Create a Blueprint in Render from this repository. During the initial setup,
Render prompts for these secret environment variables:

- `TWILIO_ACCOUNT_SID`: the Account SID from the Twilio Console
- `TWILIO_AUTH_TOKEN`: the corresponding Twilio auth token
- `TWILIO_FROM_NUMBER`: a reply-capable Twilio SMS number in E.164 format
- `TWILIO_TO_NUMBER`: the destination number in E.164 format

For example, a Danish number uses a value such as `+4512345678`. Twilio trial
accounts can send only to verified destination numbers. If the account uses a
Twilio Messaging Service instead of a fixed sender, remove
`TWILIO_FROM_NUMBER` from `render.yaml` and add
`TWILIO_MESSAGING_SERVICE_SID` instead. Its sender pool must select a number
that can receive your `ARM` reply.

Render schedules use UTC. The configured `*/30 * * * *` schedule runs on the
hour and half-hour. The monitor derives its deployment, heartbeat, and latch
state from Twilio's message history, so it needs no persistent Render disk or
database.

After creating the cron job, open its **Settings > Notifications** in the
Render Dashboard and set the service override to **None**. This is important if
your workspace has notifications enabled by default. Superb or Twilio failures
will still fail the run and remain visible in the Render logs.

You can test the complete monitor locally after exporting the four Twilio
variables:

```sh
npm run monitor
```

## Development

```sh
npm test
npm run check
```
