"use strict";

/* ------------------------------------------------------------------ *
 *  Veo Studio — production planning for Google Veo 3.1
 *  Single-file vanilla JS. Persists to localStorage.
 *
 *  Veo 3.1 facts the planner respects:
 *  - Native aspect ratios: 16:9, 9:16
 *  - Resolutions: 720p, 1080p, 4K (3840×2160)
 *  - Clip duration: 4, 6, or 8 seconds
 *  - Native synced audio at 48 kHz stereo (dialogue, SFX, ambient, music)
 *  - Up to 3 reference images for character / style consistency
 *  - First-frame / last-frame guidance for chained clips
 *  - Prompt token budget around ~1024 tokens
 * ------------------------------------------------------------------ */

const STORAGE_KEY = "veo-studio.v1";
const LEGACY_SORA_KEY = "sora-studio.v1";
const VEO_VALID_DURATIONS = [4, 6, 8];
const VEO_VALID_ASPECTS = new Set(["16:9", "9:16"]);
const VEO_VALID_RESOLUTIONS = new Set(["720p", "1080p", "4K"]);
const PROMPT_TOKEN_BUDGET = 1024;

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
    dialogue: "",
    sfx: "",
    ambient: "",
    music: "",
    referenceImages: "",
    referenceImageData: [],
    firstFrame: "",
    lastFrame: "",
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
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.project || !Array.isArray(parsed.shots)) return freshState();
      parsed.project = normalizeProject(parsed.project);
      parsed.shots = parsed.shots.map((s) => migrateShot(s));
      return parsed;
    }
    // First run on Veo Studio — try to migrate from old Sora Studio data.
    const legacy = localStorage.getItem(LEGACY_SORA_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (parsed.project && Array.isArray(parsed.shots)) {
        parsed.project = normalizeProject(parsed.project);
        parsed.shots = parsed.shots.map((s) => migrateShot(s));
        return parsed;
      }
    }
    return freshState();
  } catch (e) {
    console.warn("Failed to load saved state, starting fresh.", e);
    return freshState();
  }
}

function normalizeProject(raw) {
  const merged = { ...freshState().project, ...raw };
  if (!VEO_VALID_ASPECTS.has(merged.aspectRatio)) merged.aspectRatio = "16:9";
  if (!VEO_VALID_RESOLUTIONS.has(merged.resolution)) merged.resolution = "1080p";
  return merged;
}

function migrateShot(raw) {
  const merged = { ...newShot(), ...raw };
  // Sora Studio kept all audio direction in a single `audio` field. Migrate
  // it into Veo's ambient slot if no Veo-specific audio fields are set.
  if (raw && typeof raw.audio === "string" && raw.audio.trim() &&
      !merged.dialogue && !merged.sfx && !merged.ambient && !merged.music) {
    merged.ambient = raw.audio.trim();
  }
  delete merged.audio;
  // Snap duration to a Veo-supported value if the legacy data was off.
  const dur = Number(merged.duration) || 8;
  merged.duration = nearestValidDuration(dur);
  return merged;
}

function nearestValidDuration(n) {
  return VEO_VALID_DURATIONS.reduce((best, d) =>
    Math.abs(d - n) < Math.abs(best - n) ? d : best,
  VEO_VALID_DURATIONS[VEO_VALID_DURATIONS.length - 1]);
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

// Veo 3.1 reads dialogue inside quotation marks. If the user already
// quoted lines, leave them; otherwise wrap each non-empty line.
function formatDialogue(raw) {
  if (!raw) return "";
  return raw.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => /["“”].*["“”]/.test(line) ? line : `"${line.replace(/^["'“”]|["'“”]$/g, "")}"`)
    .join(" ");
}

function formatReferences(raw) {
  if (!raw) return [];
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
}

// Token estimate — Gemini's actual tokenizer is BPE; ~4 chars/token is a
// good rule of thumb for English. Used only to warn near the budget.
function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

function buildPrompt(shot, project) {
  const parts = [];
  const push = (s) => { const out = sentence(s); if (out) parts.push(out); };

  // Camera & framing — Veo's prompt guide puts this first.
  const framing = [shot.shotType, shot.lens && `${shot.lens} lens`].filter(Boolean).join(", ");
  push(framing);
  if (shot.camera) push(`Camera: ${shot.camera}`);

  // Subject + action + environment.
  const subjectClause = [shot.subject, shot.action].filter(Boolean).join(" ");
  const where = [shot.setting, shot.timeOfDay, shot.weather].filter(Boolean).join(", ");
  if (subjectClause && where) push(`${subjectClause} — ${where}`);
  else if (subjectClause) push(subjectClause);
  else if (where) push(where);

  push(shot.description);
  if (shot.lighting) push(`Lighting: ${shot.lighting}`);
  if (shot.mood) push(`Mood: ${shot.mood}`);

  // Look (style + film stock).
  const grain = [shot.filmStock, project.style].filter(Boolean).join(" · ");
  if (grain) push(`Look: ${grain}`);
  if (project.styleNotes) push(`Continuity: ${project.styleNotes.trim()}`);

  // Native audio — Veo 3.1's headline feature. Order: dialogue, SFX, ambient, music.
  const dialogue = formatDialogue(shot.dialogue);
  if (dialogue) push(`Dialogue: ${dialogue}`);
  if (shot.sfx) push(`SFX: ${shot.sfx}`);
  if (shot.ambient) push(`Ambient: ${shot.ambient}`);
  if (shot.music) push(`Music: ${shot.music}`);

  // Frame guidance for chained clips / image-to-video.
  if (shot.firstFrame) push(`Opening frame: ${shot.firstFrame}`);
  if (shot.lastFrame) push(`Closing frame: ${shot.lastFrame}`);

  // Reference images — describe what each anchors.
  const refs = formatReferences(shot.referenceImages);
  if (refs.length) {
    push(`Reference images (${refs.length}): ${refs.join("; ")}`);
  }

  if (shot.transition) push(`Ends on a ${shot.transition.toLowerCase()} into the next shot`);

  // Output spec.
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
  // generation
  settingsModal: null,
  apiKeyInput: null,
  modelSelect: null,
  personGenSelect: null,
  generationPane: null,
  videoPlayer: null,
  generationStatus: null,
  refUploadInput: null,
  refThumbs: null,
  renderAllBtn: null,
};

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
      else if (field === "duration") val = Number(el.value) || 8;
      else val = el.value;
      shot[field] = val;

      if (field === "prompt") {
        if (val && !shot.promptLocked) {
          shot.promptLocked = true;
          const lock = document.querySelector('[data-field="promptLocked"]');
          if (lock) lock.checked = true;
        }
      } else if (field === "promptLocked" && !val) {
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
  if (!tpl || !els.shotsList) return;
  els.shotsList.innerHTML = "";
  state.shots.forEach((shot, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = shot.id;
    node.querySelector(".shot-index").textContent = String(i + 1).padStart(2, "0");
    node.querySelector(".shot-title").textContent = shot.title || "Untitled shot";
    const sub = [shot.shotType, shot.subject].filter(Boolean).join(" · ");
    node.querySelector(".shot-sub").textContent = sub || "Describe the shot";
    node.querySelector(".shot-duration").textContent = shot.duration ? `${shot.duration}s` : "—";
    const statusEl = node.querySelector(".shot-status");
    if (statusEl) {
      const g = generations.get(shot.id);
      const status = g?.status || "idle";
      statusEl.dataset.status = status;
      statusEl.textContent = status === "idle" ? "" : (STATUS_LABELS[status] || status);
    }
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
  const tokens = estimateTokens(text);
  setBind("shot.charCount", `${text.length} chars`);
  setBind("shot.wordCount", `${wordCount} words`);
  setBind("shot.tokenEstimate", `~${tokens} tokens`);
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
  const offDuration = state.shots.filter((s) => !VEO_VALID_DURATIONS.includes(Number(s.duration)));
  const emptyShots = state.shots.filter((s) => !s.subject && !s.action && !s.description);
  const missingCamera = state.shots.filter((s) => !s.camera);
  const tooManyRefs = state.shots.filter((s) =>
    (s.referenceImages || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length > 3
  );
  const longPrompts = state.shots.filter((s) =>
    estimateTokens(promptFor(s)) > PROMPT_TOKEN_BUDGET
  );
  const noAudio = state.shots.filter((s) =>
    !s.dialogue && !s.sfx && !s.ambient && !s.music
  );

  if (!state.shots.length) {
    list.push({ kind: "warn", text: "No shots yet — add your first one." });
  }
  if (total > 0) {
    list.push({ kind: "info", text: `Planned runtime: ${formatRuntime(total)} across ${state.shots.length} shots.` });
  }
  if (offDuration.length) {
    list.push({ kind: "warn", text: `${offDuration.length} shot${offDuration.length>1?"s":""} not at 4 / 6 / 8 s — Veo 3.1 only renders those native lengths.` });
  }
  if (state.project.resolution === "4K") {
    list.push({ kind: "info", text: "4K output uses more tokens and takes longer; check your Google AI Pro quota." });
  }
  if (emptyShots.length) {
    list.push({ kind: "warn", text: `${emptyShots.length} shot${emptyShots.length>1?"s":""} missing subject / action.` });
  }
  if (missingCamera.length) {
    list.push({ kind: "info", text: `${missingCamera.length} shot${missingCamera.length>1?"s":""} without a camera move — Veo will default to static or subtle handheld.` });
  }
  if (tooManyRefs.length) {
    list.push({ kind: "warn", text: `${tooManyRefs.length} shot${tooManyRefs.length>1?"s":""} list more than 3 reference images — Veo 3.1 caps at 3.` });
  }
  if (longPrompts.length) {
    list.push({ kind: "warn", text: `${longPrompts.length} prompt${longPrompts.length>1?"s":""} exceed ~${PROMPT_TOKEN_BUDGET} tokens; Veo may truncate.` });
  }
  if (state.shots.length && noAudio.length === state.shots.length) {
    list.push({ kind: "info", text: "Tip: Veo 3.1 generates synced audio natively — fill dialogue, SFX, or ambient on at least one shot." });
  }
  if (!state.project.styleNotes) {
    list.push({ kind: "info", text: "Tip: fill the style reference to keep characters and palette consistent across shots." });
  }
  if (state.shots.length && !list.some((item) => item.kind === "warn")) {
    list.unshift({ kind: "ok", text: "Looks ready to render with Veo 3.1." });
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
  return (s || "veo-project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
  lines.push(`- Model: **Google Veo 3.1**`);
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

    const audioBits = [
      s.dialogue && `*Dialogue*: ${s.dialogue.replace(/\s+/g, " ").trim()}`,
      s.sfx && `*SFX*: ${s.sfx}`,
      s.ambient && `*Ambient*: ${s.ambient}`,
      s.music && `*Music*: ${s.music}`,
    ].filter(Boolean);
    if (audioBits.length) lines.push("\n" + audioBits.join("  \n"));

    const refs = formatReferences(s.referenceImages);
    if (refs.length) {
      lines.push(`\n*Reference images*:\n` + refs.map((r) => `- ${r}`).join("\n"));
    }
    if (s.firstFrame) lines.push(`*Opening frame*: ${s.firstFrame}`);
    if (s.lastFrame) lines.push(`*Closing frame*: ${s.lastFrame}`);
    if (s.transition) lines.push(`*Transition out*: ${s.transition}`);
    if (s.description) lines.push(`\n${s.description}`);
    if (s.avoid) lines.push(`\n_Avoid: ${s.avoid}_`);
    if (s.notes) lines.push(`\n> Production notes: ${s.notes}`);
    lines.push(`\n**Veo 3.1 prompt**\n\n\`\`\`\n${promptFor(s)}\n\`\`\``);
    lines.push("\n---\n");
  });

  download(`${slugify(p.title)}-brief.md`, lines.join("\n"), "text/markdown");
}

function promptsAsPlainText() {
  return state.shots.map((s, i) => {
    const n = String(i + 1).padStart(2, "0");
    const header = `# Shot ${n} — ${s.title || "Untitled"} (${s.duration || 0}s · ${state.project.aspectRatio} · ${state.project.resolution})`;
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
      state.project = normalizeProject(parsed.project);
      state.shots = state.shots.map((s) => migrateShot(s));
      state.activeShotId = state.shots[0]?.id || null;
      saveState();
      rerenderAll();
    } catch (e) {
      alert("Couldn't import that file — make sure it's a Veo Studio (or Sora Studio) JSON export.");
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

/* ====================================================================== *
 *                       Veo 3.1 generation client
 * ====================================================================== */

const SETTINGS_KEY = "veo-studio.settings.v1";
const VEO_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "veo-3.1-generate-preview";

const settings = loadSettings();
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch (e) { /* fall through */ }
  return defaultSettings();
}
function defaultSettings() {
  return {
    apiKey: "",
    model: DEFAULT_MODEL,
    personGeneration: "allow_all",
    pollIntervalMs: 8000,
    maxPollMs: 10 * 60 * 1000,
  };
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

// Per-shot generation state — kept in memory only. Videos as object URLs.
// Map<shotId, { status, operationName, videoUrl, videoBlob, error, startedAt, finishedAt, log[] }>
const generations = new Map();

const STATUS_LABELS = {
  idle: "Idle",
  queued: "Queued",
  generating: "Generating",
  ready: "Ready",
  error: "Failed",
};

function getGen(shotId) {
  if (!generations.has(shotId)) {
    generations.set(shotId, { status: "idle", operationName: null, videoUrl: null, videoBlob: null, error: null, startedAt: 0, finishedAt: 0, log: [] });
  }
  return generations.get(shotId);
}
function setGen(shotId, patch) {
  const g = { ...getGen(shotId), ...patch };
  generations.set(shotId, g);
  renderShotList();
  if (state.activeShotId === shotId) renderGenerationPane();
  return g;
}
function logGen(shotId, msg) {
  const g = getGen(shotId);
  const stamp = new Date().toLocaleTimeString();
  g.log.push(`[${stamp}] ${msg}`);
  if (g.log.length > 50) g.log = g.log.slice(-50);
  if (state.activeShotId === shotId) renderGenerationPane();
}

/* ----- Veo HTTP API ----- */

const VEO_API_ALLOWED_HOSTS = new Set(["generativelanguage.googleapis.com"]);

async function veoFetch(path, init = {}) {
  if (!settings.apiKey) throw new Error("Add your Gemini API key in Settings first.");
  const isAbsoluteUrl = /^https?:\/\//i.test(path);
  const url = isAbsoluteUrl ? path : `${VEO_API_BASE}/${path.replace(/^\//, "")}`;
  const requestUrl = new URL(url, window.location.href);
  const isTrustedApiRequest = !isAbsoluteUrl || VEO_API_ALLOWED_HOSTS.has(requestUrl.hostname);
  const headers = new Headers(init.headers || {});

  if (isTrustedApiRequest) {
    if (!headers.has("x-goog-api-key")) headers.set("x-goog-api-key", settings.apiKey);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let errText = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      errText = body?.error?.message || JSON.stringify(body);
    } catch {}
    throw new Error(errText);
  }
  return res;
}

function veoParameters(shot, project) {
  // Veo returns 4k as a literal; 720p / 1080p are accepted lowercase.
  const resolutionMap = { "720p": "720p", "1080p": "1080p", "4K": "4k" };
  const params = {
    aspectRatio: project.aspectRatio,
    durationSeconds: Number(shot.duration) || 8,
    resolution: resolutionMap[project.resolution] || "1080p",
    numberOfVideos: 1,
    personGeneration: settings.personGeneration,
  };
  if (shot.avoid?.trim()) params.negativePrompt = shot.avoid.trim();
  return params;
}

async function startGeneration(shot, project) {
  const instance = { prompt: promptFor(shot) };
  // First reference image becomes the conditioning image (first-frame for image-to-video).
  // Additional refs are documented as `referenceImages` with role hints; we add them when present.
  const refs = (shot.referenceImageData || []).filter((r) => r?.dataB64);
  if (refs.length) {
    instance.image = { bytesBase64Encoded: refs[0].dataB64, mimeType: refs[0].mimeType };
    if (refs.length > 1) {
      instance.referenceImages = refs.slice(1, 3).map((r) => ({
        image: { bytesBase64Encoded: r.dataB64, mimeType: r.mimeType },
      }));
    }
  }
  const body = {
    instances: [instance],
    parameters: veoParameters(shot, project),
  };
  const res = await veoFetch(`models/${settings.model}:predictLongRunning`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const opName = json.name || json.operation || json?.operation?.name;
  if (!opName) throw new Error("Veo did not return an operation name. Response: " + JSON.stringify(json).slice(0, 400));
  return opName;
}

async function pollOperation(opName) {
  const path = opName.startsWith("operations/") || opName.includes("/operations/")
    ? opName
    : `operations/${opName}`;
  const res = await veoFetch(path);
  return res.json();
}

function extractVideoSamples(operation) {
  const r = operation?.response;
  if (!r) return [];
  return (
    r.generatedVideos ||
    r.generateVideoResponse?.generatedSamples ||
    r.predictions?.[0]?.generatedSamples ||
    r.predictions?.[0]?.generatedVideos ||
    []
  );
}

async function fetchVideoBlob(sample) {
  // Two shapes: { video: { uri } } or { video: { bytesBase64Encoded, mimeType } } (or top-level)
  const inline = sample?.video?.bytesBase64Encoded || sample?.bytesBase64Encoded;
  const mimeType = sample?.video?.mimeType || sample?.mimeType || "video/mp4";
  if (inline) {
    const bytes = Uint8Array.from(atob(inline), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: mimeType });
  }
  const uri = sample?.video?.uri || sample?.uri;
  if (!uri) throw new Error("Operation finished but contained no video URI or bytes.");
  const res = await veoFetch(uri);
  return res.blob();
}

/* ----- Generation flow per shot ----- */

async function generateShot(shotId, { fromBatch = false } = {}) {
  const shot = state.shots.find((s) => s.id === shotId);
  if (!shot) return;
  const g = getGen(shotId);
  if (g.status === "generating") return;

  // Free any previous video object URL.
  if (g.videoUrl) { URL.revokeObjectURL(g.videoUrl); }

  setGen(shotId, {
    status: "generating",
    operationName: null,
    videoUrl: null,
    videoBlob: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: 0,
    log: [],
  });
  logGen(shotId, `Submitting prompt to ${settings.model} (${shot.duration}s, ${state.project.aspectRatio}, ${state.project.resolution})…`);

  try {
    const opName = await startGeneration(shot, state.project);
    setGen(shotId, { operationName: opName });
    logGen(shotId, `Operation queued: ${opName}`);

    const start = Date.now();
    let delay = settings.pollIntervalMs;
    while (true) {
      if (getGen(shotId).status !== "generating") {
        logGen(shotId, "Cancelled.");
        return;
      }
      await sleep(delay);
      const op = await pollOperation(opName);
      if (op.error) throw new Error(op.error.message || "Operation reported an error.");
      if (op.done) {
        const samples = extractVideoSamples(op);
        if (!samples.length) throw new Error("Operation completed but returned no videos.");
        logGen(shotId, `Render finished in ${Math.round((Date.now() - start) / 1000)}s. Downloading…`);
        const blob = await fetchVideoBlob(samples[0]);
        const url = URL.createObjectURL(blob);
        setGen(shotId, {
          status: "ready",
          videoBlob: blob,
          videoUrl: url,
          finishedAt: Date.now(),
        });
        logGen(shotId, `Ready (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
        return;
      }
      const elapsed = Date.now() - start;
      logGen(shotId, `Polling… (${Math.round(elapsed / 1000)}s elapsed)`);
      if (elapsed > settings.maxPollMs) throw new Error("Timed out waiting for Veo.");
      // Mild backoff up to 20s.
      delay = Math.min(delay + 1000, 20000);
    }
  } catch (e) {
    setGen(shotId, { status: "error", error: e.message || String(e), finishedAt: Date.now() });
    logGen(shotId, `Error: ${e.message || e}`);
    if (!fromBatch) throw e;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----- Batch queue ----- */

let batchAbort = false;
let batchRunning = false;

async function renderAll() {
  if (batchRunning) {
    batchAbort = true;
    return;
  }
  if (!settings.apiKey) {
    openSettings();
    return;
  }
  // Queue every shot that isn't already ready unless the user opts to redo.
  const targets = state.shots.filter((s) => {
    const g = getGen(s.id);
    return g.status !== "ready" || confirmRedo(s);
  });
  if (!targets.length) return;
  batchRunning = true;
  batchAbort = false;
  updateRenderAllButton();
  for (const s of targets) setGen(s.id, { status: "queued" });
  for (const s of targets) {
    if (batchAbort) break;
    await generateShot(s.id, { fromBatch: true });
  }
  batchRunning = false;
  batchAbort = false;
  updateRenderAllButton();
}

let askedRedoOnce = false;
let redoChoice = false;
function confirmRedo(_shot) {
  if (askedRedoOnce) return redoChoice;
  askedRedoOnce = true;
  redoChoice = confirm("Some shots already have rendered videos. Re-render them as well?\n\nOK = re-render everything · Cancel = skip already-rendered shots");
  return redoChoice;
}

function cancelGeneration(shotId) {
  const g = getGen(shotId);
  if (g.status === "generating" || g.status === "queued") {
    setGen(shotId, { status: "error", error: "Cancelled by user.", finishedAt: Date.now() });
  }
}

function updateRenderAllButton() {
  const btn = els.renderAllBtn;
  if (!btn) return;
  if (batchRunning) {
    btn.textContent = "Cancel batch";
    btn.classList.remove("primary");
    btn.classList.add("danger");
  } else {
    btn.textContent = "Render all";
    btn.classList.add("primary");
    btn.classList.remove("danger");
  }
}

/* ----- Settings modal ----- */

function openSettings() {
  if (!els.settingsModal) return;
  els.apiKeyInput.value = settings.apiKey;
  els.modelSelect.value = settings.model;
  els.personGenSelect.value = settings.personGeneration;
  els.settingsModal.hidden = false;
  setTimeout(() => els.apiKeyInput.focus(), 50);
}
function closeSettings() {
  if (!els.settingsModal) return;
  els.settingsModal.hidden = true;
}
function applySettingsFromForm() {
  settings.apiKey = els.apiKeyInput.value.trim();
  settings.model = els.modelSelect.value || DEFAULT_MODEL;
  settings.personGeneration = els.personGenSelect.value || "allow_all";
  saveSettings();
  renderApiKeyBadge();
  closeSettings();
}
async function testApiKey() {
  const btn = document.querySelector('[data-action="settings-test"]');
  if (!btn) return;
  const prev = btn.textContent;
  btn.textContent = "Testing…";
  btn.disabled = true;
  try {
    const tempKey = els.apiKeyInput.value.trim();
    if (!tempKey) throw new Error("Enter a key first.");
    const res = await fetch(`${VEO_API_BASE}/models/${els.modelSelect.value}`, {
      headers: { "x-goog-api-key": tempKey },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `${res.status} ${res.statusText}`);
    }
    btn.textContent = "Key works ✓";
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1500);
  } catch (e) {
    btn.textContent = "Failed";
    alert("Key test failed: " + (e.message || e));
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1500);
  }
}
function clearSettings() {
  if (!confirm("Clear API key and settings?")) return;
  settings.apiKey = "";
  settings.model = DEFAULT_MODEL;
  settings.personGeneration = "allow_all";
  saveSettings();
  renderApiKeyBadge();
  openSettings();
}

function renderApiKeyBadge() {
  const badge = document.getElementById("api-key-badge");
  if (!badge) return;
  if (settings.apiKey) {
    badge.textContent = `Key set · ${settings.model}`;
    badge.classList.add("ok");
    badge.classList.remove("missing");
  } else {
    badge.textContent = "No API key";
    badge.classList.remove("ok");
    badge.classList.add("missing");
  }
}

/* ----- Reference image upload ----- */

async function readFilesAsBase64(fileList) {
  const out = [];
  for (const file of Array.from(fileList).slice(0, 3)) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > 8 * 1024 * 1024) {
      alert(`${file.name} is over 8 MB — please use a smaller image.`);
      continue;
    }
    const dataB64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = reader.result;
        const idx = typeof s === "string" ? s.indexOf(",") : -1;
        resolve(idx > -1 ? s.slice(idx + 1) : "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    out.push({ name: file.name, mimeType: file.type, dataB64 });
  }
  return out;
}

async function handleReferenceUpload(files) {
  const shot = activeShot();
  if (!shot) return;
  const added = await readFilesAsBase64(files);
  if (!added.length) return;
  const existing = shot.referenceImageData || [];
  shot.referenceImageData = [...existing, ...added].slice(0, 3);
  // Auto-fill text descriptions from filenames if user hasn't provided any.
  if (!shot.referenceImages?.trim()) {
    shot.referenceImages = shot.referenceImageData.map((r) => r.name).join("\n");
  }
  if (!shot.promptLocked) shot.prompt = buildPrompt(shot, state.project);
  saveState();
  renderEditor();
  renderRefThumbs();
}

function removeReference(i) {
  const shot = activeShot();
  if (!shot || !shot.referenceImageData) return;
  shot.referenceImageData.splice(i, 1);
  saveState();
  renderRefThumbs();
}

function renderRefThumbs() {
  const wrap = els.refThumbs;
  if (!wrap) return;
  wrap.innerHTML = "";
  const shot = activeShot();
  const refs = shot?.referenceImageData || [];
  refs.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "ref-thumb";
    div.innerHTML = `
      <img alt="${r.name}" src="data:${r.mimeType};base64,${r.dataB64}" />
      <button class="x" title="Remove">×</button>
      <span class="caption">${r.name}</span>
    `;
    div.querySelector(".x").addEventListener("click", () => removeReference(i));
    wrap.appendChild(div);
  });
  // Disable the file input once we hit 3 refs.
  if (els.refUploadInput) els.refUploadInput.disabled = refs.length >= 3;
}

/* ----- Generation pane rendering ----- */

function renderGenerationPane() {
  const pane = els.generationPane;
  if (!pane) return;
  const shot = activeShot();
  if (!shot) { pane.hidden = true; return; }
  pane.hidden = false;

  const g = getGen(shot.id);
  const statusEl = els.generationStatus;
  if (statusEl) {
    statusEl.dataset.status = g.status;
    let text = STATUS_LABELS[g.status] || g.status;
    if (g.status === "generating" && g.startedAt) {
      const sec = Math.round((Date.now() - g.startedAt) / 1000);
      text += ` · ${sec}s`;
    }
    if (g.status === "error" && g.error) text += ` — ${g.error}`;
    statusEl.textContent = text;
  }

  const player = els.videoPlayer;
  if (player) {
    if (g.videoUrl) {
      if (player.src !== g.videoUrl) player.src = g.videoUrl;
      player.hidden = false;
    } else {
      player.removeAttribute("src");
      player.hidden = true;
    }
  }

  const log = document.getElementById("generation-log");
  if (log) log.textContent = g.log.join("\n");

  const dlBtn = document.querySelector('[data-action="download-video"]');
  if (dlBtn) dlBtn.disabled = !g.videoUrl;
  const cancelBtn = document.querySelector('[data-action="cancel-generation"]');
  if (cancelBtn) cancelBtn.hidden = g.status !== "generating" && g.status !== "queued";
  const genBtn = document.querySelector('[data-action="generate-shot"]');
  if (genBtn) {
    genBtn.disabled = g.status === "generating";
    genBtn.textContent = g.status === "ready" ? "Re-render" : "Generate";
  }
}

function downloadVideo() {
  const shot = activeShot();
  if (!shot) return;
  const g = getGen(shot.id);
  if (!g.videoUrl) return;
  const a = document.createElement("a");
  a.href = g.videoUrl;
  a.download = `${slugify(state.project.title)}-${String(state.shots.indexOf(shot) + 1).padStart(2, "0")}-${slugify(shot.title || "shot")}.mp4`;
  a.click();
}

/* Periodically refresh the elapsed-time display while generating. */
setInterval(() => {
  const shot = activeShot();
  if (!shot) return;
  const g = getGen(shot.id);
  if (g.status === "generating") renderGenerationPane();
}, 1000);

/* -------------------------- boot -------------------------- */

function boot() {
  cacheGenerationEls();
  bindProjectInputs();
  bindShotEditorInputs();
  wireActions();
  wireKeyboard();
  wireSettingsAndGeneration();
  renderShotList();
  renderEditor();
  renderDerived();
  renderApiKeyBadge();
  renderRefThumbs();
  renderGenerationPane();
  setSaveStatus("saved");
}

function cacheGenerationEls() {
  els.settingsModal = document.getElementById("settings-modal");
  els.apiKeyInput = document.getElementById("api-key-input");
  els.modelSelect = document.getElementById("model-select");
  els.personGenSelect = document.getElementById("person-gen-select");
  els.generationPane = document.getElementById("generation-pane");
  els.videoPlayer = document.getElementById("video-player");
  els.generationStatus = document.getElementById("generation-status");
  els.refUploadInput = document.getElementById("ref-upload");
  els.refThumbs = document.getElementById("ref-thumbs");
  els.renderAllBtn = document.querySelector('[data-action="render-all"]');
}

function wireSettingsAndGeneration() {
  // Generation-related actions piggyback on the same data-action dispatcher
  // already set up by wireActions(); we just register the handlers here so
  // they live next to their state.
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const a = t.getAttribute("data-action");
    switch (a) {
      case "open-settings": openSettings(); break;
      case "close-settings": closeSettings(); break;
      case "save-settings": applySettingsFromForm(); break;
      case "settings-test": testApiKey(); break;
      case "settings-clear": clearSettings(); break;
      case "generate-shot": {
        const shot = activeShot();
        if (!shot) break;
        if (!settings.apiKey) { openSettings(); break; }
        generateShot(shot.id).catch(() => {});
        break;
      }
      case "cancel-generation": {
        const shot = activeShot();
        if (shot) cancelGeneration(shot.id);
        break;
      }
      case "render-all": renderAll(); break;
      case "download-video": downloadVideo(); break;
      case "trigger-ref-upload": els.refUploadInput?.click(); break;
    }
  });

  // Reference image file picker
  if (els.refUploadInput) {
    els.refUploadInput.addEventListener("change", (e) => {
      if (e.target.files?.length) handleReferenceUpload(e.target.files);
      e.target.value = "";
    });
  }

  // Click backdrop to close settings
  if (els.settingsModal) {
    els.settingsModal.addEventListener("click", (e) => {
      if (e.target === els.settingsModal) closeSettings();
    });
  }
  // Esc to close settings
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.settingsModal && !els.settingsModal.hidden) closeSettings();
  });
}

document.addEventListener("DOMContentLoaded", boot);
