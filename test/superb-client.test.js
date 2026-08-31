import assert from "node:assert/strict";
import test from "node:test";
import {
  dayOfWeek,
  monthsInRange,
  SuperbClient,
} from "../src/superb-client.js";

test("monthsInRange includes every calendar month", () => {
  assert.deepEqual(monthsInRange("2026-11-20", "2027-02-03"), [
    { year: 2026, month: 10 },
    { year: 2026, month: 11 },
    { year: 2027, month: 0 },
    { year: 2027, month: 1 },
  ]);
});

test("challenge headers are deterministic with injected clock and randomness", () => {
  const client = new SuperbClient({
    fetchImpl: async () => {},
    now: () => 1_000,
    random: () => Buffer.alloc(12, 1),
    challengeKey: "test-key",
  });
  client.restaurant = { id: "restaurant-id" };

  const headers = client.challengeHeaders();
  const expectedHash =
    "ff1a247b15f5118d1946439379fedb956c2a1851ed055e3223f697aaae313c3b";
  assert.equal(
    headers["x-challenge"],
    `1,1,1,1,1,1,1,1,1,1,1,1:${expectedHash}:MjEwMDA=`,
  );
  assert.equal(headers["x-latency"], "1000");
});

test("findAvailability filters weekdays before requesting time slots", async () => {
  const client = new SuperbClient({ fetchImpl: async () => {} });
  client.availableDates = async () => [
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
  ];
  const checkedDates = [];
  client.availableTimes = async ({ date }) => {
    checkedDates.push(date);
    return ["18:00"];
  };

  const result = await client.findAvailability({
    guests: 2,
    from: "2026-09-01",
    to: "2026-09-30",
    days: [5],
  });

  assert.equal(dayOfWeek("2026-09-04"), 5);
  assert.deepEqual(checkedDates, ["2026-09-04"]);
  assert.deepEqual(result, [{ date: "2026-09-04", times: ["18:00"] }]);
});
