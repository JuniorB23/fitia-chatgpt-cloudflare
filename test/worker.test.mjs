import test from "node:test";
import assert from "node:assert/strict";
import worker, { calculateRemaining, localDate, validateIntake } from "../src/worker.mjs";

const TOKEN = "token-de-prueba-12345678901234567890";

test("calcula las metas fijas y conserva excesos negativos", () => {
  assert.deepEqual(calculateRemaining({ kcal: 1000, proteinG: 50, carbsG: 100, fatG: 20 }), {
    kcal: 1500,
    proteinG: 115,
    carbsG: 191,
    fatG: 55,
  });
  assert.equal(calculateRemaining({ kcal: 2600, proteinG: 170, carbsG: 300, fatG: 80 }).kcal, -100);
});

test("valida y normaliza un resumen de Fitia", () => {
  const result = validateIntake(intake(1068));
  assert.equal(result.remaining.kcal, 1432);
  assert.equal(result.goals.proteinG, 165);
  assert.equal(result.timezone, "America/Asuncion");
  assert.equal(result.meals.length, 1);
});

test("rechaza una fuente distinta de Fitia/Health Connect", () => {
  assert.throws(() => validateIntake({ ...intake(1000), source: "captura_manual" }), /source/);
});

test("genera la fecha local de Asunción", () => {
  assert.equal(localDate("America/Asuncion", new Date("2026-11-16T01:30:00Z")), "2026-11-15");
});

test("API completa: salud, autenticación, escritura, lectura y reemplazo", async () => {
  const env = { DB: new FakeD1(), BRIDGE_API_KEY: TOKEN, TIMEZONE: "America/Asuncion" };

  let response = await call("/health", {}, env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).storage, "cloudflare-d1");

  response = await call("/v1/day/2026-11-08", {}, env);
  assert.equal(response.status, 401);

  response = await call("/v1/intake", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(intake(1068)),
  }, env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).summary.remaining.kcal, 1432);

  response = await call("/v1/day/2026-11-08", {
    headers: { "X-API-Key": TOKEN },
  }, env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).consumed.kcal, 1068);

  response = await call("/v1/intake", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(intake(1200)),
  }, env);
  assert.equal(response.status, 200);

  response = await call("/v1/day/2026-11-08", { headers: authHeaders() }, env);
  assert.equal((await response.json()).consumed.kcal, 1200);

  response = await call("/v1/day/2026-11-01", { headers: authHeaders() }, env);
  assert.equal(response.status, 404);
});

test("limita tamaño, rechaza JSON inválido y no expone datos sin token", async () => {
  const env = { DB: new FakeD1(), BRIDGE_API_KEY: TOKEN };
  let response = await call("/v1/intake", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Length": "1000001" },
    body: "{}",
  }, env);
  assert.equal(response.status, 413);

  response = await call("/v1/intake", {
    method: "POST",
    headers: authHeaders(),
    body: "{no-json}",
  }, env);
  assert.equal(response.status, 400);

  response = await call("/v1/day/2026-11-08", {
    headers: { Authorization: "Bearer incorrecto" },
  }, env);
  assert.equal(response.status, 401);
});

function intake(kcal) {
  return {
    date: "2026-11-08",
    source: "fitia_health_connect",
    capturedAt: "2026-11-08T14:45:00-03:00",
    consumed: { kcal, proteinG: 60.294, carbsG: 83.292, fatG: 54.889 },
    meals: [{
      id: "almuerzo-1",
      name: "Almuerzo",
      mealType: "lunch",
      startTime: "2026-11-08T12:00:00-03:00",
      kcal: 753,
      proteinG: 41.454,
      carbsG: 57.212,
      fatG: 40.624,
    }],
  };
}

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

function call(path, init, env) {
  return worker.fetch(new Request(`https://fitia.example${path}`, init), env);
}

class FakeD1 {
  constructor() {
    this.rows = new Map();
  }

  prepare(sql) {
    const database = this;
    return {
      bind(...values) {
        return {
          async run() {
            if (!sql.includes("INSERT INTO daily_summaries")) throw new Error("SQL inesperado");
            database.rows.set(values[0], values[1]);
            return { success: true };
          },
          async first() {
            if (!sql.includes("SELECT payload FROM daily_summaries")) throw new Error("SQL inesperado");
            const payload = database.rows.get(values[0]);
            return payload ? { payload } : null;
          },
        };
      },
    };
  }
}

