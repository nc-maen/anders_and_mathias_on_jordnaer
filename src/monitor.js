import { run } from "./cli.js";
import { listSms, sendSms, TwilioError } from "./twilio-client.js";

const BOOKING_URL = "https://jordnaer.superbexperience.com";
const ALERT_PREFIX = "Jordnaer availability";
const DEPLOY_PREFIX = "Jordnaer monitor deployed";
const HEARTBEAT_PREFIX = "Jordnaer monitor heartbeat";
const HEARTBEAT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

export async function monitor(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    runImpl = run,
    listSmsImpl = listSms,
    sendSmsImpl = sendSms,
    now = new Date(),
    commit = process.env.RENDER_GIT_COMMIT || "local",
  } = {},
) {
  let outbound;
  let inbound;
  try {
    [outbound, inbound] = await Promise.all([
      listSmsImpl({ direction: "outbound" }),
      listSmsImpl({ direction: "inbound" }),
    ]);
  } catch (error) {
    writeTwilioError(error, stderr, "read SMS history");
    return 2;
  }

  const shortCommit = commit.slice(0, 7);
  let sentThisRun = false;
  if (!outbound.some(({ body }) => body?.startsWith(`${DEPLOY_PREFIX} (${shortCommit})`))) {
    const deployed = `${DEPLOY_PREFIX} (${shortCommit}). Checking for 2 seats Fri/Sat every 30 min. First availability sends one alert, then pauses.`;
    if (!(await send(deployed, sendSmsImpl, stdout, stderr, "Deployment"))) {
      return 2;
    }
    sentThisRun = true;
  }

  const cliOutput = capture();
  const cliError = capture();
  const exitCode = await runImpl([...argv, "--json"], {
    stdout: cliOutput,
    stderr: cliError,
  });

  if (exitCode === 2) {
    stderr.write(cliError.value);
    return 2;
  }

  let result;
  try {
    result = JSON.parse(cliOutput.value);
  } catch (error) {
    stderr.write(`Could not read the availability result: ${error.message}\n`);
    return 2;
  }

  if (result.availability.length === 0) {
    stdout.write(
      `No Friday or Saturday availability for ${result.guests} guests (${result.from} to ${result.to}).\n`,
    );
  }

  const lastAlert = latest(outbound, ({ body }) =>
    body?.startsWith(ALERT_PREFIX),
  );
  const lastArm = latest(inbound, ({ body }) =>
    ["ARM", "REARM", "RESUME"].includes(body?.trim().toUpperCase()),
  );
  const armed = !lastAlert || messageTime(lastArm) > messageTime(lastAlert);

  if (result.availability.length > 0 && armed) {
    const message = formatAvailabilitySms(result);
    if (!(await send(message, sendSmsImpl, stdout, stderr, "Availability"))) {
      return 2;
    }
    sentThisRun = true;
  } else if (result.availability.length > 0) {
    stdout.write("Availability found, but SMS alerts are paused.\n");
  }

  const lastStatus = latest(outbound, ({ body }) =>
    body?.startsWith(DEPLOY_PREFIX) || body?.startsWith(HEARTBEAT_PREFIX),
  );
  if (
    !sentThisRun &&
    (!lastStatus || now.valueOf() - messageTime(lastStatus) >= HEARTBEAT_INTERVAL_MS)
  ) {
    const heartbeat = armed
      ? `${HEARTBEAT_PREFIX}: active and armed. Checking 2 seats Fri/Sat every 30 min.`
      : `${HEARTBEAT_PREFIX}: paused after an availability alert. Reply ARM to resume alerts.`;
    if (!(await send(heartbeat, sendSmsImpl, stdout, stderr, "Heartbeat"))) {
      return 2;
    }
  }

  return 0;
}

export function formatAvailabilitySms(result) {
  const slots = result.availability
    .map(({ date, times }) => `${date}: ${times.join(", ")}`)
    .join("\n");
  return `${ALERT_PREFIX} for ${result.guests}!\n${slots}\nBook: ${BOOKING_URL}\nAlerts paused. Reply ARM to resume.`;
}

async function send(message, sendSmsImpl, stdout, stderr, label) {
  try {
    const sent = await sendSmsImpl(message);
    stdout.write(`${label} SMS queued${sent?.sid ? ` (${sent.sid})` : ""}.\n`);
    return true;
  } catch (error) {
    writeTwilioError(error, stderr, `send ${label.toLowerCase()} SMS`);
    return false;
  }
}

function writeTwilioError(error, stderr, action) {
  if (error instanceof TwilioError) {
    stderr.write(`${error.message}\n`);
  } else {
    stderr.write(`Could not ${action}: ${error.message}\n`);
  }
}

function latest(messages, predicate) {
  return messages
    .filter(predicate)
    .sort((left, right) => messageTime(right) - messageTime(left))[0];
}

function messageTime(message) {
  if (!message) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(
    message.date_sent || message.dateSent || message.date_created || message.dateCreated,
  );
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function capture() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    },
  };
}
