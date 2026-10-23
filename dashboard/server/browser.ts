import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { RunStore } from "./store.ts";
import { z } from "zod";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BSK_BRIDGE = path.join(HERE, "bsk");

const sessionSchema = z.object({
  session_id: z.string().optional(),
  data: z.object({ session_id: z.string() }).optional(),
});
const tabsSchema = z.array(
  z.object({
    active: z.boolean().optional(),
    is_active: z.boolean().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
  }),
);
const tabsResponseSchema = z.union([
  tabsSchema,
  z.object({ tabs: tabsSchema }),
]);

export function execute(
  file: string,
  args: string[],
  timeout = 10000,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      file,
      args,
      {
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        encoding: "utf8",
        env: env ? { ...process.env, ...env } : process.env,
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(String(stderr || stdout || error.message).slice(0, 1200)),
          );
        else resolve(stdout);
      },
    ),
  );
}
export class BrowserObserver {
  sessionId?: string;
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private failures = 0;
  constructor(
    private store: RunStore,
    private runId: string,
    private realBinary = process.env.BSK_BIN || "bsk",
    private binary = BSK_BRIDGE,
  ) {}
  private call(args: string[], timeout = 10000, opportunistic = false) {
    return execute(this.binary, args, timeout, {
      SEAL_LIVE_BSK_REAL: this.realBinary,
      SEAL_LIVE_BSK_LOCK: path.join(this.store.dir(this.runId), "bsk.lock"),
      SEAL_LIVE_BSK_NOWAIT: opportunistic ? "1" : "0",
    });
  }
  async start(browserId: string, url: string) {
    const options = [
      "session",
      "start",
      "--name",
      "EQST CTF Agent",
      "--width",
      "1280",
      "--height",
      "820",
      "--json",
    ];
    if (browserId) options.push("--browser", browserId);
    const result = sessionSchema.parse(
      JSON.parse(await this.call(options, 30000)),
    );
    const id = result.session_id ?? result.data?.session_id;
    if (typeof id !== "string")
      throw new Error("BSK session ID가 응답에 없습니다.");
    this.sessionId = id;
    this.store.add(this.runId, "browser", "Agent Window 연결", "", {
      state: "connecting",
      sessionId: id,
    });
    await this.call(
      [
        "navigate",
        url,
        "--session",
        id,
        "--wait-until",
        "domcontentloaded",
        "--timeout",
        "20s",
        "--json",
      ],
      25000,
    );
    await this.capture();
    this.schedule();
    return id;
  }
  private schedule() {
    if (this.stopping) return;
    this.timer = setTimeout(
      async () => {
        if (this.stopping) return;
        this.inFlight = this.capture(true);
        await this.inFlight;
        this.inFlight = undefined;
        this.schedule();
      },
      this.failures ? 12000 : 4500,
    );
  }
  private async capture(opportunistic = false) {
    if (!this.sessionId || this.stopping) return;
    const dir = this.store.dir(this.runId),
      raw = path.join(dir, "frame.tmp.png");
    try {
      const tabsPayload = tabsResponseSchema.parse(
        JSON.parse(
          await this.call(
            [
              "tab",
              "list",
              "--scope",
              "agent",
              "--session",
              this.sessionId,
              "--json",
            ],
            10000,
            opportunistic,
          ),
        ),
      );
      const tabs = Array.isArray(tabsPayload) ? tabsPayload : tabsPayload.tabs;
      const current = tabs.find((t) => t.active || t.is_active) || tabs[0];
      // Only this task's Agent Window is captured. Never enumerate/borrow user tabs.
      await this.call(
        ["screenshot", "--session", this.sessionId, "--out", raw, "--json"],
        12000,
        opportunistic,
      );
      if (this.stopping) return;
      const dest = path.join(dir, "frame.webp");
      await sharp(raw)
        .resize({ width: 1280, withoutEnlargement: true })
        .webp({ quality: 72 })
        .toFile(dest + ".tmp");
      await fs.rename(dest + ".tmp", dest);
      await fs.unlink(raw).catch(() => {});
      this.failures = 0;
      this.store.add(this.runId, "browser", "브라우저 화면", "", {
        state: "live",
        capturedAt: Date.now(),
        url: current?.url,
        title: current?.title,
      });
    } catch (error) {
      if (String(error).includes("SEAL_LIVE_BSK_BUSY")) return;
      this.failures++;
      if (this.failures === 1)
        this.store.add(this.runId, "browser", "브라우저 화면 일시 중단", "", {
          state: "unavailable",
          error: String(error).slice(0, 400),
        });
      // No backend switch, session borrowing or shared daemon restart on failure.
    }
  }
  async stop(finalFrame = false) {
    clearTimeout(this.timer);
    await this.inFlight?.catch(() => {});
    if (finalFrame) await this.capture();
    this.stopping = true;
    clearTimeout(this.timer);
    if (this.sessionId) {
      const id = this.sessionId;
      this.sessionId = undefined;
      try {
        await this.call(["session", "stop", id, "--json"], 12000);
      } catch (e) {
        this.store.add(
          this.runId,
          "notice",
          "브라우저 종료 확인 필요",
          String(e),
        );
      }
      this.store.add(this.runId, "browser", "마지막 화면", "", {
        state: "ended",
      });
    }
  }
}
