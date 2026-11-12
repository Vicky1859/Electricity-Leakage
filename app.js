const $ = (id) => document.getElementById(id);
let chart;
const fmt = (v, digits=2) => v === null || v === undefined ? "--" : Number(v).toFixed(digits);
function addMessage(text, who) {
  const el = document.createElement("div");
  el.className = `message ${who}`;
  el.textContent = text;
  $("chat-messages").appendChild(el);
  $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
}
async function api(path, options={}) {
  const response = await fetch(path, {headers: {"Content-Type":"application/json", ...(options.headers||{})}, ...options});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function drawChart(rows) {
  const sorted = [...rows].reverse();
  $("chart-empty").style.display = sorted.length ? "none" : "grid";
  if (!window.Chart || !sorted.length) return;
  const labels = sorted.map(r => new Date(r.created_at || Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}));
  if (chart) chart.destroy();
  chart = new Chart($("activityChart"), {
    type:"line",
    data:{labels,datasets:[
      {label:"Current (A)",data:sorted.map(r=>r.current_a),borderColor:"#42d6c4",backgroundColor:"rgba(66,214,196,.08)",tension:.35,yAxisID:"y",pointRadius:2},
      {label:"Temperature (°C)",data:sorted.map(r=>r.temperature_c),borderColor:"#f6bd60",tension:.35,yAxisID:"y1",pointRadius:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"#9bb0c4",boxWidth:10,font:{size:10}}}},scales:{x:{ticks:{color:"#708aa3",maxTicksLimit:6},grid:{color:"rgba(130,160,190,.08)"}},y:{ticks:{color:"#708aa3"},grid:{color:"rgba(130,160,190,.08)"}},y1:{position:"right",ticks:{color:"#708aa3"},grid:{drawOnChartArea:false}}}}
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
    $("api-status").textContent = "API connection issue";
    console.error(e);
  }
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
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
refresh();
setInterval(refresh,20000);
