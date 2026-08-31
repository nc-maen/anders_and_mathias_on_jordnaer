const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const DEFAULT_TIMEOUT_MS = 15_000;

export class TwilioError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "TwilioError";
  }
}

export async function sendSms(
  body,
  {
    accountSid = process.env.TWILIO_ACCOUNT_SID,
    authToken = process.env.TWILIO_AUTH_TOKEN,
    from = process.env.TWILIO_FROM_NUMBER,
    messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID,
    to = process.env.TWILIO_TO_NUMBER,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  const missing = [
    ["TWILIO_ACCOUNT_SID", accountSid],
    ["TWILIO_AUTH_TOKEN", authToken],
    ["TWILIO_TO_NUMBER", to],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (!from && !messagingServiceSid) {
    missing.push("TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID");
  }
  if (missing.length > 0) {
    throw new TwilioError(`Missing environment variable: ${missing.join(", ")}`);
  }
  if (typeof fetchImpl !== "function") {
    throw new TwilioError("A fetch implementation is required");
  }

  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) {
    form.set("MessagingServiceSid", messagingServiceSid);
  } else {
    form.set("From", from);
  }

  let response;
  try {
    response = await fetchImpl(
      `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (error) {
    throw new TwilioError(`Could not contact Twilio: ${error.message}`, {
      cause: error,
    });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TwilioError(
      `Twilio returned HTTP ${response.status}${payload.message ? `: ${payload.message}` : ""}`,
    );
  }

  return { sid: payload.sid, status: payload.status };
}

export async function listSms(
  {
    direction,
    accountSid = process.env.TWILIO_ACCOUNT_SID,
    authToken = process.env.TWILIO_AUTH_TOKEN,
    from = process.env.TWILIO_FROM_NUMBER,
    participant = process.env.TWILIO_TO_NUMBER,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pageSize = 100,
  } = {},
) {
  const missing = [
    ["TWILIO_ACCOUNT_SID", accountSid],
    ["TWILIO_AUTH_TOKEN", authToken],
    ["TWILIO_TO_NUMBER", participant],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new TwilioError(`Missing environment variable: ${missing.join(", ")}`);
  }
  if (direction !== "inbound" && direction !== "outbound") {
    throw new TwilioError('Message direction must be "inbound" or "outbound"');
  }
  if (typeof fetchImpl !== "function") {
    throw new TwilioError("A fetch implementation is required");
  }

  const url = new URL(
    `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
  );
  url.searchParams.set(direction === "outbound" ? "To" : "From", participant);
  if (direction === "inbound" && from) url.searchParams.set("To", from);
  url.searchParams.set("PageSize", String(pageSize));

  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new TwilioError(`Could not contact Twilio: ${error.message}`, {
      cause: error,
    });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TwilioError(
      `Twilio returned HTTP ${response.status}${payload.message ? `: ${payload.message}` : ""}`,
    );
  }

  return payload.messages || [];
}
