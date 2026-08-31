import assert from "node:assert/strict";
import test from "node:test";
import { formatAvailabilitySms, monitor } from "../src/monitor.js";
import { TwilioError } from "../src/twilio-client.js";

const NOW = new Date("2026-09-01T12:00:00Z");
const COMMIT = "abcdef1234567890";
const currentDeploy = {
  body: "Jordnaer monitor deployed (abcdef1). Checking for 2 seats Fri/Sat every 30 min.",
  date_sent: "Tue, 01 Sep 2026 10:00:00 +0000",
};
const availableResult = {
  restaurant: "JORDNÆR",
  guests: 2,
  from: "2026-09-01",
  to: "2027-02-28",
  availability: [{ date: "2026-09-04", times: ["18:00", "19:30"] }],
};

test("monitor sends one alert and explains how to re-arm", async () => {
  const output = capture();
  const sent = [];
  const exitCode = await monitor(["--guests", "2", "--days", "fri,sat"], {
    ...dependencies(),
    stdout: output,
    runImpl: availabilityRun(availableResult),
    sendSmsImpl: async (message) => {
      sent.push(message);
      return { sid: "SM123" };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], formatAvailabilitySms(availableResult));
  assert.match(sent[0], /2026-09-04: 18:00, 19:30/);
  assert.match(sent[0], /Alerts paused\. Reply ARM to resume/);
  assert.match(output.value, /Availability SMS queued \(SM123\)/);
});

test("monitor suppresses repeated alerts after the first positive hit", async () => {
  const sent = [];
  const output = capture();
  const exitCode = await monitor([], {
    ...dependencies({
      outbound: [
        currentDeploy,
        {
          body: formatAvailabilitySms(availableResult),
          date_sent: "Tue, 01 Sep 2026 11:00:00 +0000",
        },
      ],
    }),
    stdout: output,
    runImpl: availabilityRun(availableResult),
    sendSmsImpl: async (message) => sent.push(message),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(sent, []);
  assert.match(output.value, /SMS alerts are paused/);
});

test("an inbound ARM received after the alert re-enables alerts", async () => {
  const sent = [];
  const exitCode = await monitor([], {
    ...dependencies({
      outbound: [
        currentDeploy,
        {
          body: formatAvailabilitySms(availableResult),
          date_sent: "Tue, 01 Sep 2026 10:30:00 +0000",
        },
      ],
      inbound: [
        { body: " arm ", date_sent: "Tue, 01 Sep 2026 11:30:00 +0000" },
      ],
    }),
    runImpl: availabilityRun(availableResult),
    sendSmsImpl: async (message) => sent.push(message),
  });

  assert.equal(exitCode, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^Jordnaer availability/);
});

test("the first run sends a deployment SMS", async () => {
  const sent = [];
  const exitCode = await monitor([], {
    ...dependencies({ outbound: [] }),
    runImpl: availabilityRun({ ...availableResult, availability: [] }, 1),
    sendSmsImpl: async (message) => sent.push(message),
  });

  assert.equal(exitCode, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^Jordnaer monitor deployed \(abcdef1\)/);
});

test("monitor sends a weekly heartbeat with its latch state", async () => {
  const sent = [];
  const oldDeploy = {
    ...currentDeploy,
    date_sent: "Mon, 24 Aug 2026 12:00:00 +0000",
  };
  const exitCode = await monitor([], {
    ...dependencies({ outbound: [oldDeploy] }),
    runImpl: availabilityRun({ ...availableResult, availability: [] }, 1),
    sendSmsImpl: async (message) => sent.push(message),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(sent, [
    "Jordnaer monitor heartbeat: active and armed. Checking 2 seats Fri/Sat every 30 min.",
  ]);
});

test("monitor succeeds silently when no availability or heartbeat is due", async () => {
  const sent = [];
  const output = capture();
  const exitCode = await monitor([], {
    ...dependencies(),
    stdout: output,
    runImpl: availabilityRun({ ...availableResult, availability: [] }, 1),
    sendSmsImpl: async (message) => sent.push(message),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(sent, []);
  assert.match(output.value, /No Friday or Saturday availability/);
});

test("monitor fails when SMS history cannot be read", async () => {
  const errorOutput = capture();
  const exitCode = await monitor([], {
    ...dependencies(),
    stderr: errorOutput,
    listSmsImpl: async () => {
      throw new TwilioError("Twilio history failed");
    },
  });

  assert.equal(exitCode, 2);
  assert.equal(errorOutput.value, "Twilio history failed\n");
});

test("monitor fails when the availability check fails", async () => {
  const errorOutput = capture();
  const exitCode = await monitor([], {
    ...dependencies(),
    stderr: errorOutput,
    runImpl: async (_argv, { stderr }) => {
      stderr.write("Could not query Superb\n");
      return 2;
    },
  });

  assert.equal(exitCode, 2);
  assert.equal(errorOutput.value, "Could not query Superb\n");
});

test("monitor fails when Twilio rejects an alert", async () => {
  const errorOutput = capture();
  const exitCode = await monitor([], {
    ...dependencies(),
    stderr: errorOutput,
    runImpl: availabilityRun(availableResult),
    sendSmsImpl: async () => {
      throw new TwilioError("Twilio rejected the message");
    },
  });

  assert.equal(exitCode, 2);
  assert.equal(errorOutput.value, "Twilio rejected the message\n");
});

function dependencies({ outbound = [currentDeploy], inbound = [] } = {}) {
  return {
    stdout: capture(),
    stderr: capture(),
    now: NOW,
    commit: COMMIT,
    listSmsImpl: async ({ direction }) =>
      direction === "outbound" ? outbound : inbound,
  };
}

function availabilityRun(result, exitCode = 0) {
  return async (argv, { stdout }) => {
    assert.equal(argv.at(-1), "--json");
    stdout.write(JSON.stringify(result));
    return exitCode;
  };
}

function capture() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    },
  };
}
