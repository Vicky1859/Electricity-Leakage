const $ = (id) => document.getElementById(id);
let chart;
let supabaseClient;
let currentSession = null;
let refreshTimer = null;
let dashboardVisible = false;
let latestChartRows = [];
let latestEventRows = [];
let lastAlertIds = new Set();
let browserAlertsEnabled = false;
const fmt = (v, digits=2) => v === null || v === undefined ? "--" : Number(v).toFixed(digits);

function applyTheme(theme) {
  const selected = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = selected;
  try { localStorage.setItem("voltguard-theme", selected); } catch (_) {}
  const nextLabel = selected === "dark" ? "Switch to light mode" : "Switch to dark mode";
  const nextIcon = selected === "dark" ? "☀" : "☾";
  [$("auth-theme-toggle"), $("dashboard-theme-toggle")].filter(Boolean).forEach(button => {
    button.textContent = nextIcon;
    button.setAttribute("aria-label", nextLabel);
    button.title = nextLabel;
  });
  if (latestChartRows.length && dashboardVisible) drawChart(latestChartRows);
}
function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
}

function setAuthMessage(message, success=false) {
  const el = $("auth-message");
  el.textContent = message || "";
  el.classList.toggle("success", Boolean(success));
}
function showAuthView(view="login") {
  $("landing-page").hidden = true;
  $("auth-screen").hidden = false;
  $("app-shell").hidden = true;

  $("login-form").hidden = view !== "login";
  $("signup-form").hidden = view !== "signup";
  $("reset-form").hidden = view !== "reset";
  $("update-password-form").hidden = view !== "update-password";

  $("auth-login-links").hidden = view !== "login";
  $("google-auth-actions").hidden = view !== "login";
  $("auth-signup-links").hidden = view !== "signup";
  $("auth-reset-links").hidden = !["reset", "update-password"].includes(view);

  $("auth-title").textContent =
    view === "signup" ? "Create your account" :
    view === "reset" ? "Reset password" :
    view === "update-password" ? "Choose a new password" :
    "Welcome back";

  $("auth-subtitle").textContent =
    view === "signup" ? "Register to access your VoltGuard dashboard." :
    view === "reset" ? "We'll email you a secure password reset link." :
    view === "update-password" ? "Set a new password for your VoltGuard account." :
    "Sign in to continue to your energy dashboard.";

  setAuthMessage("");
}
function showDashboard(session) {
  currentSession = session;
  dashboardVisible = true;
  $("landing-page").hidden = true;
  $("auth-screen").hidden = true;
  $("app-shell").hidden = false;
  const name = session.user.user_metadata?.full_name || session.user.email || "VoltGuard User";
  $("user-avatar").textContent = name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase();
  refresh();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, 20000);
}
function showSignedOut() {
  currentSession = null;
  dashboardVisible = false;

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;

  $("app-shell").hidden = true;
  $("auth-screen").hidden = true;
  $("landing-page").hidden = false;
}
async function api(path, options={}) {
  const {data:{session}} = await supabaseClient.auth.getSession();
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch(path, {...options, headers});
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) await supabaseClient.auth.signOut();
    throw new Error(data.error || "Request failed");
  }
  return data;
}
function addMessage(text, who) {
  const el = document.createElement("div");
  el.className = `message ${who}`;
  el.textContent = text;
  $("chat-messages").appendChild(el);
  $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
}
function drawChart(rows) {
  latestChartRows = Array.isArray(rows) ? rows : [];
  const days = Number($("analytics-range")?.value || 7);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const filtered = latestChartRows.filter(r => {
    const t = new Date(r.created_at || 0).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  const sorted = [...filtered].reverse();
  $("chart-empty").style.display = sorted.length ? "none" : "grid";
  $("analytics-count").textContent = `${sorted.length} reading${sorted.length === 1 ? "" : "s"} in selected period`;
  // Estimate energy by integrating adjacent power samples. Gaps over one hour are capped
  // so missing telemetry is never treated as continuous consumption.
  let wattHours = 0;
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1], current = sorted[i];
    const hours = Math.min(1, Math.max(0, (new Date(current.created_at) - new Date(previous.created_at)) / 3600000));
    const p1 = Number(previous.power_w), p2 = Number(current.power_w);
    if (Number.isFinite(p1) && Number.isFinite(p2)) wattHours += ((p1 + p2) / 2) * hours;
  }
  $("energy-total").textContent = sorted.length > 1 ? `${(wattHours / 1000).toFixed(3)} kWh` : "-- kWh";
  if (!window.Chart || !sorted.length) { if (chart) { chart.destroy(); chart = null; } return; }
  const labels = sorted.map(r => {
    const date = new Date(r.created_at || Date.now());
    return days === 1 ? date.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : date.toLocaleDateString([], {month:"short",day:"numeric"});
  });
  if (chart) chart.destroy();
  const themeStyles = getComputedStyle(document.documentElement);
  const chartLabel = themeStyles.getPropertyValue("--chart-label").trim() || "#9bb0c4";
  const chartTick = themeStyles.getPropertyValue("--chart-tick").trim() || "#708aa3";
  chart = new Chart($("activityChart"), {
    type:"line",
    data:{labels,datasets:[
      {label:"Current (A)",data:sorted.map(r=>r.current_a),borderColor:"#42d6c4",backgroundColor:"rgba(66,214,196,.08)",tension:.35,yAxisID:"y",pointRadius:2},
      {label:"Temperature (°C)",data:sorted.map(r=>r.temperature_c),borderColor:"#f6bd60",tension:.35,yAxisID:"y1",pointRadius:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{labels:{color:chartLabel,boxWidth:10,font:{size:10}}}},scales:{x:{ticks:{color:chartTick,maxTicksLimit:7},grid:{color:document.documentElement.dataset.theme === "light" ? "rgba(80,110,140,.14)" : "rgba(130,160,190,.08)"}},y:{ticks:{color:chartTick},grid:{color:document.documentElement.dataset.theme === "light" ? "rgba(80,110,140,.14)" : "rgba(130,160,190,.08)"}},y1:{position:"right",ticks:{color:chartTick},grid:{drawOnChartArea:false}}}}
  });
}
function setLatest(r) {
  if (!r) return;
  $("current").innerHTML = `${fmt(r.current_a)} <small>A</small>`;
  $("voltage").innerHTML = `${fmt(r.voltage_v,1)} <small>V</small>`;
  $("temperature").innerHTML = `${fmt(r.temperature_c,1)} <small>°C</small>`;
  $("power").innerHTML = `${fmt(r.power_w,1)} <small>W</small>`;
  $("occupancy").textContent = r.occupied === true ? "Occupied" : r.occupied === false ? "Unoccupied" : "Unknown";
  $("appliance").textContent = r.appliance_on === true ? "ON" : r.appliance_on === false ? "OFF" : "Unknown";
  $("buzzer").textContent = r.buzzer_on === true ? "Active" : r.buzzer_on === false ? "Off" : "Unknown";
  $("led").textContent = r.led_on === true ? "ON" : r.led_on === false ? "OFF" : "Unknown";
  $("room-chip").textContent = r.occupied === false && r.appliance_on === true ? "CHECK LOAD" : "MONITORING";
}
async function refresh() {
  if (!dashboardVisible || !currentSession) return;
  try {
    const [health, readings, events] = await Promise.all([api("/api/health"),api("/api/readings"),api("/api/events")]);
    $("api-status").textContent = health.database_configured ? "API + database connected" : "API online · database setup pending";
    document.querySelector(".connection-dot").style.background = health.database_configured ? "var(--cyan)" : "var(--amber)";
    const rows = readings.readings || [];
    const latest = rows[0];
    const livePill = $("sensor-live-pill"), liveLabel = $("sensor-live-label"), deviceState = $("device-state");
    const lastTime = latest?.created_at ? new Date(latest.created_at) : null;
    const isOnline = Boolean(lastTime && Number.isFinite(lastTime.getTime()) && Date.now() - lastTime.getTime() <= 90000);
    livePill.classList.toggle("online", isOnline); livePill.classList.toggle("offline", !isOnline);
    liveLabel.textContent = isOnline ? "DEVICE ONLINE" : (latest ? "DEVICE STALE" : "DEVICE OFFLINE");
    deviceState.textContent = isOnline ? "ONLINE" : (latest ? "STALE" : "OFFLINE");
    deviceState.classList.toggle("online", isOnline); deviceState.classList.toggle("offline", !isOnline);
    $("device-id").textContent = `Device ID: ${latest?.device_id || "waiting for data"}`;
    $("last-update").textContent = lastTime ? lastTime.toLocaleString() : "No readings received";
    $("records-count").textContent = rows.length.toLocaleString();
    $("device-footnote").textContent = isOnline ? "Recent telemetry is arriving from the device." : "No recent telemetry. Check the ESP32 Wi-Fi connection and device upload service.";
    if (latest) {
      setLatest(latest);
      $("insight-current").textContent = `${fmt(latest.current_a)} A`;
      $("insight-voltage").textContent = `${fmt(latest.voltage_v,1)} V`;
      $("insight-temperature").textContent = `${fmt(latest.temperature_c,1)} °C`;
    }
    drawChart(rows);
    latestEventRows = events.events || [];
    renderEvents();
    const unresolved = latestEventRows.filter(e => !e.resolved);
    $("insight-alerts").textContent = unresolved.length;
    if (browserAlertsEnabled && unresolved.length) {
      const fresh = unresolved.filter(e => !lastAlertIds.has(String(e.id)));
      if (fresh.length && Notification.permission === "granted") new Notification("VoltGuard: new alert", {body:fresh[0].message || fresh[0].event_type || "A new device alert was recorded."});
    }
    lastAlertIds = new Set(latestEventRows.map(e => String(e.id)));
  } catch(e) {
    $("api-status").textContent = e.message.includes("401") ? "Please sign in again" : "API connection issue";
    $("sensor-live-label").textContent = "STATUS UNKNOWN";
    $("sensor-live-pill").classList.remove("online"); $("sensor-live-pill").classList.add("offline");
    console.error(e);
  }
}
function renderEvents() {
  const filter = $("alert-filter")?.value || "all";
  const filtered = latestEventRows.filter(e => filter === "all" || (filter === "open" ? !e.resolved : Boolean(e.resolved)));
  $("events-list").innerHTML = filtered.length ? filtered.map(e=>`<div class="event"><span class="event-mark ${escapeHtml(e.severity || "warning")}"></span><div class="event-copy"><b>${escapeHtml(e.event_type || "EVENT")} <em class="event-state ${e.resolved ? "resolved" : "unresolved"}">${e.resolved ? "RESOLVED" : "OPEN"}</em></b><small>${escapeHtml(e.message || "")} · ${e.created_at ? new Date(e.created_at).toLocaleString() : ""}</small></div></div>`).join("") : '<div class="empty-state">No alerts match this filter.</div>';
}
function openChat() {
  $("assistant").classList.add("chat-open");
  $("chat-launcher").setAttribute("aria-expanded", "true");
  setTimeout(() => $("chat-input")?.focus(), 120);
}
function closeChat() {
  $("assistant").classList.remove("chat-open");
  $("chat-launcher").setAttribute("aria-expanded", "false");
}
function downloadReport() {
  const rows = latestChartRows || [];
  const events = latestEventRows || [];
  const latest = rows[0] || {};
  const generated = new Date().toLocaleString();
  const reportWindow = window.open("", "_blank", "width=900,height=700");
  if (!reportWindow) { alert("Please allow pop-ups to create your report."); return; }
  const readingRows = rows.slice(0,100).map(r=>`<tr><td>${escapeHtml(new Date(r.created_at).toLocaleString())}</td><td>${fmt(r.current_a)}</td><td>${fmt(r.voltage_v,1)}</td><td>${fmt(r.temperature_c,1)}</td><td>${fmt(r.power_w,1)}</td></tr>`).join("");
  const eventRows = events.slice(0,50).map(e=>`<tr><td>${escapeHtml(e.event_type || "EVENT")}</td><td>${escapeHtml(e.message || "")}</td><td>${e.resolved ? "Resolved" : "Open"}</td><td>${escapeHtml(e.created_at ? new Date(e.created_at).toLocaleString() : "")}</td></tr>`).join("");
  reportWindow.document.write(`<!doctype html><html><head><title>VoltGuard Report</title><style>body{font:14px Arial,sans-serif;color:#17283b;padding:32px}h1{color:#087f79}p{color:#52697e}.summary{display:flex;gap:18px;flex-wrap:wrap;margin:24px 0}.summary div{border:1px solid #d9e4eb;padding:14px;border-radius:10px;min-width:130px}small{display:block;color:#647b90;margin-bottom:6px}table{width:100%;border-collapse:collapse;margin:14px 0 28px;font-size:11px}th,td{border:1px solid #dce5eb;padding:8px;text-align:left}th{background:#edf5f6}button{padding:10px 16px;background:#087f79;color:#fff;border:0;border-radius:7px;cursor:pointer}@media print{button{display:none}body{padding:0}}</style></head><body><h1>VOLTGUARD</h1><h2>Energy monitoring report</h2><p>Generated ${generated}. This report summarizes readings stored by your educational IoT prototype. It is not a certified electrical safety inspection.</p><div class="summary"><div><small>Latest current</small><b>${fmt(latest.current_a)} A</b></div><div><small>Latest voltage</small><b>${fmt(latest.voltage_v,1)} V</b></div><div><small>Latest temperature</small><b>${fmt(latest.temperature_c,1)} °C</b></div><div><small>Latest power</small><b>${fmt(latest.power_w,1)} W</b></div></div><h3>Recent sensor readings</h3><table><thead><tr><th>Time</th><th>Current (A)</th><th>Voltage (V)</th><th>Temperature (°C)</th><th>Power (W)</th></tr></thead><tbody>${readingRows || "<tr><td colspan='5'>No readings recorded.</td></tr>"}</tbody></table><h3>Recent alerts</h3><table><thead><tr><th>Type</th><th>Message</th><th>Status</th><th>Time</th></tr></thead><tbody>${eventRows || "<tr><td colspan='4'>No alerts recorded.</td></tr>"}</tbody></table><button onclick="window.print()">Print / Save as PDF</button></body></html>`);
  reportWindow.document.close();
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setBusy(button, busy, busyText="Please wait…") {
  if (!button) return;
  if (busy) { button.dataset.originalText = button.textContent; button.textContent = busyText; }
  else if (button.dataset.originalText) { button.textContent = button.dataset.originalText; delete button.dataset.originalText; }
  button.disabled = busy;
}

$("auth-theme-toggle").addEventListener("click", toggleTheme);
$("landing-login").addEventListener("click", () => showAuthView("login"));
$("hero-login").addEventListener("click", () => showAuthView("login"));
$("about-login").addEventListener("click", () => showAuthView("login"));

async function startGoogleSignIn(button) {
  setBusy(button, true, "Connecting to Google…");
  try {
    if (!supabaseClient) throw new Error("Authentication is still loading. Please try again in a moment.");
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch (error) {
    showAuthView("login");
    setAuthMessage(error.message || "Google sign-in could not be started.");
    setBusy(button, false);
  }
}

["hero-google", "google-login"].forEach(id => {
  const button = $(id);
  if (button) button.addEventListener("click", () => startGoogleSignIn(button));
});

$("explore-project").addEventListener("click", () => {
  $("features").scrollIntoView({ behavior: "smooth" });
});
$("dashboard-theme-toggle").addEventListener("click", toggleTheme);
applyTheme(document.documentElement.dataset.theme || "dark");

$("show-signup").addEventListener("click",()=>showAuthView("signup"));
$("show-reset").addEventListener("click",()=>showAuthView("reset"));
$("show-login-from-signup").addEventListener("click",()=>showAuthView("login"));
$("show-login-from-reset").addEventListener("click",()=>showAuthView("login"));

$("login-form").addEventListener("submit", async (event)=>{
  event.preventDefault();
  const button=$("login-submit"); setBusy(button,true,"Signing in…"); setAuthMessage("");
  try {
    const {data,error}=await supabaseClient.auth.signInWithPassword({email:$("login-email").value.trim(),password:$("login-password").value});
    if(error) throw error;
    if(data.session) showDashboard(data.session);
  } catch(error) { setAuthMessage(error.message || "Unable to sign in."); }
  finally { setBusy(button,false); }
});
$("signup-form").addEventListener("submit", async (event)=>{
  event.preventDefault();
  const button=$("signup-submit"); setBusy(button,true,"Creating account…"); setAuthMessage("");
  try {
    const {data,error}=await supabaseClient.auth.signUp({
      email:$("signup-email").value.trim(),
      password:$("signup-password").value,
      options:{data:{full_name:$("signup-name").value.trim()},emailRedirectTo:window.location.origin}
    });
    if(error) throw error;
    if(data.session) showDashboard(data.session);
    else setAuthMessage("Account created. Check your email to confirm your address, then sign in.",true);
  } catch(error) { setAuthMessage(error.message || "Unable to create account."); }
  finally { setBusy(button,false); }
});
$("update-password-form").addEventListener("submit", async (event)=>{
  event.preventDefault();
  const button=$("update-password-form").querySelector("button[type=submit]"); setBusy(button,true,"Updating password…"); setAuthMessage("");
  try {
    const {error}=await supabaseClient.auth.updateUser({password:$("new-password").value});
    if(error) throw error;
    setAuthMessage("Password updated successfully. You can now continue to your dashboard.",true);
    const {data}=await supabaseClient.auth.getSession();
    if(data.session) showDashboard(data.session);
  } catch(error) { setAuthMessage(error.message || "Unable to update password."); }
  finally { setBusy(button,false); }
});
$("reset-form").addEventListener("submit", async (event)=>{
  event.preventDefault();
  const button=$("reset-form").querySelector("button[type=submit]"); setBusy(button,true,"Sending link…"); setAuthMessage("");
  try {
    const {error}=await supabaseClient.auth.resetPasswordForEmail($("reset-email").value.trim(),{redirectTo:window.location.origin});
    if(error) throw error;
    setAuthMessage("If an account exists for that email, a password reset link has been sent.",true);
  } catch(error) { setAuthMessage(error.message || "Unable to send reset email."); }
  finally { setBusy(button,false); }
});
$("logout").addEventListener("click",async ()=>{
  const button=$("logout"); button.disabled=true;
  try { const {error}=await supabaseClient.auth.signOut(); if(error) throw error; showSignedOut(); }
  catch(error) { console.error(error); alert("Unable to log out. Please try again."); }
  finally { button.disabled=false; }
});
$("refresh").addEventListener("click", refresh);
$("analytics-range").addEventListener("change", () => drawChart(latestChartRows));
$("alert-filter").addEventListener("change", renderEvents);
$("chat-launcher").addEventListener("click", openChat);
$("chat-close").addEventListener("click", closeChat);
$("settings-open").addEventListener("click", () => { $("settings-popover").hidden = false; });
$("settings-close").addEventListener("click", () => { $("settings-popover").hidden = true; });
$("settings-theme").addEventListener("click", toggleTheme);
$("report-download").addEventListener("click", downloadReport);
$("notifications-enable").addEventListener("click", async () => {
  if (!("Notification" in window)) { $("settings-note").textContent = "This browser does not support desktop notifications."; return; }
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  browserAlertsEnabled = permission === "granted";
  $("notifications-enable").textContent = browserAlertsEnabled ? "Enabled" : "Try again";
  $("settings-note").textContent = browserAlertsEnabled ? "Browser notifications are enabled for new alerts while this dashboard is open." : "Notification permission was not granted. You can change it in your browser settings.";
});
$("chat-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const input=$("chat-input"), text=input.value.trim();
  if(!text)return;
  addMessage(text,"user"); input.value="";
  const pending=document.createElement("div"); pending.className="message bot"; pending.textContent="Thinking…"; $("chat-messages").appendChild(pending);
  const history=[...$("chat-messages").querySelectorAll(".message")].filter(x=>x!==pending).slice(-10).map(x=>({role:x.classList.contains("user")?"user":"assistant",content:x.textContent}));
  try {
    const result=await api("/api/chat",{method:"POST",body:JSON.stringify({messages:history})});
    pending.textContent=result.reply || "No response received.";
  } catch(err) { pending.textContent=err.message; }
});

// Automated landing-page chatbot preview. It uses fixed sample text only;
// it does not call the live Sarvam AI endpoint.
const demoConversations = [
  {
    question: "Why is my electricity consumption unusually high?",
    answer: "It may be due to an appliance drawing more power or a change in usage. Compare recent readings with your usual pattern and check which appliances are running."
  },
  {
    question: "What does a 230 V reading mean?",
    answer: "It is the voltage measured by the prototype at that moment. VoltGuard displays this reading alongside current and power to help you understand the monitored electrical conditions."
  },
  {
    question: "What if the room is empty but an appliance is ON?",
    answer: "VoltGuard can flag that combination as a reminder, helping users notice appliances that may have been left running."
  },
  {
    question: "Can VoltGuard detect every electrical fault?",
    answer: "No. This is an educational monitoring prototype with selected sensors and detection rules. It cannot replace certified protection devices or inspection by a qualified electrician."
  }
];

const demoDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function typeDemoMessage(text, who, container) {
  const bubble = document.createElement("div");
  bubble.className = `demo-message ${who}`;
  const label = document.createElement("span");
  label.className = "demo-message-label";
  label.textContent = who === "user" ? "YOU" : "VOLTGUARD ASSISTANT";
  const content = document.createElement("span");
  content.className = "demo-message-text";
  bubble.append(label, content);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    content.textContent = text;
  } else {
    for (const character of text) {
      content.textContent += character;
      container.scrollTop = container.scrollHeight;
      await demoDelay(who === "user" ? 24 : 13);
    }
  }
}

async function runLandingChatDemo() {
  const container = $("demo-chat-body");
  if (!container) return;
  let index = 0;
  while (true) {
    if (document.hidden || $("landing-page").hidden) {
      await demoDelay(900);
      continue;
    }
    container.replaceChildren();
    const pair = demoConversations[index % demoConversations.length];
    await demoDelay(450);
    await typeDemoMessage(pair.question, "user", container);
    await demoDelay(650);
    await typeDemoMessage(pair.answer, "bot", container);
    await demoDelay(3300);
    index += 1;
  }
}
runLandingChatDemo();

async function initializeAuth() {
  try {
    if (!window.supabase?.createClient) throw new Error("Supabase client library did not load. Refresh the page and try again.");
    const response=await fetch("/api/config",{cache:"no-store"});
    const config=await response.json();
    if(!response.ok || !config.supabase_url || !config.supabase_anon_key) throw new Error(config.error || "Authentication is not configured yet. Add SUPABASE_ANON_KEY in Vercel Environment Variables.");
    supabaseClient=window.supabase.createClient(config.supabase_url,config.supabase_anon_key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    let recoveryInProgress = false;

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") {
    showSignedOut();
  } else if (event === "PASSWORD_RECOVERY") {
    recoveryInProgress = true;
    showAuthView("update-password");
  } else if (
    session &&
    (event === "SIGNED_IN" ||
     event === "TOKEN_REFRESHED" ||
     event === "USER_UPDATED")
  ) {
    if (!recoveryInProgress) showDashboard(session);
  }
});

const { data, error } = await supabaseClient.auth.getSession();
if (error) throw error;

if (data.session && !recoveryInProgress) {
  showDashboard(data.session);
} else if (!recoveryInProgress) {
  showSignedOut();
}
  } catch(error) {
    showAuthView("login");
    setAuthMessage(error.message || "Could not initialize authentication.");
    console.error(error);
  }
}
initializeAuth();
