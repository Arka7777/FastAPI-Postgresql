"use strict";
/* ============ Config (the only place to change the API URL) ============ */
const API_BASE_URL = "https://fastapi-postgresql-6gnl.onrender.com";

/* ============ Helpers ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Mirrors the grade logic of StudentResponse in main2.py
const gradeOf = m => (m >= 90 ? "A+" : m >= 80 ? "A" : m >= 70 ? "B" : m >= 60 ? "C" : "fail");
const icons = () => window.lucide && lucide.createIcons();

/* ============ API layer (no DOM access) ============ */
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(API_BASE_URL + path, { headers: { "Content-Type": "application/json" }, ...options });
  } catch {
    throw new ApiError(0, `Cannot reach the backend at ${API_BASE_URL}. Check it is running and CORS is enabled.`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    let detail = body && body.detail;
    // 422: FastAPI returns a list of {loc, msg}
    if (Array.isArray(detail)) detail = detail.map(e => `${(e.loc || []).slice(1).join(".")}: ${e.msg}`).join("; ");
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return body;
}

const api = {
  // GET /filter with no course returns every student (the backend has no plain "list all" route)
  list: () => request("/filter"),
  get: id => request(`/student/${encodeURIComponent(id)}`),
  create: data => request("/create", { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/update/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: id => request(`/delete/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/* ============ State ============ */
const state = { students: [], loading: true, error: null, q: "", course: "", sort: "name:asc", page: 1, perPage: 8, view: "overview" };
const charts = {};

/* ============ UI: toast, theme, navigation ============ */
function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast " + (type === "error" ? "error" : "");
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 4200);
}

function setView(name) {
  state.view = name;
  $$(".view").forEach(v => (v.hidden = v.id !== "view-" + name));
  $$(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  $("#title").textContent = { overview: "Overview", students: "All Students", analytics: "Analytics", settings: "Settings" }[name];
  $("#app").classList.remove("open");
  render();
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("sh-theme", t);
  render();
}

/* ============ Derived data ============ */
function visibleStudents() {
  const q = state.q.trim().toLowerCase();
  const [key, dir] = state.sort.split(":");
  return state.students
    .filter(s => (!state.course || s.course === state.course) &&
      (!q || [s.id, s.name, s.email, s.course].some(v => String(v).toLowerCase().includes(q))))
    .sort((a, b) => {
      const r = typeof a[key] === "string" ? a[key].localeCompare(b[key]) : a[key] - b[key];
      return dir === "desc" ? -r : r;
    });
}

const avg = arr => (arr.length ? arr.reduce((t, s) => t + s.marks, 0) / arr.length : 0);
const groupBy = (arr, fn) => arr.reduce((m, s) => ((m[fn(s)] = (m[fn(s)] || []).concat(s)), m), {});

/* ============ UI: rendering ============ */
function stateBlock(icon, title, text, retry) {
  return `<div class="state"><i data-lucide="${icon}"></i><h3>${title}</h3><p>${esc(text)}</p>${retry ? '<button class="btn" data-retry>Try again</button>' : ""}</div>`;
}

function renderStats() {
  const s = state.students;
  const cards = [
    ["Total students", s.length, "users"],
    ["Average marks", avg(s).toFixed(1), "gauge"],
    ["Top performers (90+)", s.filter(x => x.marks >= 90).length, "trophy"],
    ["Need improvement (<60)", s.filter(x => x.marks < 60).length, "alert-triangle"],
  ];
  $("#stats").innerHTML = cards.map(([l, v, i]) =>
    `<div class="card stat"><div class="top"><span>${l}</span><i data-lucide="${i}"></i></div>${state.loading ? '<div class="skel" style="height:34px;width:60%"></div>' : `<b>${v}</b>`}</div>`).join("");
}

function drawChart(id, config) {
  charts[id]?.destroy();
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue("--muted").trim();
  Chart.defaults.borderColor = css.getPropertyValue("--line").trim();
  charts[id] = new Chart($("#" + id), { ...config, options: { maintainAspectRatio: false, ...config.options } });
}

const palette = ["#8b5cf6", "#e879f9", "#38bdf8", "#fbbf24", "#f472b6", "#5eead4", "#a78bfa"];

function renderOverview() {
  renderStats();
  const s = state.students;
  const top = [...s].sort((a, b) => b.marks - a.marks).slice(0, 10);
  drawChart("chPerf", { type: "bar", data: { labels: top.map(x => x.name), datasets: [{ data: top.map(x => x.marks), backgroundColor: "#8b5cf6", borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } } });
  const byCourse = groupBy(s, x => x.course);
  drawChart("chCourse", { type: "doughnut", data: { labels: Object.keys(byCourse), datasets: [{ data: Object.values(byCourse).map(a => a.length), backgroundColor: palette, borderWidth: 0 }] },
    options: { cutout: "68%", plugins: { legend: { position: "right" } } } });

  // The API has no created-at field, so "recent" = last records returned by the backend
  $("#recent").innerHTML = s.length ? s.slice(-5).reverse().map(x =>
    `<li><span class="avatar">${esc(x.name[0])}</span><div class="grow">${esc(x.name)}<small>${esc(x.course)}</small></div><span class="badge g-${esc(x.grade || gradeOf(x.marks))}">${x.marks}</span></li>`).join("")
    : `<li class="muted">No records yet.</li>`;

  const best = Object.entries(byCourse).map(([c, a]) => [c, avg(a)]).sort((a, b) => b[1] - a[1]);
  const pass = s.length ? Math.round((s.filter(x => x.marks >= 60).length / s.length) * 100) : 0;
  const insights = s.length ? [
    ["trending-up", `${esc(best[0][0])} has the highest average`, `${best[0][1].toFixed(1)} marks`],
    ["check-circle-2", `${pass}% of students are passing`, "60 marks or above"],
    ["alert-triangle", `${s.filter(x => x.marks < 60).length} students below 60`, best.length > 1 ? `Lowest course average: ${esc(best.at(-1)[0])}` : "Consider extra support"],
  ] : [];
  $("#insights").innerHTML = insights.map(([i, t, d]) => `<li><i data-lucide="${i}"></i><div class="grow">${t}<small>${d}</small></div></li>`).join("") || `<li class="muted">Insights appear once students are added.</li>`;
}

function renderAnalytics() {
  const s = state.students, grades = ["A+", "A", "B", "C", "fail"];
  drawChart("chGrade", { type: "bar", data: { labels: grades, datasets: [{ data: grades.map(g => s.filter(x => gradeOf(x.marks) === g).length), backgroundColor: ["#34d399", "#5eead4", "#8b5cf6", "#fbbf24", "#f87171"], borderRadius: 6 }] }, options: { plugins: { legend: { display: false } } } });
  const byCourse = groupBy(s, x => x.course);
  drawChart("chAvg", { type: "bar", data: { labels: Object.keys(byCourse), datasets: [{ data: Object.values(byCourse).map(a => +avg(a).toFixed(1)), backgroundColor: "#e879f9", borderRadius: 6 }] }, options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 } } } });
}

function renderCourseOptions() {
  const courses = [...new Set(state.students.map(s => s.course))].sort();
  $("#courseFilter").innerHTML = `<option value="">All courses</option>` + courses.map(c => `<option ${c === state.course ? "selected" : ""}>${esc(c)}</option>`).join("");
}

function renderTable() {
  const tbody = $("#tbody"), box = $("#tableState"), pager = $("#pager");
  if (state.loading) {
    tbody.innerHTML = Array.from({ length: 5 }, () => `<tr>${'<td><div class="skel"></div></td>'.repeat(8)}</tr>`).join("");
    box.innerHTML = pager.innerHTML = ""; return;
  }
  if (state.error) { tbody.innerHTML = ""; box.innerHTML = stateBlock("cloud-off", "Couldn't load students", state.error, true); pager.innerHTML = ""; return; }
  const rows = visibleStudents(), pages = Math.max(1, Math.ceil(rows.length / state.perPage));
  state.page = Math.min(state.page, pages);
  if (!rows.length) {
    tbody.innerHTML = "";
    box.innerHTML = state.students.length ? stateBlock("search-x", "No matches", "Try a different search or course filter.")
      : stateBlock("users", "No students yet", "Add your first student to get started.").replace("</div>", '<button class="btn primary" data-action="add">Add student</button></div>');
    pager.innerHTML = ""; return;
  }
  box.innerHTML = "";
  const page = rows.slice((state.page - 1) * state.perPage, state.page * state.perPage);
  tbody.innerHTML = page.map(s => {
    const g = s.grade || gradeOf(s.marks);
    return `<tr data-id="${esc(s.id)}"><td class="mono">${esc(s.id)}</td><td>${esc(s.name)}</td><td>${esc(s.email)}</td><td>${s.age}</td><td>${esc(s.course)}</td><td>${s.marks}</td>
      <td><span class="badge g-${esc(g)}">${esc(g)}</span></td>
      <td class="r"><button class="icon-btn" data-act="view" aria-label="View ${esc(s.name)}"><i data-lucide="eye"></i></button>
      <button class="icon-btn" data-act="edit" aria-label="Edit ${esc(s.name)}"><i data-lucide="pencil"></i></button>
      <button class="icon-btn" data-act="delete" aria-label="Delete ${esc(s.name)}"><i data-lucide="trash-2"></i></button></td></tr>`;
  }).join("");
  pager.innerHTML = `<span>${rows.length} students · page ${state.page} of ${pages}</span><div>
    <button class="btn" data-page="-1" ${state.page === 1 ? "disabled" : ""}>Previous</button>
    <button class="btn" data-page="1" ${state.page === pages ? "disabled" : ""}>Next</button></div>`;
}

function render() {
  renderCourseOptions();
  if (state.view === "overview") renderOverview();
  if (state.view === "students") renderTable();
  if (state.view === "analytics") renderAnalytics();
  icons();
}

/* ============ Data loading ============ */
async function loadStudents(showToast = false) {
  state.loading = true; state.error = null; render();
  try {
    state.students = await api.list();
    if (showToast) toast("Data refreshed");
  } catch (e) {
    state.error = e.message; toast(e.message, "error");
  } finally {
    state.loading = false; render();
  }
}

/* ============ Form modal (add + edit) ============ */
const form = $("#studentForm");
let editing = null; // original student object when editing, else null

// Rules mirror StudentCreate (add) and StudentUpdate (edit) in main2.py
function validate(d) {
  const e = {}, num = v => v !== "" && Number.isFinite(+v);
  if (!editing && !d.id.trim()) e.id = "Student ID is required";
  if (!/^[A-Za-z ]{2,50}$/.test(d.name.trim())) e.name = "2–50 letters and spaces only";
  const [aMin, aMax] = editing ? [1, 99] : [1, 119];
  if (!num(d.age) || !Number.isInteger(+d.age) || d.age < aMin || d.age > aMax) e.age = `Whole number from ${aMin} to ${aMax}`;
  const [mMin, mMax] = editing ? [1, 99] : [0, 100]; // PUT rejects 0 and 100 (gt=0, lt=100)
  if (!num(d.marks) || !Number.isInteger(+d.marks) || d.marks < mMin || d.marks > mMax) e.marks = `Whole number from ${mMin} to ${mMax}`;
  if (!d.course.trim() || d.course.length > 50) e.course = "Course is required (max 50 characters)";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) e.email = "Enter a valid email address";
  return e;
}

function showErrors(errs) {
  $$("label", form).forEach(l => {
    const input = $("input", l), msg = errs[input.name];
    input.classList.toggle("bad", !!msg); $("small", l).textContent = msg || "";
  });
}

function openForm(student = null) {
  editing = student; form.reset(); showErrors({});
  $("#formTitle").textContent = student ? "Edit student" : "Add student";
  $("#saveLabel").textContent = student ? "Save changes" : "Create student";
  form.elements.id.disabled = !!student;
  if (student) for (const k of ["id", "name", "age", "marks", "course", "email"]) form.elements[k].value = student[k];
  $("#formModal").showModal(); form.elements[student ? "name" : "id"].focus();
}

form.addEventListener("submit", async ev => {
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  if (editing) d.id = editing.id;
  const errs = validate(d); showErrors(errs);
  if (Object.keys(errs).length) return;
  const payload = { ...d, age: +d.age, marks: +d.marks, name: d.name.trim(), course: d.course.trim(), email: d.email.trim() };
  const btn = $("#saveBtn"); btn.disabled = true; btn.classList.add("loading");
  try {
    if (editing) {
      // Partial update: send only fields that changed
      const changes = {};
      for (const k of ["name", "age", "course", "marks", "email"]) if (payload[k] !== editing[k]) changes[k] = payload[k];
      if (!Object.keys(changes).length) { toast("No changes to save"); $("#formModal").close(); return; }
      await api.update(editing.id, changes); toast("Changes saved");
    } else {
      await api.create(payload); toast("Student created");
    }
    $("#formModal").close(); await loadStudents();
  } catch (e) {
    toast(e.message, "error");
  } finally {
    btn.disabled = false; btn.classList.remove("loading");
  }
});

async function openEdit(id) {
  try { openForm(await api.get(id)); } // fetch fresh data before editing
  catch (e) { toast(e.message, "error"); }
}

async function openDetails(id) {
  try {
    const s = await api.get(id), g = s.grade || gradeOf(s.marks);
    $("#viewBody").innerHTML = `<header><h2>${esc(s.name)}</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></header>
      <div class="detail"><dl><dt>Student ID</dt><dd class="mono">${esc(s.id)}</dd><dt>Email</dt><dd>${esc(s.email)}</dd><dt>Age</dt><dd>${s.age}</dd>
      <dt>Course</dt><dd>${esc(s.course)}</dd><dt>Marks</dt><dd>${s.marks}</dd><dt>Grade</dt><dd><span class="badge g-${esc(g)}">${esc(g)}</span></dd></dl></div>`;
    icons(); $("#viewModal").showModal();
  } catch (e) { toast(e.message, "error"); }
}

function confirmDelete(s) {
  $("#confirmText").textContent = `${s.name} (${s.id}) will be permanently removed. This can't be undone.`;
  const modal = $("#confirmModal"), yes = $("#confirmYes");
  yes.onclick = async () => {
    yes.disabled = true;
    try { await api.remove(s.id); toast("Student deleted"); modal.close(); await loadStudents(); }
    catch (e) { toast(e.message, "error"); }
    finally { yes.disabled = false; }
  };
  modal.showModal();
}

/* ============ Events ============ */
document.addEventListener("click", e => {
  const t = e.target.closest("button, dialog"); if (!t) return;
  if (t.matches("dialog") && e.target === t) return t.close(); // click on backdrop
  if (t.matches("[data-close]")) t.closest("dialog").close();
  else if (t.matches("[data-view]")) setView(t.dataset.view);
  else if (t.matches("[data-action=add]")) openForm();
  else if (t.matches("[data-retry]")) loadStudents();
  else if (t.matches("[data-page]")) { state.page += +t.dataset.page; renderTable(); icons(); }
  else if (t.matches("[data-act]")) {
    const id = t.closest("tr").dataset.id;
    if (t.dataset.act === "view") openDetails(id);
    if (t.dataset.act === "edit") openEdit(id);
    if (t.dataset.act === "delete") confirmDelete(state.students.find(s => s.id === id));
  }
});

$("#search").addEventListener("input", e => { state.q = e.target.value; state.page = 1; if (state.view !== "students") setView("students"); else render(); });
$("#courseFilter").addEventListener("change", e => { state.course = e.target.value; state.page = 1; render(); });
$("#sortBy").addEventListener("change", e => { state.sort = e.target.value; render(); });
$("#refreshBtn").addEventListener("click", () => loadStudents(true));
$("#themeBtn").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#collapseBtn").addEventListener("click", () => $("#app").classList.toggle("collapsed"));
$("#menuBtn").addEventListener("click", () => $("#app").classList.add("open"));
$("#scrim").addEventListener("click", () => $("#app").classList.remove("open"));
$("#testBtn").addEventListener("click", async () => {
  try { await api.list(); toast("Connected to the backend"); } catch (e) { toast(e.message, "error"); }
});

/* ============ Init ============ */
document.documentElement.dataset.theme = localStorage.getItem("sh-theme") || "dark";
$("#apiUrl").textContent = API_BASE_URL;
$("#today").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
loadStudents();