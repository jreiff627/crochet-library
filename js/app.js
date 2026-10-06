const BUCKET = "patterns";
document.getElementById("boot")?.remove();   // app.js loaded, so hide the fallback message
const sb = CONFIG.DEMO ? null : supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let patterns = [];
let thumbUrls = {};          // thumb_path -> signed url
const activeTags = new Set();
let editingId = null;

// ---------- Auth ----------
function startDemo() {
  const colors = ["#c9b8e8", "#a8d5cf", "#f0c9d4", "#cfd8f0", "#e8dcb8", "#b8e0c4"];
  const rows = [
    ["Sleepy Fox Amigurumi", "Hook & Honey", "8 hours", "Worsted", "4.0 mm", "Intermediate", ["amigurumi", "animals", "worsted"]],
    ["Granny Square Blanket", "Studio Loop", "3 weeks", "DK", "4.5 mm", "Beginner", ["blanket", "granny square", "beginner"]],
    ["Cabled Slouch Beanie", "Wool & Willow", "5 hours", "Bulky", "6.5 mm", "Intermediate", ["hat", "bulky", "winter"]],
    ["Mini Cactus Plushie", "Hook & Honey", "2 hours", "Worsted", "3.5 mm", "Beginner", ["amigurumi", "plants", "beginner", "worsted"]],
    ["Market Tote Bag", "Studio Loop", "6 hours", "Cotton", "5.0 mm", "Beginner", ["bag", "cotton", "beginner"]],
    ["Lacy Summer Shawl", "Wool & Willow", "2 weeks", "Fingering", "3.25 mm", "Advanced", ["shawl", "lace", "fingering"]],
  ];
  patterns = rows.map((r, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="${colors[i]}"/><text x="150" y="210" font-size="22" text-anchor="middle" fill="#221c35" font-family="sans-serif">Pattern ${i + 1}</text></svg>`;
    thumbUrls["demo" + i] = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    return { id: "demo" + i, title: r[0], designer: r[1], time_to_make: r[2], yarn_weight: r[3], hook_size: r[4], difficulty: r[5], tags: r[6], thumb_path: "demo" + i, file_path: "" };
  });
  $("login").hidden = true;
  $("app").hidden = false;
  render();
}

async function init() {
  if (CONFIG.DEMO) return startDemo();
  const { data } = await sb.auth.getSession();
  data.session ? showApp() : showLogin();
}

function showLogin() {
  $("app").hidden = true;
  $("login").hidden = false;
}

async function showApp() {
  $("login").hidden = true;
  $("app").hidden = false;
  await loadPatterns();
}

$("loginBtn").onclick = async () => {
  $("loginMsg").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value, password: $("password").value });
  if (error) $("loginMsg").textContent = "Login failed: " + error.message;
  else showApp();
};
$("password").addEventListener("keydown", (e) => e.key === "Enter" && $("loginBtn").click());
$("logoutBtn").onclick = async () => { if (CONFIG.DEMO) return location.reload(); await sb.auth.signOut(); patterns = []; showLogin(); };

// ---------- Data ----------
async function loadPatterns() {
  const { data, error } = await sb.from("patterns").select("*").order("created_at", { ascending: false });
  if (error) { $("count").textContent = "Could not load patterns: " + error.message; return; }
  patterns = data;
  render();                      // show cards right away, thumbnails fill in next
  await loadThumbs();
  render();
}

async function loadThumbs() {
  const paths = patterns.map((p) => p.thumb_path).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {   // batches of 100
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), 3600);
    (data || []).forEach((d) => { if (d.signedUrl) thumbUrls[d.path] = d.signedUrl; });
  }
}

// ---------- Render ----------
function matches(p) {
  for (const t of activeTags) if (!p.tags.includes(t)) return false;     // AND logic
  const q = $("search").value.trim().toLowerCase();
  if (!q) return true;
  return [p.title, p.designer, ...p.tags].some((s) => (s || "").toLowerCase().includes(q));
}

function render() {
  const shown = patterns.filter(matches);
  $("count").textContent = `${shown.length} of ${patterns.length} patterns`;
  $("empty").hidden = shown.length > 0;

  // Active filters (click to remove) and popular tags (click to add)
  $("activeTags").innerHTML = [...activeTags].map((t) =>
    `<button class="chip" data-tag="${esc(t)}" aria-pressed="true" aria-label="Remove filter ${esc(t)}">${esc(t)} &times;</button>`).join("")
    + (activeTags.size > 1 ? `<button class="link" id="clearTags">Clear all</button>` : "");
  const top = tagCounts().filter(([t]) => !activeTags.has(t)).slice(0, 12);
  $("quickTags").innerHTML = top.map(([t, n]) =>
    `<button class="chip" data-tag="${esc(t)}" aria-pressed="false">${esc(t)} (${n})</button>`).join("");

  $("grid").innerHTML = shown.map((p) => {
    const img = thumbUrls[p.thumb_path];
    const facts = [["By", p.designer], ["Time", p.time_to_make], ["Yarn", p.yarn_weight], ["Hook", p.hook_size], ["Level", p.difficulty]]
      .filter(([, v]) => v).map(([k, v]) => `<li><b>${k}:</b> ${esc(v)}</li>`).join("");
    return `<article class="card" data-id="${p.id}" tabindex="0" role="link" aria-label="Open ${esc(p.title)}">
      <img class="thumb" ${img ? `src="${img}"` : ""} alt="First page of ${esc(p.title)}" loading="lazy">
      <h3>${esc(p.title)}</h3>
      <ul class="facts">${facts}</ul>
      <div class="mini">${p.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
      <button class="edit" data-edit="${p.id}">Edit</button>
    </article>`;
  }).join("");
}

// ---------- Interactions ----------
// Tag counts among patterns that match the active tag filters (so suggestions never lead to dead ends)
function tagCounts() {
  const counts = {};
  patterns.filter((p) => [...activeTags].every((t) => p.tags.includes(t)))
    .forEach((p) => p.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  return Object.entries(counts).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
}

let suggestions = [], hi = 0;
function updateSuggest() {
  const q = $("search").value.trim().toLowerCase();
  suggestions = !q ? [] : tagCounts()
    .filter(([t]) => !activeTags.has(t) && t.includes(q))
    .sort((x, y) => (y[0].startsWith(q) - x[0].startsWith(q)) || y[1] - x[1])
    .slice(0, 8);
  hi = 0;
  $("suggest").hidden = suggestions.length === 0;
  $("search").setAttribute("aria-expanded", String(suggestions.length > 0));
  $("suggest").innerHTML = suggestions.map(([t, n], i) =>
    `<li role="option" data-tag="${esc(t)}" aria-selected="${i === hi}">${esc(t)} <small>(${n})</small></li>`).join("");
}
function highlight(i) {
  hi = (i + suggestions.length) % suggestions.length;
  [...$("suggest").children].forEach((li, k) => li.setAttribute("aria-selected", String(k === hi)));
}
function addTag(t) {
  activeTags.add(t);
  $("search").value = "";
  updateSuggest();
  render();
}

$("search").addEventListener("input", () => { render(); updateSuggest(); });
$("search").addEventListener("keydown", (e) => {
  if (!suggestions.length) return;
  if (e.key === "ArrowDown") { e.preventDefault(); highlight(hi + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); highlight(hi - 1); }
  else if (e.key === "Enter") { e.preventDefault(); addTag(suggestions[hi][0]); }
  else if (e.key === "Escape") { suggestions = []; $("suggest").hidden = true; }
});
$("suggest").addEventListener("mousedown", (e) => e.preventDefault());   // keep focus in the search box
$("suggest").addEventListener("click", (e) => {
  const t = e.target.closest("[data-tag]")?.dataset.tag;
  if (t) addTag(t);
});
document.addEventListener("click", (e) => { if (!e.target.closest(".finder")) $("suggest").hidden = true; });

function onTagClick(e) {
  if (e.target.id === "clearTags") { activeTags.clear(); return render(); }
  const t = e.target.closest("[data-tag]")?.dataset.tag;
  if (!t) return;
  activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t);
  render();
}
$("activeTags").addEventListener("click", onTagClick);
$("quickTags").addEventListener("click", onTagClick);

async function openPdf(id) {
  const p = patterns.find((x) => x.id === id);
  if (!p) return;
  if (CONFIG.DEMO) return alert("Demo mode: this would open the PDF for \"" + p.title + "\".");
  const w = window.open("", "_blank");   // open first so mobile browsers don't block the popup
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(p.file_path, 3600);
  if (error) { w?.close(); alert("Could not open this pattern: " + error.message); return; }
  w ? (w.location = data.signedUrl) : (location.href = data.signedUrl);
}

$("grid").addEventListener("click", (e) => {
  const editId = e.target.closest("[data-edit]")?.dataset.edit;
  if (editId) return openEdit(editId);
  const id = e.target.closest(".card")?.dataset.id;
  if (id) openPdf(id);
});
$("grid").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("card")) openPdf(e.target.dataset.id);
});

// ---------- Edit ----------
function openEdit(id) {
  const p = patterns.find((x) => x.id === id);
  editingId = id;
  const f = $("editForm").elements;
  ["title", "designer", "time_to_make", "yarn_weight", "hook_size", "difficulty"].forEach((k) => (f[k].value = p[k] || ""));
  f.tags.value = p.tags.join(", ");
  $("editDlg").showModal();
}
$("cancelEdit").onclick = () => $("editDlg").close();

$("deleteBtn").onclick = async () => {
  const p = patterns.find((x) => x.id === editingId);
  if (!p || !confirm(`Delete "${p.title}"? This permanently removes the PDF and can't be undone.`)) return;
  if (!CONFIG.DEMO) {
    const files = [p.file_path, p.thumb_path].filter(Boolean);
    const { data, error } = await sb.storage.from(BUCKET).remove(files);
    if (error || !data || data.length < files.length) {
      return alert("Could not delete the files. Make sure you ran the delete policy from schema.sql in Supabase." + (error ? " (" + error.message + ")" : ""));
    }
    const { error: rowError } = await sb.from("patterns").delete().eq("id", editingId);
    if (rowError) return alert("Could not delete the pattern: " + rowError.message);
  }
  patterns = patterns.filter((x) => x.id !== editingId);
  $("editDlg").close();
  render();
};


$("editForm").addEventListener("submit", async () => {
  const f = $("editForm").elements;
  const update = {};
  ["title", "designer", "time_to_make", "yarn_weight", "hook_size", "difficulty"].forEach((k) => (update[k] = f[k].value.trim() || null));
  update.title = update.title || "Untitled pattern";
  update.tags = [...new Set(f.tags.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (!CONFIG.DEMO) {
    const { error } = await sb.from("patterns").update(update).eq("id", editingId);
    if (error) return alert("Could not save changes: " + error.message);
  }
  Object.assign(patterns.find((x) => x.id === editingId), update);
  render();
});

init();