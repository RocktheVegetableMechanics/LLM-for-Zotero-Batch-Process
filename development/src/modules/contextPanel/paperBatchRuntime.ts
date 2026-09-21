export type PaperBatchStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "interrupted";
export interface PaperBatchJob {
  id: number;
  libraryID: number;
  itemKey?: string;
  title: string;
  state: PaperBatchStatus;
  detail?: string;
  conversationKey?: number;
  model?: string;
  effort?: string;
}
export interface PaperBatchSnapshot {
  version?: number;
  prompt: string;
  model: string;
  effort: string;
  jobs: PaperBatchJob[];
}
export interface PaperBatchOutcome {
  status: "completed" | "failed" | "blocked" | "cancelled";
  detail?: string;
}
export function createRetryablePersistence<T extends unknown[]>(
  save: (...args: T) => Promise<unknown>,
) {
  let saved = false,
    pending: Promise<void> | undefined;
  return (...args: T) => {
    if (saved) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve()
      .then(() => save(...args))
      .then(() => {
        saved = true;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
export function encodePaperBatch(state: PaperBatchSnapshot) {
  return JSON.stringify({
    version: 1,
    prompt: String(state.prompt || ""),
    model: String(state.model || ""),
    effort: String(state.effort || ""),
    jobs: state.jobs.map((job) => ({
      id: job.id,
      libraryID: job.libraryID,
      itemKey: job.itemKey || "",
      title: String(job.title || ""),
      state: job.state,
      detail: job.state === "running" ? "" : String(job.detail || ""),
      conversationKey: job.conversationKey,
      model: job.model,
      effort: job.effort,
    })),
  });
}
export function decodePaperBatch(
  text: string | null,
): PaperBatchSnapshot | null {
  if (text === null) return null;
  const state = JSON.parse(text);
  if (
    state.version !== 1 ||
    !Array.isArray(state.jobs) ||
    typeof state.prompt !== "string" ||
    typeof state.model !== "string" ||
    typeof state.effort !== "string"
  )
    throw new Error("队列文件格式不受支持；原文件已保留");
  for (const job of state.jobs) {
    if (
      !Number.isSafeInteger(job.id) ||
      job.id <= 0 ||
      !Number.isSafeInteger(job.libraryID) ||
      job.libraryID <= 0 ||
      ![
        "queued",
        "running",
        "completed",
        "failed",
        "blocked",
        "cancelled",
        "interrupted",
      ].includes(job.state)
    )
      throw new Error("队列条目损坏；原文件已保留");
    if (job.state === "running") {
      job.state = "interrupted";
      job.detail = "上次运行中断，请先打开会话检查；确认需要重做时再重新排队。";
    }
  }
  return state;
}
export function createPaperBatchStore(
  read: () => Promise<string | null>,
  write: (text: string) => Promise<void>,
) {
  let pending = Promise.resolve(),
    lastSaved: string | null | undefined;
  return {
    async load() {
      const raw = await read();
      const value = decodePaperBatch(raw);
      lastSaved = raw;
      return value;
    },
    save(state: PaperBatchSnapshot) {
      const text = encodePaperBatch(state);
      pending = pending
        .catch(() => {})
        .then(async () => {
          if (text !== lastSaved) {
            await write(text);
            lastSaved = text;
          }
        });
      return pending;
    },
    flush() {
      return pending;
    },
  };
}
export function createZoteroPaperBatchStore() {
  const win = Zotero.getMainWindow();
  const io = (globalThis as any).IOUtils || (win as any)?.IOUtils;
  const root = (Zotero as any).Profile?.dir as string | undefined;
  if (!io || !root) throw new Error("无法访问 Zotero 队列存储目录");
  const separator = root.includes("\\") ? "\\" : "/";
  const directory = root.replace(/[\\/]$/, "") + separator + "llmforzotero";
  const path = directory + separator + "paper-batch-v1.json";
  return createPaperBatchStore(
    async () => ((await io.exists(path)) ? io.readUTF8(path) : null),
    async (text) => {
      await io.makeDirectory(directory, {
        createAncestors: true,
        ignoreExisting: true,
      });
      await io.writeUTF8(path, text, { tmpPath: path + ".tmp" });
    },
  );
}
export function createSequentialPaperBatch(
  jobs: PaperBatchJob[],
  execute: (job: PaperBatchJob) => Promise<PaperBatchOutcome>,
  changed = () => {},
  checkpoint = async () => {},
) {
  let running = false,
    paused = false,
    stopped = false;
  return {
    jobs,
    pause() {
      paused = true;
      changed();
    },
    stop() {
      stopped = true;
      paused = true;
      for (const job of jobs)
        if (job.state === "queued") job.state = "cancelled";
      changed();
    },
    async run() {
      if (running || stopped) return;
      running = true;
      paused = false;
      try {
        for (const job of jobs) {
          if (paused || stopped) break;
          if (job.state !== "queued") continue;
          job.state = "running";
          changed();
          try {
            await checkpoint();
          } catch (error) {
            job.state = "queued";
            paused = true;
            throw error;
          }
          if (stopped || paused) {
            job.state = stopped ? "cancelled" : "queued";
            await checkpoint();
            break;
          }
          try {
            const outcome = await execute(job);
            job.state = outcome?.status || "blocked";
            job.detail = outcome?.detail || "";
          } catch (error) {
            job.state =
              (error as Error)?.name === "AbortError" ? "cancelled" : "failed";
            job.detail = String((error as Error)?.message || error);
          }
          changed();
          try {
            await checkpoint();
          } catch (error) {
            paused = true;
            throw error;
          }
        }
      } finally {
        running = false;
        changed();
      }
    },
    get running() {
      return running;
    },
    get paused() {
      return paused;
    },
    get stopped() {
      return stopped;
    },
  };
}
