let usageChart;

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  return date.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderStatus(data) {
  if (!data || !data.latest) return;
  const r = data.latest;
  setText("current-value", Number(r.current).toFixed(2));
  setText("voltage-value", Number(r.voltage).toFixed(1));
  setText("temperature-value", Number(r.temperature).toFixed(1));
  setText("occupancy-value", r.occupied ? "Occupied" : "Empty");
  setText("appliance-value", "Appliance: " + (r.appliance_on ? "ON" : "OFF"));
  setText("occupancy-caption", r.occupied ? "Movement detected" : "No movement detected");
  document.getElementById("occupancy-dot").classList.toggle("off", !r.occupied);
  setText("reading-count", data.total_readings);
  setText("alert-count", data.alert_count);
  setText("side-alert-count", data.alert_count);
  setText("last-updated", "Updated " + formatTime(r.created_at));

  const banner = document.getElementById("status-banner");
  const warning = r.alert !== "NORMAL";
  banner.classList.toggle("warning", warning);
  setText("banner-title", warning ? "Attention required: " + r.alert : "Everything looks normal");
  setText("banner-text", r.alert === "WASTAGE"
    ? "Room is unoccupied while the monitored appliance appears to be drawing current."
    : warning ? "A demo threshold has been crossed. Treat this as a prompt to investigate safely."
    : "No active warning in the latest sensor reading.");
  setText("banner-tag", r.alert);
  document.querySelector(".status-icon").textContent = warning ? "!" : "✓";
}

function renderChart(rows) {
  const labels = rows.map(r => formatTime(r.created_at));
  const values = rows.map(r => Number(r.current));
  const ctx = document.getElementById("usage-chart");
  if (usageChart) {
    usageChart.data.labels = labels;
    usageChart.data.datasets[0].data = values;
    usageChart.update();
    return;
  }
  usageChart = new Chart(ctx, {
    type: "line",
    data: {labels, datasets: [{
      label: "Current", data: values, borderColor: "#54e0c1",
      backgroundColor: "rgba(84,224,193,.10)", fill: true, tension: .38,
      pointRadius: 2, pointHoverRadius: 5, borderWidth: 2
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {legend: {display:false}},
      scales: {
        x: {grid: {display:false}, ticks: {color:"#718792", maxTicksLimit:7, font:{size:9}}},
        y: {beginAtZero:true, grid:{color:"rgba(130,155,168,.12)"}, ticks:{color:"#718792", font:{size:9}}}
      }
    }
  });
}

function renderActivity(rows) {
  const body = document.getElementById("activity-body");
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No readings received yet.</td></tr>';
    return;
  }
  body.innerHTML = rows.slice().reverse().slice(0, 8).map(r => {
    const warning = r.alert !== "NORMAL";
    return `<tr>
      <td>${formatTime(r.created_at)}</td>
      <td>${Number(r.current).toFixed(2)} A</td>
      <td>${r.occupied ? "Occupied" : "Empty"}</td>
      <td>${r.appliance_on ? "ON" : "OFF"}</td>
      <td><span class="table-status ${warning ? "warn" : ""}">${r.alert}</span></td>
    </tr>`;
  }).join("");
}

async function refreshDashboard() {
  try {
    const [statusRes, historyRes] = await Promise.all([
      fetch("/api/status"), fetch("/api/history")
    ]);
    const status = await statusRes.json();
    const history = await historyRes.json();
    renderStatus(status);
    renderChart(history);
    renderActivity(history);
  } catch (error) {
    setText("last-updated", "Server connection unavailable");
  }
}

document.getElementById("demo-btn").addEventListener("click", async () => {
  const button = document.getElementById("demo-btn");
  button.disabled = true;
  button.textContent = "Generating…";
  try {
    await fetch("/api/demo", {method:"POST"});
    await refreshDashboard();
  } finally {
    button.disabled = false;
    button.textContent = "＋ Simulate reading";
  }
});

const chatWindow = document.getElementById("chat-window");
document.getElementById("chat-launcher").addEventListener("click", () => chatWindow.classList.add("open"));
document.getElementById("chat-close").addEventListener("click", () => chatWindow.classList.remove("open"));

function addMessage(text, who) {
  const box = document.getElementById("chat-messages");
  const node = document.createElement("div");
  node.className = "message " + who;
  node.textContent = text;
  box.appendChild(node);
  box.scrollTop = box.scrollHeight;
}

async function askBot(message) {
  if (!message.trim()) return;
  addMessage(message, "user");
  try {
    const response = await fetch("/api/chat", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message})
    });
    const data = await response.json();
    addMessage(data.reply || "Sorry, I couldn't process that.", "bot");
  } catch {
    addMessage("I can't reach the server right now. Please check that the Flask app is running.", "bot");
  }
}

document.getElementById("chat-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = document.getElementById("chat-input");
  const message = input.value;
  input.value = "";
  await askBot(message);
});

document.querySelectorAll(".suggestions button").forEach(button => {
  button.addEventListener("click", () => askBot(button.textContent));
});

refreshDashboard();
setInterval(refreshDashboard, 5000);
