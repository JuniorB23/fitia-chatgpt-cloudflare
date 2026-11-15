const GOALS = Object.freeze({
  kcal: 2500,
  proteinG: 165,
  carbsG: 291,
  fatG: 75,
});

const MAX_VALUES = Object.freeze({
  kcal: 15000,
  proteinG: 1000,
  carbsG: 2000,
  fatG: 1000,
});

export default {
  fetch: handleRequest,
};

export async function handleRequest(request, env) {
  try {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, { ok: true, service: "fitia-chatgpt-bridge", storage: "cloudflare-d1" });
    }

    if (!authorized(request, env)) return json(401, { error: "No autorizado." });

    if (request.method === "POST" && url.pathname === "/v1/intake") {
      const summary = validateIntake(await readJson(request));
      await putSummary(env.DB, summary);
      return json(200, { ok: true, summary });
    }

    if (request.method === "GET" && url.pathname === "/v1/day/today") {
      const date = localDate(env.TIMEZONE ?? "America/Asuncion");
      return sendDay(env.DB, date);
    }

    const dayMatch = url.pathname.match(/^\/v1\/day\/(\d{4}-\d{2}-\d{2})$/);
    if (request.method === "GET" && dayMatch) return sendDay(env.DB, dayMatch[1]);

    if (request.method === "POST" && url.pathname === "/v1/recommendation") {
      return json(501, {
        error: "La recomendación se genera dentro del GPT personalizado. Los datos ya están disponibles para la GPT Action.",
      });
    }

    return json(404, { error: "Ruta no encontrada." });
  } catch (error) {
    return json(Number(error?.statusCode ?? 400), {
      error: error?.message ?? "Error inesperado.",
    });
  }
}

async function sendDay(database, date) {
  const summary = await getSummary(database, date);
  if (!summary) return json(404, { error: `No hay datos para ${date}.` });
  return json(200, summary);
}

async function putSummary(database, summary) {
  if (!database) throw serviceError("La base D1 no está configurada.", 503);
  await ensureSchema(database);
  await database
    .prepare(
      `INSERT INTO daily_summaries (date, payload, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(date) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .bind(summary.date, JSON.stringify(summary), new Date().toISOString())
    .run();
}

async function getSummary(database, date) {
  if (!database) throw serviceError("La base D1 no está configurada.", 503);
  await ensureSchema(database);
  const row = await database
    .prepare("SELECT payload FROM daily_summaries WHERE date = ?1 LIMIT 1")
    .bind(date)
    .first();
  return row?.payload ? JSON.parse(row.payload) : null;
}

async function ensureSchema(database) {
  await database
    .prepare(
      `CREATE TABLE IF NOT EXISTS daily_summaries (
         date TEXT PRIMARY KEY NOT NULL,
         payload TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    )
    .run();
}

function authorized(request, env) {
  const expected = String(env.BRIDGE_API_KEY ?? "");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const actionKey = request.headers.get("x-api-key") ?? "";
  return secureEqual(expected, bearer) || secureEqual(expected, actionKey);
}

function secureEqual(expected, actual) {
  const left = new TextEncoder().encode(expected);
  const right = new TextEncoder().encode(actual);
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return left.length > 0 && difference === 0;
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 1_000_000) throw serviceError("El cuerpo supera 1 MB.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 1_000_000) {
    throw serviceError("El cuerpo supera 1 MB.", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw serviceError("El cuerpo debe contener JSON válido.", 400);
  }
}

export function validateIntake(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw serviceError("El cuerpo debe ser un objeto JSON.", 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date ?? "")) {
    throw serviceError("date debe usar el formato YYYY-MM-DD.", 400);
  }
  if (String(payload.source ?? "") !== "fitia_health_connect") {
    throw serviceError("source debe ser fitia_health_connect.", 400);
  }
  if (!payload.consumed || typeof payload.consumed !== "object") {
    throw serviceError("Falta consumed.", 400);
  }

  const consumed = {};
  for (const key of Object.keys(MAX_VALUES)) {
    const value = Number(payload.consumed[key]);
    if (!Number.isFinite(value) || value < 0 || value > MAX_VALUES[key]) {
      throw serviceError(`Valor inválido para consumed.${key}.`, 400);
    }
    consumed[key] = round(value, key === "kcal" ? 0 : 3);
  }

  const meals = Array.isArray(payload.meals)
    ? payload.meals.slice(0, 30).map((meal) => ({
        id: String(meal?.id ?? "").slice(0, 200),
        name: String(meal?.name ?? "Comida").slice(0, 200),
        mealType: String(meal?.mealType ?? "unknown").slice(0, 40),
        startTime: String(meal?.startTime ?? "").slice(0, 50),
        kcal: finiteNonNegative(meal?.kcal, 0, 5000),
        proteinG: finiteNonNegative(meal?.proteinG, 0, 500),
        carbsG: finiteNonNegative(meal?.carbsG, 0, 1000),
        fatG: finiteNonNegative(meal?.fatG, 0, 500),
      }))
    : [];

  return {
    date: payload.date,
    timezone: "America/Asuncion",
    source: "fitia_health_connect",
    capturedAt: String(payload.capturedAt ?? new Date().toISOString()),
    consumed,
    remaining: calculateRemaining(consumed),
    goals: GOALS,
    meals,
  };
}

export function calculateRemaining(consumed) {
  return {
    kcal: round(GOALS.kcal - consumed.kcal, 0),
    proteinG: round(GOALS.proteinG - consumed.proteinG),
    carbsG: round(GOALS.carbsG - consumed.carbsG),
    fatG: round(GOALS.fatG - consumed.fatG),
  };
}

export function localDate(timeZone = "America/Asuncion", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function finiteNonNegative(value, min, max) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return round(Math.min(max, Math.max(min, number)), 3);
}

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function json(status, body) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

