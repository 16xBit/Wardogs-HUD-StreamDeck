import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "capture.ps1");
const MAX_PIXELS = 16_000_000; // upper bound for one upscaled capture

/** Keeps one PowerShell process alive and serves requests one at a time. */
export class Capture {
  #proc = null;
  #buffer = "";
  #waiting = null;
  #queue = Promise.resolve();

  #start() {
    this.#proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      windowsHide: true,
    });
    this.#proc.stdout.setEncoding("utf8");
    this.#proc.stdout.on("data", (chunk) => {
      this.#buffer += chunk;
      let i;
      while ((i = this.#buffer.indexOf("\n")) >= 0) {
        const line = this.#buffer.slice(0, i).trim();
        this.#buffer = this.#buffer.slice(i + 1);
        if (!this.#waiting || !line) continue;
        const { resolve, reject } = this.#waiting;
        this.#waiting = null;
        if (line.startsWith("ERR ")) reject(new Error(line.slice(4)));
        else if (line.startsWith("SIZE ")) resolve(line.slice(5).split(" ").map(Number));
        else if (line.startsWith("FG ")) {
          const rest = line.slice(3);
          const i2 = rest.indexOf("|");
          resolve({ process: i2 < 0 ? rest : rest.slice(0, i2), title: i2 < 0 ? "" : rest.slice(i2 + 1) });
        } else resolve(Buffer.from(line, "base64"));
      }
    });
    this.#proc.on("exit", () => {
      this.#proc = null;
      if (this.#waiting) this.#waiting.reject(new Error("capture process exited"));
      this.#waiting = null;
    });
  }

  #send(text) {
    const result = this.#queue.then(
      () =>
        new Promise((resolve, reject) => {
          if (!this.#proc) this.#start();
          this.#waiting = { resolve, reject };
          this.#proc.stdin.write(`${text}\n`);
        }),
    );
    this.#queue = result.catch(() => {});
    return result;
  }

  /**
   * Returns a PNG Buffer of the region, upscaled by `scale`.
   * threshold>0 (or mode 3) binarizes it: bright text -> black on white.
   * Every argument is checked to be a plain number in range before it is sent to PowerShell.
   */
  grab({ x, y, w, h }, scale = 1, threshold = 0, mode = 0) {
    const v = [x, y, w, h, scale, threshold, mode].map(Number);
    if (!v.every(Number.isFinite)) throw new Error("capture: arguments must be numbers");
    const [X, Y, W, H, S, T, M] = v.map(Math.round);
    if (X < 0 || Y < 0 || W < 1 || H < 1 || S < 1 || S > 8 || T < 0 || T > 255 || M < 0 || M > 3 || W * S * H * S > MAX_PIXELS) {
      throw new Error("capture: argument out of range");
    }
    return this.#send(`${X} ${Y} ${W} ${H} ${S} ${T} ${M}`);
  }

  /** [width, height] of the primary screen in physical pixels. */
  screenSize() {
    return this.#send("size");
  }

  /** { process, title } of the window that currently has focus. */
  foreground() {
    return this.#send("fg");
  }

  stop() {
    this.#proc?.kill();
  }
}
