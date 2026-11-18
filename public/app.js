const $ = (id) => document.getElementById(id);
let chart;
let supabaseClient;
let currentSession = null;
let refreshTimer = null;
let dashboardVisible = false;
let latestChartRows = [];
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
  const sorted = [...latestChartRows].reverse();
  $("chart-empty").style.display = sorted.length ? "none" : "grid";
  if (!window.Chart || !sorted.length) return;
  const labels = sorted.map(r => new Date(r.created_at || Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}));
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
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:chartLabel,boxWidth:10,font:{size:10}}}},scales:{x:{ticks:{color:chartTick,maxTicksLimit:6},grid:{color:document.documentElement.dataset.theme === "light" ? "rgba(80,110,140,.14)" : "rgba(130,160,190,.08)"}},y:{ticks:{color:chartTick},grid:{color:document.documentElement.dataset.theme === "light" ? "rgba(80,110,140,.14)" : "rgba(130,160,190,.08)"}},y1:{position:"right",ticks:{color:chartTick},grid:{drawOnChartArea:false}}}}
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
    if (rows.length) setLatest(rows[0]);
    drawChart(rows);
    const eventRows = events.events || [];
    $("events-list").innerHTML = eventRows.length ? eventRows.map(e=>`<div class="event"><span class="event-mark"></span><div><b>${escapeHtml(e.event_type || "EVENT")}</b><small>${escapeHtml(e.message || "")} · ${e.created_at ? new Date(e.created_at).toLocaleString() : ""}</small></div></div>`).join("") : '<div class="empty-state">No events recorded yet. Events will appear when readings trigger prototype rules.</div>';
  } catch(e) {
    $("api-status").textContent = e.message.includes("401") ? "Please sign in again" : "API connection issue";
    console.error(e);
  }
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
