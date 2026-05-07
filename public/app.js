const state = {
  activeSession: null,
  logs: [],
  summaries: { today: 0, week: 0, month: 0 },
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  ticker: null,
};

const els = {
  timer: document.querySelector("#timer"),
  sessionButton: document.querySelector("#sessionButton"),
  livePill: document.querySelector("#livePill"),
  statusLabel: document.querySelector("#statusLabel"),
  currentDate: document.querySelector("#currentDate"),
  todayHours: document.querySelector("#todayHours"),
  weekHours: document.querySelector("#weekHours"),
  monthHours: document.querySelector("#monthHours"),
  logRows: document.querySelector("#logRows"),
  emptyState: document.querySelector("#emptyState"),
  reportText: document.querySelector("#reportText"),
  copyReport: document.querySelector("#copyReport"),
  copyStatus: document.querySelector("#copyStatus"),
  noteModal: document.querySelector("#noteModal"),
  sessionNotes: document.querySelector("#sessionNotes"),
  saveStop: document.querySelector("#saveStop"),
  cancelStop: document.querySelector("#cancelStop"),
};

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatHuman(ms) {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatReportTotal(ms) {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const minuteText = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return hours > 0 ? `${hourText} ${minuteText}` : minuteText;
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: state.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Time-Zone": state.timeZone,
      ...(options.headers || {}),
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function applyData(data) {
  state.activeSession = data.activeSession;
  state.logs = data.logs;
  state.summaries = data.summaries;
  render();
}

function updateTimer() {
  if (!state.activeSession) {
    els.timer.textContent = "00:00:00";
    return;
  }
  els.timer.textContent = formatClock(Date.now() - new Date(state.activeSession.startTime).getTime());
}

function render() {
  const isActive = Boolean(state.activeSession);
  els.sessionButton.textContent = isActive ? "Stop Work" : "Start Work";
  els.sessionButton.classList.toggle("stop", isActive);
  els.livePill.classList.toggle("active", isActive);
  els.statusLabel.textContent = isActive ? "Live" : "Idle";

  els.todayHours.textContent = formatHuman(state.summaries.today);
  els.weekHours.textContent = formatHuman(state.summaries.week);
  els.monthHours.textContent = formatHuman(state.summaries.month);
  els.currentDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  renderLogs();
  renderReport();
  updateTimer();
}

function renderLogs() {
  els.logRows.innerHTML = "";
  els.emptyState.style.display = state.logs.length ? "none" : "block";

  for (const log of state.logs) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${log.date}</td>
      <td>${log.startLocal} - ${log.endLocal}</td>
      <td>${formatHuman(log.durationMs)}</td>
      <td><input class="note-input" value="${escapeHtml(log.notes || "")}" aria-label="Edit notes for ${log.date}" /></td>
    `;

    const input = row.querySelector("input");
    input.addEventListener("change", async () => {
      input.disabled = true;
      try {
        applyData(await api(`/api/logs/${log.id}`, {
          method: "PUT",
          body: JSON.stringify({ notes: input.value }),
        }));
      } finally {
        input.disabled = false;
      }
    });

    els.logRows.appendChild(row);
  }
}

function renderReport() {
  const today = localDateKey();
  const todaysLogs = state.logs.slice().reverse().filter((log) => log.date === today);
  const lines = [`📅 WORK LOG: ${today}`];

  if (!todaysLogs.length) {
    lines.push("No completed work sessions today.");
  } else {
    for (const log of todaysLogs) {
      const note = log.notes || "No notes";
      lines.push(`🕒 ${log.startLocal} - ${log.endLocal} | 📝 ${note} | ⏳ ${formatHuman(log.durationMs)}`);
    }
    lines.push(`✅ Total time = ${formatReportTotal(state.summaries.today)}`);
  }

  els.reportText.value = lines.join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openModal() {
  els.sessionNotes.value = "";
  els.noteModal.classList.add("show");
  els.noteModal.setAttribute("aria-hidden", "false");
  els.sessionNotes.focus();
}

function closeModal() {
  els.noteModal.classList.remove("show");
  els.noteModal.setAttribute("aria-hidden", "true");
}

async function startSession() {
  els.sessionButton.disabled = true;
  try {
    applyData(await api("/api/start", { method: "POST" }));
  } finally {
    els.sessionButton.disabled = false;
  }
}

async function stopSession() {
  els.saveStop.disabled = true;
  try {
    applyData(await api("/api/stop", {
      method: "POST",
      body: JSON.stringify({ notes: els.sessionNotes.value }),
    }));
    closeModal();
  } finally {
    els.saveStop.disabled = false;
  }
}

els.sessionButton.addEventListener("click", () => {
  if (state.activeSession) {
    openModal();
  } else {
    startSession().catch(alert);
  }
});

els.saveStop.addEventListener("click", () => stopSession().catch(alert));
els.cancelStop.addEventListener("click", closeModal);
els.noteModal.addEventListener("click", (event) => {
  if (event.target === els.noteModal) closeModal();
});

els.copyReport.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.reportText.value);
  els.copyStatus.textContent = "Report copied to clipboard.";
  window.setTimeout(() => {
    els.copyStatus.textContent = "";
  }, 2200);
});

state.ticker = window.setInterval(updateTimer, 1000);
api("/api/logs").then(applyData).catch(alert);
