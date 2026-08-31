import { createHash, randomBytes } from "node:crypto";

const API_BASE_URL = "https://api-gx.superbexperience.com";
const BOOKING_ORIGIN = "https://jordnaer.superbexperience.com";
const RESTAURANT_SLUG = "jordnaer";

// This compatibility key is shipped in Superb's public web client. It is not a
// restaurant credential. It may change when Superb updates that client.
const DEFAULT_WEB_CHALLENGE_KEY =
  "ccyTfX,,xmZHHm6y^uyJ^Fp9b0]T3i.>J9~%uw2}ny";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

export class SuperbError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SuperbError";
  }
}

export class SuperbClient {
  constructor({
    fetchImpl = globalThis.fetch,
    now = Date.now,
    random = (size) => randomBytes(size),
    challengeKey = process.env.SUPERB_WEB_CHALLENGE_KEY ||
      DEFAULT_WEB_CHALLENGE_KEY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("A fetch implementation is required");
    }

    this.fetch = fetchImpl;
    this.now = now;
    this.random = random;
    this.challengeKey = challengeKey;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.restaurant = null;
    this.experience = null;
  }

  async initialize() {
    this.restaurant = await this.request(
      `/restaurant/${RESTAURANT_SLUG}`,
      {},
      { initial: true },
    );

    const experiences = await this.request("/experience", {
      restaurant: this.restaurant.id,
      q: JSON.stringify({
        active: true,
        deleted: false,
        private: false,
        past: false,
      }),
      sort: "order _id",
    });

    this.experience = experiences.find(
      (experience) => experience.active && !experience.deleted,
    );

    if (!this.experience) {
      throw new SuperbError("Jordnær has no active public experience");
    }

    return {
      restaurant: this.restaurant,
      experience: this.experience,
    };
  }

  async guestRange() {
    this.assertInitialized();
    return this.request("/availability/guests", {
      restaurant: this.restaurant.id,
      experience: this.experience.id,
    });
  }

  async availableDates({ guests, from, to }) {
    this.assertInitialized();
    const available = [];

    for (const { year, month } of monthsInRange(from, to)) {
      const dates = await this.request("/availability/dates", {
        restaurant: this.restaurant.id,
        online: true,
        month,
        year,
        experience: this.experience.id,
        guests,
      });

      for (const entry of dates) {
        if (!entry.available) continue;
        const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(entry.date).padStart(2, "0")}`;
        if (date >= from && date <= to) available.push(date);
      }
    }

    return available;
  }

  async availableTimes({ guests, date }) {
    this.assertInitialized();
    const rooms = await this.request("/availability/rooms", {
      restaurant: this.restaurant.id,
      online: true,
      experience: this.experience.id,
      arrival: date,
    });

    const onlineRooms = rooms.filter((room) => room.showOnline);
    const roomsToCheck = onlineRooms.length > 0 ? onlineRooms : [null];
    const times = new Set();

    for (const room of roomsToCheck) {
      const meals = await this.request("/availability/times", {
        restaurant: this.restaurant.id,
        guests,
        room: room?.id,
        experience: this.experience.id,
        online: 1,
        date,
      });

      for (const meal of meals) {
        for (const slot of meal.times || []) {
          if (slot.available) times.add(slot.timeString);
        }
      }
    }

    return [...times].sort();
  }

  async findAvailability({ guests, from, to, limit = 10, days }) {
    const dates = await this.availableDates({ guests, from, to });
    const availability = [];
    const allowedDays = days ? new Set(days) : null;

    for (const date of dates) {
      if (allowedDays && !allowedDays.has(dayOfWeek(date))) continue;
      const times = await this.availableTimes({ guests, date });
      if (times.length > 0) availability.push({ date, times });
      if (availability.length >= limit) break;
    }

    return availability;
  }

  assertInitialized() {
    if (!this.restaurant || !this.experience) {
      throw new SuperbError("The Superb client has not been initialized");
    }
  }

  challengeHeaders() {
    const restaurantId = this.restaurant?.id;
    if (!restaurantId) return { "x-challenge": "na" };

    const vector = [...this.random(12)].join(",");
    const hash = createHash("sha256")
      .update(`${restaurantId}-${vector}-${this.challengeKey}`)
      .digest("hex");
    const now = this.now();
    const expires = Buffer.from(String(now + 20_000)).toString("base64");

    return {
      "x-challenge": `${vector}:${hash}:${expires}`,
      "x-latency": String(now),
      restaurant: restaurantId,
    };
  }

  async request(path, params = {}, { initial = false } = {}) {
    const url = new URL(path, API_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetch(url, {
          headers: {
            "Cache-Control": "no-cache",
            "Content-Type": "application/json",
            Pragma: "no-cache",
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
            "client-identifier": "web-gx",
            "x-honey-pot": "imseeingyou",
            utc: "true",
            Origin: BOOKING_ORIGIN,
            Referer: `${BOOKING_ORIGIN}/`,
            ...(initial ? { "x-challenge": "na" } : this.challengeHeaders()),
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const body = await response.text();
          const detail = body.startsWith("<") ? response.statusText : body;
          const error = new SuperbError(
            `Superb returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
          );
          error.status = response.status;
          throw error;
        }

        const body = await response.json();
        if (!body.success) {
          throw new SuperbError(
            body.error?.message || "Superb returned an unsuccessful response",
          );
        }
        return body.data;
      } catch (error) {
        lastError = error;
        const retryable =
          error.name === "TimeoutError" ||
          error.cause?.code === "EAI_AGAIN" ||
          error.status === 429 ||
          error.status >= 500;
        if (!retryable || attempt === this.retries) break;
        await delay(250 * 2 ** attempt);
      }
    }

    throw new SuperbError(`Could not query Superb: ${lastError.message}`, {
      cause: lastError,
    });
  }
}

export function monthsInRange(from, to) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const months = [];
  let year = fromYear;
  let month = fromMonth - 1;

  while (year < toYear || (year === toYear && month <= toMonth - 1)) {
    months.push({ year, month });
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }

  return months;
}

export function dayOfWeek(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
