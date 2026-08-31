import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  dateInTimezone,
  parseCliArgs,
  parseDays,
  run,
} from "../src/cli.js";

test("parseCliArgs supplies cron-friendly defaults", () => {
  assert.deepEqual(parseCliArgs([]), {
    guests: 2,
    from: undefined,
    to: undefined,
    limit: 10,
    days: undefined,
    json: false,
    help: false,
  });
});

test("parseCliArgs parses explicit options", () => {
  assert.deepEqual(
    parseCliArgs([
      "--guests",
      "4",
      "--from",
      "2026-09-01",
      "--to",
      "2026-10-01",
      "--limit",
      "3",
      "--days",
      "thu,Friday",
      "--json",
    ]),
    {
      guests: 4,
      from: "2026-09-01",
      to: "2026-10-01",
      limit: 3,
      days: [4, 5],
      json: true,
      help: false,
    },
  );
});

test("parseDays accepts English and Danish names and removes duplicates", () => {
  assert.deepEqual(parseDays("Monday,fre,lørdag,mon"), [1, 5, 6]);
  assert.throws(() => parseDays("funday"), /Unknown weekday/);
});

test("date helpers handle timezones and year boundaries", () => {
  assert.equal(
    dateInTimezone(new Date("2026-08-26T22:30:00Z"), "Europe/Copenhagen"),
    "2026-08-27",
  );
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("run emits JSON and returns zero when availability exists", async () => {
  const output = capture();
  const client = {
    async initialize() {
      return {
        restaurant: {
          name: "JORDNÆR",
          timezone: "Europe/Copenhagen",
          maxNotice: 180,
        },
      };
    },
    async guestRange() {
      return { min: 1, max: 6 };
    },
    async findAvailability(options) {
      assert.deepEqual(options, {
        guests: 2,
        from: "2026-09-01",
        to: "2026-09-30",
        limit: 10,
        days: [4, 5],
      });
      return [{ date: "2026-09-03", times: ["18:00", "19:30"] }];
    },
  };

  const exitCode = await run(
    [
      "--from",
      "2026-09-01",
      "--to",
      "2026-09-30",
      "--days",
      "thu,fri",
      "--json",
    ],
    { stdout: output, stderr: capture(), client },
  );

  assert.equal(exitCode, 0);
  const result = JSON.parse(output.value);
  assert.deepEqual(result.days, ["Thursday", "Friday"]);
  assert.equal(result.availability[0].date, "2026-09-03");
});

test("run returns one when no availability exists", async () => {
  const client = {
    async initialize() {
      return {
        restaurant: {
          name: "JORDNÆR",
          timezone: "Europe/Copenhagen",
          maxNotice: 180,
        },
      };
    },
    async guestRange() {
      return { min: 1, max: 6 };
    },
    async findAvailability(options) {
      assert.deepEqual(options, {
        guests: 2,
        from: "2026-08-26",
        to: "2027-02-22",
        limit: 10,
        days: undefined,
      });
      return [];
    },
  };
  const exitCode = await run([], {
    stdout: capture(),
    stderr: capture(),
    client,
    now: new Date("2026-08-26T10:00:00Z"),
  });
  assert.equal(exitCode, 1);
});

function capture() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    },
  };
}
