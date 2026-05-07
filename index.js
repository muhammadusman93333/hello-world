const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, "logs.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function readStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      activeSession: parsed.activeSession || null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { logs: [], activeSession: null };
    }
    throw error;
  }
}

async function writeStore(store) {
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
}

function toLocalParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function localDateKey(date, timeZone) {
  const parts = toLocalParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTime(date, timeZone) {
  const parts = toLocalParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function startOfLocalDay(date, timeZone) {
  return new Date(`${localDateKey(date, timeZone)}T00:00:00`);
}

function localWeekKey(date, timeZone) {
  const local = startOfLocalDay(date, timeZone);
  const day = local.getDay() || 7;
  local.setDate(local.getDate() - day + 1);
  return local.toISOString().slice(0, 10);
}

function localMonthKey(date, timeZone) {
  return localDateKey(date, timeZone).slice(0, 7);
}

function buildPayload(store, timeZone) {
  const now = new Date();
  const today = localDateKey(now, timeZone);
  const week = localWeekKey(now, timeZone);
  const month = localMonthKey(now, timeZone);

  const logs = store.logs
    .slice()
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .map((log) => ({
      ...log,
      date: localDateKey(new Date(log.startTime), timeZone),
      startLocal: localTime(new Date(log.startTime), timeZone),
      endLocal: log.endTime ? localTime(new Date(log.endTime), timeZone) : "",
    }));

  const summaries = logs.reduce(
    (acc, log) => {
      const start = new Date(log.startTime);
      if (log.date === today) acc.today += log.durationMs;
      if (localWeekKey(start, timeZone) === week) acc.week += log.durationMs;
      if (localMonthKey(start, timeZone) === month) acc.month += log.durationMs;
      return acc;
    },
    { today: 0, week: 0, month: 0 },
  );

  return {
    activeSession: store.activeSession,
    logs,
    summaries,
    serverNow: now.toISOString(),
    timeZone,
  };
}

function getTimeZone(req) {
  const headerZone = req.get("x-time-zone");
  try {
    Intl.DateTimeFormat(undefined, { timeZone: headerZone || "UTC" });
    return headerZone || "UTC";
  } catch {
    return "UTC";
  }
}

app.get("/api/logs", async (req, res, next) => {
  try {
    const store = await readStore();
    res.json(buildPayload(store, getTimeZone(req)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/start", async (req, res, next) => {
  try {
    const store = await readStore();
    if (store.activeSession) {
      return res.status(409).json({ error: "A work session is already active." });
    }

    store.activeSession = {
      id: Date.now().toString(36),
      startTime: new Date().toISOString(),
    };

    await writeStore(store);
    res.status(201).json(buildPayload(store, getTimeZone(req)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/stop", async (req, res, next) => {
  try {
    const store = await readStore();
    if (!store.activeSession) {
      return res.status(409).json({ error: "There is no active work session." });
    }

    const end = new Date();
    const start = new Date(store.activeSession.startTime);
    const durationMs = Math.max(0, end - start);
    const timeZone = getTimeZone(req);

    const log = {
      id: store.activeSession.id,
      date: localDateKey(start, timeZone),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      durationMs,
      duration: Math.round(durationMs / 1000),
      notes: String(req.body.notes || "").trim(),
    };

    store.logs.push(log);
    store.activeSession = null;
    await writeStore(store);
    res.json(buildPayload(store, timeZone));
  } catch (error) {
    next(error);
  }
});

app.put("/api/logs/:id", async (req, res, next) => {
  try {
    const store = await readStore();
    const log = store.logs.find((entry) => entry.id === req.params.id);

    if (!log) {
      return res.status(404).json({ error: "Log entry not found." });
    }

    log.notes = String(req.body.notes || "").trim();
    await writeStore(store);
    res.json(buildPayload(store, getTimeZone(req)));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Something went wrong while processing the request." });
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Time Tracker running at http://localhost:${port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && !process.env.PORT) {
      startServer(port + 1);
      return;
    }
    throw error;
  });
}

startServer(PORT);
