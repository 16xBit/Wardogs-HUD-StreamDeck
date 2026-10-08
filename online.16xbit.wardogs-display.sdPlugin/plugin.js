import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { readFileSync } from "node:fs";
import { HudReader } from "./lib/hud.js";
import { Stabilizer } from "./lib/stabilizer.js";
import { keyImage } from "./lib/render.js";

const configUrl = new URL("./config.json", import.meta.url);
let lastGoodConfig = null;
let configWarned = false;

// Re-reads config.json every call. A typo while editing keeps the last working settings instead of crashing.
function loadConfig() {
  try {
    const cfg = JSON.parse(readFileSync(configUrl, "utf8"));
    if (typeof cfg.regions !== "object" || cfg.regions === null || !cfg.gate?.region) {
      throw new Error('config.json needs "gate.region" and "regions"');
    }
    lastGoodConfig = cfg;
    configWarned = false;
  } catch (err) {
    if (!configWarned) streamDeck.logger.error(`config.json problem, keeping the last good settings: ${err.message}`);
    configWarned = true;
    if (!lastGoodConfig) throw err;
  }
  return lastGoodConfig;
}
const pollMs = (cfg) => Math.min(5000, Math.max(100, Number(cfg.pollMs) || 300));

// Order here is the order the score key cycles through when pressed.
const TEAMS = [
  { id: "blue", label: "BLUE", color: "#3da5ff" },
  { id: "red", label: "RED", color: "#ff4d4d" },
  { id: "green", label: "GREEN", color: "#3ddc64" },
];

const reader = new HudReader((m) => streamDeck.logger.info(m));
const visible = new Map(); // action id -> entry
const stabilizers = new Map(); // kind -> Stabilizer
const current = new Map(); // kind -> last accepted value (number | null)
const lastRead = new Map(); // kind -> timestamp of last OCR read
let running = false;

function look(entry) {
  if (entry.score) {
    const t = TEAMS[entry.team];
    return { label: t.label, value: current.get(`score_${t.id}`), color: t.color, labelColor: t.color };
  }
  return { label: entry.label, value: current.get(entry.kind), color: "#ffffff" };
}

// Only talks to Stream Deck when what is shown actually changed.
function render(entry) {
  let payload;
  if (entry.neo) {
    const pct = (id) => Math.max(0, Math.min(100, Number(current.get(`score_${id}`)) || 0));
    payload = { blue: pct("blue"), red: pct("red"), green: pct("green") };
  } else {
    payload = look(entry);
  }
  const sig = JSON.stringify(payload);
  if (entry.sig === sig) return;
  entry.sig = sig;
  return entry.neo ? entry.action.setFeedback(payload) : entry.action.setImage(keyImage(payload));
}

async function tick() {
  const cfg = loadConfig();

  const needed = new Set();
  for (const e of visible.values()) {
    if (e.score || e.neo) TEAMS.forEach((t) => needed.add(`score_${t.id}`)); // read all teams
    else needed.add(e.kind);
  }

  // Only look at the screen while the game is the active window.
  if (!(await reader.gameFocused(cfg))) {
    for (const kind of needed) {
      const region = cfg.regions[kind];
      if (region && (region.gated !== false || !region.holdLast)) {
        stabilizers.delete(kind);
        current.set(kind, null);
      }
    }
    for (const e of visible.values()) await render(e);
    return;
  }

  // The "am I piloting?" check is needed for gated regions and for regions that move while piloting.
  const needGate = [...needed].some((k) => {
    const r = cfg.regions[k];
    return r && (r.gated !== false || r.piloting);
  });
  const piloting = needGate ? await reader.isPiloting(cfg) : false;

  const now = Date.now();
  for (const kind of needed) {
    const region = cfg.regions[kind];
    if (!region) continue;
    if (region.gated !== false && !piloting) {
      stabilizers.delete(kind);
      current.set(kind, null);
      continue;
    }
    if (now - (lastRead.get(kind) ?? 0) < (region.everyMs ?? 0)) continue;
    lastRead.set(kind, now);
    if (!stabilizers.has(kind)) {
      stabilizers.set(
        kind,
        new Stabilizer({
          maxJump: region.maxJump,
          confirmReads: region.confirmReads ?? cfg.confirmReads,
          maxMisses: cfg.maxMisses,
          hold: region.holdLast === true,
        }),
      );
    }
    // While piloting, a region may use different coordinates (the HUD shifts slightly).
    const effective = piloting && region.piloting ? { ...region, ...region.piloting } : region;
    const raw = await reader.readNumber(effective, cfg, kind);
    current.set(kind, stabilizers.get(kind).update(raw));
  }
  for (const e of visible.values()) await render(e);
}

async function loop() {
  if (running) return;
  running = true;
  try {
    await reader.init(loadConfig());
  } catch (err) {
    streamDeck.logger.error(`init failed (OCR model download needs internet on first run): ${err?.message ?? err}`);
    running = false;
    return;
  }
  while (visible.size) {
    const started = Date.now();
    try {
      await tick();
    } catch (err) {
      streamDeck.logger.error(`tick failed: ${err?.message ?? err}`);
    }
    const wait = Math.max(50, pollMs(loadConfig()) - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  await reader.shutdown();
  running = false;
}

/** SPD / AGL / AMMO / HP: one number read from one HUD region. */
class ValueAction extends SingletonAction {
  constructor(manifestId, kind, label) {
    super();
    this.manifestId = manifestId;
    this.kind = kind;
    this.label = label;
  }
  onWillAppear(ev) {
    const entry = { action: ev.action, kind: this.kind, label: this.label };
    visible.set(ev.action.id, entry);
    render(entry);
    loop();
  }
  onWillDisappear(ev) {
    visible.delete(ev.action.id);
  }
}

/** Team score: shows one team in its color; pressing the key cycles Blue -> Red -> Green. */
class ScoreAction extends SingletonAction {
  constructor() {
    super();
    this.manifestId = "online.16xbit.wardogs-display.score";
  }
  onWillAppear(ev) {
    const saved = Number(ev.payload?.settings?.team);
    const entry = {
      action: ev.action,
      score: true,
      team: Number.isInteger(saved) && saved >= 0 && saved < TEAMS.length ? saved : 0,
    };
    visible.set(ev.action.id, entry);
    render(entry);
    loop();
  }
  onWillDisappear(ev) {
    visible.delete(ev.action.id);
  }
  onKeyDown(ev) {
    const entry = visible.get(ev.action.id);
    if (!entry) return;
    entry.team = (entry.team + 1) % TEAMS.length;
    ev.action.setSettings({ team: entry.team }); // remembered across restarts
    render(entry);
  }
}

/** Stream Deck Neo Infobar: three horizontal bars (blue / red / green team score, 0-100). */
class ProgressAction extends SingletonAction {
  constructor() {
    super();
    this.manifestId = "online.16xbit.wardogs-display.progress";
  }
  async onWillAppear(ev) {
    if (!ev.action.isNeoInfobar()) return;
    await ev.action.setFeedbackLayout("layouts/progress.json");
    const entry = { action: ev.action, neo: true };
    visible.set(ev.action.id, entry);
    await render(entry);
    loop();
  }
  onWillDisappear(ev) {
    visible.delete(ev.action.id);
  }
}

streamDeck.actions.registerAction(new ValueAction("online.16xbit.wardogs-display.speed", "speed", "SPD"));
streamDeck.actions.registerAction(new ValueAction("online.16xbit.wardogs-display.altitude", "altitude", "AGL"));
streamDeck.actions.registerAction(new ValueAction("online.16xbit.wardogs-display.ammo", "ammo", "AMMO"));
streamDeck.actions.registerAction(new ValueAction("online.16xbit.wardogs-display.health", "health", "HP"));
streamDeck.actions.registerAction(new ScoreAction());
streamDeck.actions.registerAction(new ProgressAction());
streamDeck.connect();
