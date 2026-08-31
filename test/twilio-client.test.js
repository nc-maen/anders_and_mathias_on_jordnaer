import assert from "node:assert/strict";
import test from "node:test";
import { listSms, sendSms, TwilioError } from "../src/twilio-client.js";

test("sendSms posts an authenticated form to Twilio", async () => {
  let request;
  const result = await sendSms("A table is available", {
    accountSid: "AC123",
    authToken: "secret",
    from: "+4511111111",
    to: "+4522222222",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ sid: "SM123", status: "queued" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(
    request.url,
    "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json",
  );
  assert.equal(request.options.method, "POST");
  assert.equal(
    request.options.headers.Authorization,
    `Basic ${Buffer.from("AC123:secret").toString("base64")}`,
  );
  assert.equal(request.options.body.get("To"), "+4522222222");
  assert.equal(request.options.body.get("From"), "+4511111111");
  assert.equal(request.options.body.get("Body"), "A table is available");
  assert.deepEqual(result, { sid: "SM123", status: "queued" });
});

test("sendSms supports a Messaging Service sender", async () => {
  let form;
  await sendSms("Available", {
    accountSid: "AC123",
    authToken: "secret",
    messagingServiceSid: "MG123",
    to: "+4522222222",
    fetchImpl: async (_url, options) => {
      form = options.body;
      return new Response(JSON.stringify({ sid: "SM123" }), { status: 201 });
    },
  });

  assert.equal(form.get("MessagingServiceSid"), "MG123");
  assert.equal(form.has("From"), false);
});

test("sendSms validates configuration without exposing secrets", async () => {
  await assert.rejects(
    sendSms("Available", {
      accountSid: "AC123",
      authToken: undefined,
      from: undefined,
      messagingServiceSid: undefined,
      to: undefined,
    }),
    (error) => {
      assert.ok(error instanceof TwilioError);
      assert.match(error.message, /TWILIO_AUTH_TOKEN/);
      assert.match(error.message, /TWILIO_TO_NUMBER/);
      assert.match(error.message, /TWILIO_FROM_NUMBER/);
      assert.doesNotMatch(error.message, /AC123/);
      return true;
    },
  );
});

test("sendSms reports Twilio API errors", async () => {
  await assert.rejects(
    sendSms("Available", {
      accountSid: "AC123",
      authToken: "secret",
      from: "+4511111111",
      to: "+4522222222",
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: "Invalid destination" }), {
          status: 400,
        }),
    }),
    /Twilio returned HTTP 400: Invalid destination/,
  );
});

test("listSms filters outbound history by destination", async () => {
  let request;
  const messages = [{ sid: "SM123", body: "heartbeat" }];
  const result = await listSms({
    direction: "outbound",
    accountSid: "AC123",
    authToken: "secret",
    participant: "+4522222222",
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return new Response(JSON.stringify({ messages }), { status: 200 });
    },
  });

  assert.equal(request.url.searchParams.get("To"), "+4522222222");
  assert.equal(request.url.searchParams.get("From"), null);
  assert.equal(request.url.searchParams.get("PageSize"), "100");
  assert.match(request.options.headers.Authorization, /^Basic /);
  assert.deepEqual(result, messages);
});

test("listSms filters inbound replies by participant and receiver", async () => {
  let requestUrl;
  await listSms({
    direction: "inbound",
    accountSid: "AC123",
    authToken: "secret",
    participant: "+4522222222",
    from: "+4511111111",
    fetchImpl: async (url) => {
      requestUrl = new URL(url);
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    },
  });

  assert.equal(requestUrl.searchParams.get("From"), "+4522222222");
  assert.equal(requestUrl.searchParams.get("To"), "+4511111111");
});
