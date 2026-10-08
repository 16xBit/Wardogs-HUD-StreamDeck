import { createWorker, PSM } from "tesseract.js";
import { writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Capture } from "./capture.js";
import { fitRegion } from "./geometry.js";
import { hasRules, matchesGame } from "./focus.js";

const cachePath = fileURLToPath(new URL("../tessdata", import.meta.url));
const debugPath = fileURLToPath(new URL("../debug", import.meta.url));
// How "text" is told apart from background: luminance (fixed threshold), max channel, saturation, or otsu (automatic luminance threshold).
const MODES = { lum: 0, max: 1, sat: 2, otsu: 3 };

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

export class HudReader {
  #capture = new Capture();
  #digits = null;
  #letters = null;
  #digitsPsm = PSM.SINGLE_LINE;
  #screen = null;
  #lastFgProcess = null;
  #warnedNoRules = false;
  #log;

  constructor(log = () => {}) {
    this.#log = log;
  }

  async init(cfg = {}) {
    // The OCR model ships with the plugin (tessdata/eng.traineddata). Downloading it is off unless allowed in config.json.
    const model = `${cachePath}/eng.traineddata`;
    if (!existsSync(model) && cfg.allowModelDownload !== true) {
      throw new Error(`OCR model not found at ${model}. Put eng.traineddata there, or set "allowModelDownload": true in config.json.`);
    }
    mkdirSync(cachePath, { recursive: true });
    this.#digits = await createWorker("eng", 1, { cachePath });
    await this.#digits.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
    });
    this.#digitsPsm = PSM.SINGLE_LINE;
    this.#letters = await createWorker("eng", 1, { cachePath });
    await this.#letters.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
    });
    this.#screen = await this.#capture.screenSize();
    this.#log(`OCR ready, primary screen ${this.#screen[0]}x${this.#screen[1]}`);
  }

  /**
   * True when the game is the active window (or when the check is off / not configured).
   * Nothing on screen is captured while another window has focus.
   */
  async gameFocused(cfg) {
    const game = cfg.game ?? {};
    const wanted = cfg.requireGameFocus !== false;
    const rules = wanted && hasRules(game);
    if (wanted && !rules && !this.#warnedNoRules) {
      this.#warnedNoRules = true;
      this.#log('Game-focus check is OFF: set game.processNames in config.json (enable debugSaveCrops to see the active process name in the log).');
    }
    if (!rules && !cfg.debugSaveCrops) return true;
    const fg = await this.#capture.foreground();
    if (cfg.debugSaveCrops && fg.process !== this.#lastFgProcess) {
      this.#lastFgProcess = fg.process; // process name only - window titles can contain private information
      this.#log(`active process: ${fg.process}`);
    }
    return rules ? matchesGame(fg, game) : true;
  }

  // A region may override scale / threshold / mode; otherwise the global values apply.
  async #crop(region, cfg, name) {
    const box = fitRegion(region, cfg.reference ?? { width: this.#screen[0], height: this.#screen[1] }, this.#screen, name);
    const png = await this.#capture.grab(
      box,
      clampInt(region.scale ?? cfg.scale ?? 3, 1, 8, 3),
      clampInt(region.threshold ?? cfg.threshold ?? 0, 0, 255, 0),
      MODES[region.mode ?? cfg.mode ?? "lum"] ?? 0,
    );
    if (cfg.debugSaveCrops) {
      mkdirSync(debugPath, { recursive: true });
      await writeFile(`${debugPath}/${name}.png`, png);
    }
    return png;
  }

  /** True when the gate text (e.g. "ALT") is visible, i.e. the player is piloting. */
  async isPiloting(cfg) {
    const png = await this.#crop(cfg.gate.region, cfg, "gate");
    const { data } = await this.#letters.recognize(png);
    const text = data.text.trim();
    if (cfg.debugSaveCrops) this.#log(`gate OCR: "${text}"`);
    return text.toUpperCase().includes(String(cfg.gate.text).toUpperCase());
  }

  /** Returns an integer, or null if the read is empty, too long, too large, or low-confidence. */
  async readNumber(region, cfg, name) {
    const png = await this.#crop(region, cfg, name);
    const psm = String(region.psm ?? PSM.SINGLE_LINE);
    if (psm !== this.#digitsPsm) {
      await this.#digits.setParameters({ tessedit_pageseg_mode: psm });
      this.#digitsPsm = psm;
    }
    const { data } = await this.#digits.recognize(png);
    const digits = data.text.replace(/\D/g, "");
    const conf = data.confidence ?? 0;
    if (cfg.debugSaveCrops) this.#log(`${name} OCR: "${data.text.trim()}" conf=${Math.round(conf)}`);
    if (!digits) return null;
    if (digits.length > (region.maxDigits ?? 5)) return null;
    if (region.maxValue !== undefined && parseInt(digits, 10) > region.maxValue) return null;
    if (conf < (region.minConfidence ?? cfg.minConfidence ?? 0)) return null;
    return parseInt(digits, 10);
  }

  async shutdown() {
    await this.#digits?.terminate();
    await this.#letters?.terminate();
    this.#capture.stop();
  }
}
