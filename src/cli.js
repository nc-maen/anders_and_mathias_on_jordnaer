import { parseArgs } from "node:util";
import { SuperbClient, SuperbError } from "./superb-client.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAY_ALIASES = new Map([
  ["sun", 0],
  ["sunday", 0],
  ["son", 0],
  ["sondag", 0],
  ["mon", 1],
  ["monday", 1],
  ["man", 1],
  ["mandag", 1],
  ["tue", 2],
  ["tues", 2],
  ["tuesday", 2],
  ["tir", 2],
  ["tirsdag", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["ons", 3],
  ["onsdag", 3],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["thursday", 4],
  ["tor", 4],
  ["torsdag", 4],
  ["fri", 5],
  ["friday", 5],
  ["fre", 5],
  ["fredag", 5],
  ["sat", 6],
  ["saturday", 6],
  ["lor", 6],
  ["lordag", 6],
]);

export async function run(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    client = new SuperbClient(),
    now = new Date(),
  } = {},
) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    stderr.write(`Error: ${error.message}\n\n${helpText()}`);
    return 2;
  }

  if (options.help) {
    stdout.write(helpText());
    return 0;
  }

  try {
    const { restaurant } = await client.initialize();
    const timezone = restaurant.timezone || "Europe/Copenhagen";
    const today = dateInTimezone(now, timezone);
    const from = options.from || today;
    const to = options.to || addDays(today, restaurant.maxNotice || 180);

    validateDateRange(from, to);

    const guestRange = await client.guestRange();
    if (options.guests < guestRange.min || options.guests > guestRange.max) {
      throw new CliUsageError(
        `Jordnær currently accepts ${guestRange.min}–${guestRange.max} guests`,
      );
    }

    const availability = await client.findAvailability({
      guests: options.guests,
      from,
      to,
      limit: options.limit,
      days: options.days,
    });
    const result = {
      checkedAt: new Date().toISOString(),
      restaurant: restaurant.name,
      timezone,
      guests: options.guests,
      from,
      to,
      days: options.days?.map((day) => WEEKDAY_NAMES[day]) || null,
      availability,
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printHuman(result, stdout);
    }

    return availability.length > 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof CliUsageError) {
      stderr.write(`Error: ${error.message}\n`);
      return 2;
    }
    if (error instanceof SuperbError) {
      stderr.write(`${error.message}\n`);
      return 2;
    }
    stderr.write(`Unexpected error: ${error.message}\n`);
    return 2;
  }
}

export function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      guests: { type: "string", short: "g", default: "2" },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "string", short: "l", default: "10" },
      days: { type: "string", short: "d" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (positionals.length > 0) {
    throw new CliUsageError(`Unexpected argument: ${positionals[0]}`);
  }

  const guests = positiveInteger(values.guests, "guests");
  const limit = positiveInteger(values.limit, "limit");
  const days = values.days ? parseDays(values.days) : undefined;
  if (values.from) validateDate(values.from, "from");
  if (values.to) validateDate(values.to, "to");

  return {
    guests,
    from: values.from,
    to: values.to,
    limit,
    days,
    json: values.json,
    help: values.help,
  };
}

export function dateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function addDays(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function parseDays(value) {
  const tokens = value.split(",").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    throw new CliUsageError("--days must contain at least one weekday");
  }

  const days = [];
  for (const token of tokens) {
    const normalized = token
      .toLocaleLowerCase("en")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replaceAll("ø", "o")
      .replaceAll("æ", "ae");
    const day = WEEKDAY_ALIASES.get(normalized);
    if (day === undefined) {
      throw new CliUsageError(
        `Unknown weekday "${token}"; use names such as mon, thu, or saturday`,
      );
    }
    if (!days.includes(day)) days.push(day);
  }

  return days.sort((left, right) => left - right);
}

function validateDateRange(from, to) {
  validateDate(from, "from");
  validateDate(to, "to");
  if (from > to) throw new CliUsageError("--from must not be after --to");
  if (monthsBetween(from, to) > 24) {
    throw new CliUsageError("Date ranges longer than 24 months are not supported");
  }
}

function validateDate(value, option) {
  if (!DATE_PATTERN.test(value)) {
    throw new CliUsageError(`--${option} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new CliUsageError(`--${option} is not a valid calendar date`);
  }
}

function positiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CliUsageError(`--${option} must be a positive integer`);
  }
  return number;
}

function monthsBetween(from, to) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + toMonth - fromMonth;
}

function printHuman(result, output) {
  output.write(
    `${result.restaurant} availability for ${result.guests} guest${result.guests === 1 ? "" : "s"}\n`,
  );
  output.write(`Range: ${result.from} to ${result.to} (${result.timezone})\n`);
  if (result.days) output.write(`Days: ${result.days.join(", ")}\n`);

  if (result.availability.length === 0) {
    output.write("No available time slots found.\n");
    return;
  }

  for (const entry of result.availability) {
    output.write(`${entry.date}: ${entry.times.join(", ")}\n`);
  }
}

function helpText() {
  return `Usage: jordnaer-availability [options]\n\nRead-only availability check for Restaurant Jordnær on Superb.\n\nOptions:\n  -g, --guests <number>  Party size (default: 2)\n      --from <date>      First date, YYYY-MM-DD (default: today)\n      --to <date>        Last date, YYYY-MM-DD (default: booking horizon)\n  -d, --days <list>      Comma-separated weekdays, e.g. thu,fri\n  -l, --limit <number>   Maximum available dates to print (default: 10)\n      --json             Emit machine-readable JSON\n  -h, --help             Show this help\n\nWeekdays accept English or Danish names and common abbreviations.\n\nExit codes:\n  0  Availability found\n  1  No availability found\n  2  Invalid input or request failure\n`;
}

class CliUsageError extends Error {}
