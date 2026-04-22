"use strict";

/* ------------------------------------------------------------------ *
 *  Sora Studio — video production planning
 *  Single-file vanilla JS. Persists to localStorage.
 * ------------------------------------------------------------------ */

const STORAGE_KEY = "sora-studio.v1";

const uid = () => Math.random().toString(36).slice(2, 9);

function newShot(overrides = {}) {
  const base = {
    id: uid(),
    title: "",
    duration: 8,
    shotType: "",
    subject: "",
    action: "",
    setting: "",
    timeOfDay: "",
    weather: "",
    lighting: "",
    mood: "",
    camera: "",
    lens: "",
    filmStock: "",
    audio: "",
    transition: "",
    description: "",
    avoid: "",
    notes: "",
    prompt: "",
    promptLocked: false,
  };
  return { ...base, ...overrides };
}

function freshState() {
  return {
    project: {
      title: "Untitled Project",
      logline: "",
      aspectRatio: "16:9",
      resolution: "1080p",
      style: "",
      styleNotes: "",
    },
    shots: [
      newShot({
        title: "Opening shot",
        duration: 8,
        shotType: "Wide",
        subject: "",
        action: "",
        setting: "",
      }),
    ],
    activeShotId: null,
  };
}

/* -------------------------- state -------------------------- */

let state = loadState();
if (state.shots.length) {
  const hasActive = state.shots.some((s) => s.id === state.activeShotId);
  if (!hasActive) state.activeShotId = state.shots[0].id;
} else {
  state.activeShotId = null;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed.project || !Array.isArray(parsed.shots)) return freshState();
    parsed.project = { ...freshState().project, ...parsed.project };
    parsed.shots = parsed.shots.map((s) => ({ ...newShot(), ...s }));
    return parsed;
  } catch (e) {
    console.warn("Failed to load saved state, starting fresh.", e);
    return freshState();
  }
}

let saveTimer = null;
function saveState() {
  setSaveStatus("dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
    }
  }, 250);
}

function setSaveStatus(kind) {
  const el = document.getElementById("save-indicator");
  if (!el) return;
  el.classList.remove("dirty", "saved", "error");
  if (kind === "dirty") { el.textContent = "Saving…"; el.classList.add("dirty"); }
  else if (kind === "saved") { el.textContent = "Saved locally"; el.classList.add("saved"); }
  else if (kind === "error") { el.textContent = "Save failed — storage full?"; el.classList.add("error"); }
}

function activeShot() {
  return state.shots.find((s) => s.id === state.activeShotId) || null;
}

/* -------------------------- prompt assembly -------------------------- */

const PROJECT_PROMPT_FIELDS = new Set(["aspectRatio", "resolution", "style", "styleNotes"]);

function sentence(s) {
  const trimmed = (s ?? "").trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : trimmed + ".";
}

function buildPrompt(shot, project) {
  const parts = [];
  const push = (s) => { const out = sentence(s); if (out) parts.push(out); };

  const framing = [shot.shotType, shot.lens && `${shot.lens} lens`].filter(Boolean).join(", ");
  push(framing);

  const subjectClause = [shot.subject, shot.action].filter(Boolean).join(" ");
  const where = [shot.setting, shot.timeOfDay, shot.weather].filter(Boolean).join(", ");
  if (subjectClause && where) push(`${subjectClause} — ${where}`);
  else if (subjectClause) push(subjectClause);
  else if (where) push(where);

  push(shot.description);
  if (shot.lighting) push(`Lighting: ${shot.lighting}`);
  if (shot.mood) push(`Mood: ${shot.mood}`);
  if (shot.camera) push(`Camera: ${shot.camera}`);

  const grain = [shot.filmStock, project.style].filter(Boolean).join(" · ");
  if (grain) push(`Look: ${grain}`);
  if (project.styleNotes) push(`Continuity: ${project.styleNotes.trim()}`);

  if (shot.audio) push(`Audio: ${shot.audio}`);
  if (shot.transition) push(`Ends on a ${shot.transition.toLowerCase()} into the next shot`);

  const meta = [
    project.aspectRatio && `${project.aspectRatio} frame`,
    project.resolution,
    shot.duration && `${shot.duration}-second clip`,
  ].filter(Boolean).join(", ");
  push(meta);

  if (shot.avoid) push(`Avoid: ${shot.avoid}`);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/* -------------------------- DOM bindings -------------------------- */

const els = {
  shotsList: document.getElementById("shots"),
  editorEmpty: document.getElementById("editor-empty"),
  editorForm: document.getElementById("editor-form"),
  promptOutput: document.getElementById("prompt-output"),
  timeline: document.getElementById("timeline"),
  checks: document.getElementById("checks"),
  fileInput: document.getElementById("file-input"),
};

/* Bind inputs with data-bind="project.X" directly to state. */
function bindProjectInputs() {
  document.querySelectorAll("[data-bind]").forEach((el) => {
    const path = el.getAttribute("data-bind").split(".");
    const get = () => path.reduce((o, k) => (o ? o[k] : ""), state);
    const set = (v) => {
      let o = state;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      o[path[path.length - 1]] = v;
    };

    const apply = () => {
      const val = get();
      if (el.isContentEditable) { if (el.textContent !== val) el.textContent = val ?? ""; }
      else if (el.tagName === "SELECT") { el.value = val ?? ""; }
      else { if (el.value !== val) el.value = val ?? ""; }
    };
    apply();
    el._bindApply = apply;

    const evt = el.isContentEditable ? "input" : (el.tagName === "SELECT" ? "change" : "input");
    el.addEventListener(evt, () => {
      const v = el.isContentEditable ? el.textContent : el.value;
      set(v);
      saveState();
      renderDerived();
      if (path[0] === "project" && PROJECT_PROMPT_FIELDS.has(path[1])) regenerateAllUnlockedPrompts();
    });
    el.addEventListener("blur", apply);
  });
}

function bindShotEditorInputs() {
  document.querySelectorAll("[data-field]").forEach((el) => {
    const field = el.getAttribute("data-field");
    const handler = () => {
      const shot = activeShot();
      if (!shot) return;
      let val;
      if (el.type === "checkbox") val = el.checked;
      else if (el.type === "number") val = el.value === "" ? "" : Number(el.value);
      else val = el.value;
      shot[field] = val;

      if (field === "prompt") {
        // user edited prompt directly — auto-lock if they've added content
        if (val && !shot.promptLocked) {
          shot.promptLocked = true;
          const lock = document.querySelector('[data-field="promptLocked"]');
          if (lock) lock.checked = true;
        }
      } else if (field === "promptLocked" && !val) {
        // unlocking — regenerate from fields
        shot.prompt = buildPrompt(shot, state.project);
        els.promptOutput.value = shot.prompt;
      } else if (field !== "notes" && field !== "promptLocked") {
        if (!shot.promptLocked) {
          shot.prompt = buildPrompt(shot, state.project);
          els.promptOutput.value = shot.prompt;
        }
      }

      if (field === "title" || field === "duration" || field === "subject" || field === "action" || field === "shotType") {
        renderShotList();
      }
      updatePromptMeta();
      renderDerived();
      saveState();
    };
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, handler);
  });
}

function regenerateAllUnlockedPrompts() {
  state.shots.forEach((s) => {
    if (!s.promptLocked) s.prompt = buildPrompt(s, state.project);
  });
  const shot = activeShot();
  if (shot && !shot.promptLocked && els.promptOutput) {
    els.promptOutput.value = shot.prompt;
    updatePromptMeta();
  }
}

/* -------------------------- rendering -------------------------- */

function renderShotList() {
  const tpl = document.getElementById("shot-item-template");
  els.shotsList.innerHTML = "";
  state.shots.forEach((shot, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = shot.id;
    node.querySelector(".shot-index").textContent = String(i + 1).padStart(2, "0");
    node.querySelector(".shot-title").textContent = shot.title || "Untitled shot";
    const sub = [shot.shotType, shot.subject].filter(Boolean).join(" · ");
    node.querySelector(".shot-sub").textContent = sub || "Describe the shot";
    node.querySelector(".shot-duration").textContent = shot.duration ? `${shot.duration}s` : "—";
    if (shot.id === state.activeShotId) node.classList.add("active");

    node.addEventListener("click", () => selectShot(shot.id));
    attachDnD(node);
    els.shotsList.appendChild(node);
  });
}

function renderEditor() {
  const shot = activeShot();
  if (!shot) {
    els.editorEmpty.hidden = false;
    els.editorForm.hidden = true;
    return;
  }
  els.editorEmpty.hidden = true;
  els.editorForm.hidden = false;

  document.querySelectorAll("[data-field]").forEach((el) => {
    const f = el.getAttribute("data-field");
    const v = shot[f];
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  });

  if (!shot.promptLocked) {
    shot.prompt = buildPrompt(shot, state.project);
    els.promptOutput.value = shot.prompt;
  }
  updatePromptMeta();
}

function updatePromptMeta() {
  const el = els.promptOutput;
  if (!el) return;
  const text = el.value || "";
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  setBind("shot.charCount", `${text.length} chars`);
  setBind("shot.wordCount", `${wordCount} words`);
}

function renderTimeline() {
  els.timeline.innerHTML = "";
  const total = totalRuntime();
  state.shots.forEach((shot, i) => {
    const block = document.createElement("div");
    block.className = "tl-block";
    if (shot.id === state.activeShotId) block.classList.add("active");
    const dur = Number(shot.duration) || 0;
    const flex = total > 0 ? Math.max(1, (dur / total) * 100) : 1;
    block.style.flex = `${flex} 1 0`;
    block.innerHTML = `<span>${String(i + 1).padStart(2, "0")}</span><span>${dur}s</span>`;
    block.title = `${shot.title || "Untitled"} — ${dur}s`;
    block.addEventListener("click", () => selectShot(shot.id));
    els.timeline.appendChild(block);
  });
}

function totalRuntime() {
  return state.shots.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
}

function formatRuntime(seconds) {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function renderDerived() {
  const total = totalRuntime();
  const longest = state.shots.reduce((max, s) => Math.max(max, Number(s.duration) || 0), 0);
  setBind("project.runtime", formatRuntime(total));
  setBind("project.shotCount", String(state.shots.length));
  setBind("project.longestShot", longest ? `${longest}s` : "—");
  setBind("project.aspectRatio", state.project.aspectRatio);
  setBind("project.resolution", state.project.resolution);
  renderTimeline();
  renderChecks();
}

function setBind(key, val) {
  document.querySelectorAll(`[data-bind-text="${key}"]`).forEach((el) => {
    el.textContent = val;
  });
}

function renderChecks() {
  const list = [];
  const total = totalRuntime();
  const longShots = state.shots.filter((s) => Number(s.duration) > 20);
  const emptyShots = state.shots.filter((s) => !s.subject && !s.action && !s.description);
  const missingCamera = state.shots.filter((s) => !s.camera);

  if (!state.shots.length) list.push({ kind: "warn", text: "No shots yet — add your first one." });
  if (total > 0) list.push({ kind: "info", text: `Planned runtime: ${formatRuntime(total)} across ${state.shots.length} shots.` });
  if (longShots.length) list.push({ kind: "warn", text: `${longShots.length} shot${longShots.length>1?"s":""} exceed 20s — Sora renders shorter clips reliably; consider splitting.` });
  if (emptyShots.length) list.push({ kind: "warn", text: `${emptyShots.length} shot${emptyShots.length>1?"s":""} missing subject / action.` });
  if (missingCamera.length) list.push({ kind: "info", text: `${missingCamera.length} shot${missingCamera.length>1?"s":""} without a camera move — Sora will default to static.` });
  if (!state.project.styleNotes) list.push({ kind: "info", text: "Tip: fill the style reference to keep characters and palette consistent across shots." });
  if (state.shots.length && !list.some((item) => item.kind === "warn")) {
    list.unshift({ kind: "ok", text: "Looks ready to render." });
  }

  els.checks.innerHTML = "";
  list.forEach((item) => {
    const li = document.createElement("li");
    li.className = item.kind;
    li.textContent = item.text;
    els.checks.appendChild(li);
  });
}

/* -------------------------- selection / shot ops -------------------------- */

function selectShot(id) {
  state.activeShotId = id;
  saveState();
  renderShotList();
  renderEditor();
  renderTimeline();
}

function addShot(afterId) {
  const shot = newShot({ title: `Shot ${state.shots.length + 1}`, duration: 8 });
  const idx = afterId ? state.shots.findIndex((s) => s.id === afterId) : state.shots.length - 1;
  state.shots.splice(idx + 1, 0, shot);
  state.activeShotId = shot.id;
  saveState();
  renderShotList();
  renderEditor();
  renderDerived();
}

function duplicateShot() {
  const shot = activeShot();
  if (!shot) return;
  const copy = { ...shot, id: uid(), title: (shot.title || "Untitled") + " (copy)" };
  const idx = state.shots.findIndex((s) => s.id === shot.id);
  state.shots.splice(idx + 1, 0, copy);
  state.activeShotId = copy.id;
  saveState();
  renderShotList();
  renderEditor();
  renderDerived();
}

function deleteShot() {
  const shot = activeShot();
  if (!shot) return;
  if (state.shots.length === 1) {
    if (!confirm("This is the only shot. Delete and start empty?")) return;
  }
  const idx = state.shots.findIndex((s) => s.id === shot.id);
  state.shots.splice(idx, 1);
  state.activeShotId = state.shots[Math.min(idx, state.shots.length - 1)]?.id || null;
  saveState();
  renderShotList();
  renderEditor();
  renderDerived();
}

/* -------------------------- drag and drop reorder -------------------------- */

let dragSrcId = null;
function attachDnD(node) {
  node.addEventListener("dragstart", (e) => {
    dragSrcId = node.dataset.id;
    node.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragSrcId);
  });
  node.addEventListener("dragend", () => {
    node.classList.remove("dragging");
    document.querySelectorAll(".shot-item").forEach((n) =>
      n.classList.remove("drop-before", "drop-after")
    );
    dragSrcId = null;
  });
  node.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!dragSrcId || dragSrcId === node.dataset.id) return;
    const rect = node.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    node.classList.toggle("drop-before", before);
    node.classList.toggle("drop-after", !before);
  });
  node.addEventListener("dragleave", () => {
    node.classList.remove("drop-before", "drop-after");
  });
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragSrcId || dragSrcId === node.dataset.id) return;
    const targetId = node.dataset.id;
    const before = node.classList.contains("drop-before");
    const srcIdx = state.shots.findIndex((s) => s.id === dragSrcId);
    const [src] = state.shots.splice(srcIdx, 1);
    let tgtIdx = state.shots.findIndex((s) => s.id === targetId);
    if (!before) tgtIdx += 1;
    state.shots.splice(tgtIdx, 0, src);
    saveState();
    renderShotList();
    renderDerived();
  });
}

/* -------------------------- import / export -------------------------- */

function download(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function slugify(s) {
  return (s || "sora-project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function promptFor(shot) {
  return shot.promptLocked ? (shot.prompt ?? "") : buildPrompt(shot, state.project);
}

function exportJSON() {
  download(`${slugify(state.project.title)}.json`, JSON.stringify(state, null, 2), "application/json");
}

function exportBrief() {
  const p = state.project;
  const lines = [];
  lines.push(`# ${p.title || "Untitled Project"}`);
  if (p.logline) lines.push(`\n> ${p.logline}`);
  lines.push("");
  lines.push(`- Aspect: ${p.aspectRatio} · Resolution: ${p.resolution}${p.style ? ` · Style: ${p.style}` : ""}`);
  lines.push(`- Shots: ${state.shots.length} · Total runtime: ${formatRuntime(totalRuntime())}`);
  if (p.styleNotes) lines.push(`\n**Continuity / style reference**\n\n${p.styleNotes}`);
  lines.push("\n---\n");

  state.shots.forEach((s, i) => {
    const num = String(i + 1).padStart(2, "0");
    lines.push(`## ${num} — ${s.title || "Untitled shot"}  ·  ${s.duration || 0}s`);
    const facts = [
      s.shotType && `**Shot**: ${s.shotType}`,
      s.lens && `**Lens**: ${s.lens}`,
      s.filmStock && `**Stock**: ${s.filmStock}`,
      s.timeOfDay && `**Time**: ${s.timeOfDay}`,
      s.weather && `**Weather**: ${s.weather}`,
    ].filter(Boolean);
    if (facts.length) lines.push(facts.join(" · "));
    if (s.subject || s.action) lines.push(`\n*Subject*: ${[s.subject, s.action].filter(Boolean).join(" — ")}`);
    if (s.setting) lines.push(`*Setting*: ${s.setting}`);
    if (s.lighting) lines.push(`*Lighting*: ${s.lighting}`);
    if (s.camera) lines.push(`*Camera*: ${s.camera}`);
    if (s.mood) lines.push(`*Mood*: ${s.mood}`);
    if (s.audio) lines.push(`*Audio*: ${s.audio}`);
    if (s.transition) lines.push(`*Transition out*: ${s.transition}`);
    if (s.description) lines.push(`\n${s.description}`);
    if (s.avoid) lines.push(`\n_Avoid: ${s.avoid}_`);
    if (s.notes) lines.push(`\n> Production notes: ${s.notes}`);
    lines.push(`\n**Sora prompt**\n\n\`\`\`\n${promptFor(s)}\n\`\`\``);
    lines.push("\n---\n");
  });

  download(`${slugify(p.title)}-brief.md`, lines.join("\n"), "text/markdown");
}

function promptsAsPlainText() {
  return state.shots.map((s, i) => {
    const n = String(i + 1).padStart(2, "0");
    const header = `# Shot ${n} — ${s.title || "Untitled"} (${s.duration || 0}s)`;
    return `${header}\n${promptFor(s)}`;
  }).join("\n\n");
}

async function copyAllPrompts() {
  const text = promptsAsPlainText();
  try {
    await navigator.clipboard.writeText(text);
    flashButton('[data-action="export-prompts"]', "Copied!");
  } catch {
    download(`${slugify(state.project.title)}-prompts.txt`, text);
  }
}

async function copyActivePrompt() {
  const shot = activeShot();
  if (!shot) return;
  try {
    await navigator.clipboard.writeText(els.promptOutput.value);
    flashButton('[data-action="copy-prompt"]', "Copied");
  } catch {}
}

function flashButton(selector, label) {
  const btn = document.querySelector(selector);
  if (!btn) return;
  const prev = btn.textContent;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1200);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.project || !Array.isArray(parsed.shots)) throw new Error("Invalid file");
      state = parsed;
      state.project = { ...freshState().project, ...parsed.project };
      state.shots = state.shots.map((s) => ({ ...newShot(), ...s }));
      state.activeShotId = state.shots[0]?.id || null;
      saveState();
      rerenderAll();
    } catch (e) {
      alert("Couldn't import that file — make sure it's a Sora Studio JSON export.");
    }
  };
  reader.readAsText(file);
}

function newProject() {
  if (!confirm("Start a new project? Your current work will be replaced (export first if you want to keep it).")) return;
  state = freshState();
  state.activeShotId = state.shots[0].id;
  saveState();
  rerenderAll();
}

function rerenderAll() {
  document.querySelectorAll("[data-bind]").forEach((el) => el._bindApply && el._bindApply());
  renderShotList();
  renderEditor();
  renderDerived();
}

/* -------------------------- wiring -------------------------- */

function wireActions() {
  document.querySelectorAll("[data-action]").forEach((el) => {
    const action = el.getAttribute("data-action");
    el.addEventListener("click", () => {
      switch (action) {
        case "add-shot": addShot(state.activeShotId); break;
        case "duplicate-shot": duplicateShot(); break;
        case "delete-shot": deleteShot(); break;
        case "new-project": newProject(); break;
        case "import": els.fileInput.click(); break;
        case "export-json": exportJSON(); break;
        case "export-brief": exportBrief(); break;
        case "export-prompts": copyAllPrompts(); break;
        case "regenerate-prompt": {
          const shot = activeShot();
          if (!shot) return;
          shot.promptLocked = false;
          shot.prompt = buildPrompt(shot, state.project);
          document.querySelector('[data-field="promptLocked"]').checked = false;
          els.promptOutput.value = shot.prompt;
          updatePromptMeta();
          saveState();
          break;
        }
        case "copy-prompt": copyActivePrompt(); break;
      }
    });
  });

  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importJSON(file);
    e.target.value = "";
  });
}

function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const active = document.activeElement;
    const inText = active && (
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable
    );
    if (inText) return;
    if (e.key === "Enter") {
      e.preventDefault();
      addShot(state.activeShotId);
    } else if (e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateShot();
    }
  });
}

/* -------------------------- boot -------------------------- */

function boot() {
  bindProjectInputs();
  bindShotEditorInputs();
  wireActions();
  wireKeyboard();
  renderShotList();
  renderEditor();
  renderDerived();
  setSaveStatus("saved");
}

document.addEventListener("DOMContentLoaded", boot);
