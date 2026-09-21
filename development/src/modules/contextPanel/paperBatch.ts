import {
  createSequentialPaperBatch,
  createZoteroPaperBatchStore,
  type PaperBatchJob,
  type PaperBatchOutcome,
} from "./paperBatchRuntime";
import {
  getCodexConversationSummary,
  createCodexPaperConversation,
  touchCodexConversationTitle,
} from "../../codexAppServer/store";
import { createCodexPaperPortalItem } from "../../codexAppServer/portal";
import {
  activeCodexPaperConversationByPaper,
  buildCodexPaperStateKey,
} from "../../codexAppServer/state";
import {
  getCodexRuntimeModelPref,
  getCodexReasoningModePref,
  setCodexRuntimeModelPref,
  setCodexReasoningModePref,
  setLastUsedCodexPaperConversationKey,
} from "../../codexAppServer/prefs";
import {
  buildCodexRuntimeModelEntries,
  loadCodexAppServerModelCatalog,
  getCodexAppServerReasoningChoices,
  resolveCodexAppServerReasoningSelection,
} from "../../codexAppServer/modelCatalog";
import { getConfiguredCodexAppServerBinaryPath } from "../../codexAppServer/binaryPath";
import { buildCodexAppServerReasoningConfig } from "../../codexAppServer/reasoning";
import { resolvePaperContextRefFromItem } from "../../services/paperContent/paperAttribution";
import {
  loadStoredConversationByKey,
  ensureConversationLoaded,
  sendQuestion,
} from "./chat";
import { config, PERSISTED_HISTORY_LIMIT } from "./constants";
import { resolveConversationBaseItem } from "./portalScope";
import { getConversationKey } from "./conversationIdentity";
import { loadConfiguredShortcutChoices } from "./shortcuts";
import { getAbortController } from "./state";
import {
  bindStandalonePanelHost,
  clearPanelHostBinding,
} from "./panelHostOwnership";
type BatchProfile = ReturnType<typeof buildCodexRuntimeModelEntries>[number] & {
  reasoning?: ReturnType<typeof buildCodexAppServerReasoningConfig>;
  reasoningMode?: string;
};
type BatchPanel = HTMLElement & {
  addPapers: (items: Zotero.Item[]) => void;
  reveal: () => void;
  shutdown: () => Promise<void>;
};
let paperBatchDialog: BatchPanel | null;

async function openBatchPaperConversation(job: PaperBatchJob) {
  // Load navigation after panel setup, avoiding an initialization cycle with
  // standaloneWindow, which itself mounts setupHandlers.
  const {
    getStandaloneSessionWindow,
    openBatchPaperConversationInStandalone,
    openStandaloneChat,
  } = await import("./standaloneWindow");
  if (!job.conversationKey) throw new Error("会话尚未建立");
  const summary = await getCodexConversationSummary(job.conversationKey);
  if (
    !summary ||
    summary.paperItemID !== job.id ||
    summary.libraryID !== job.libraryID
  )
    throw new Error("论文会话不存在或身份不匹配");
  const paper = Zotero.Items.get(job.id);
  if (!paper || paper.deleted) throw new Error("论文已删除");
  if (getStandaloneSessionWindow()) {
    if (!openBatchPaperConversationInStandalone)
      throw new Error("论文对话窗口正在初始化，请稍后重试");
    await openBatchPaperConversationInStandalone(summary, paper);
    getStandaloneSessionWindow()?.focus();
  } else {
    openStandaloneChat({
      initialItem: createCodexPaperPortalItem(paper, job.conversationKey),
      initialConversationSystem: "codex",
    });
  }
}
function normalizeBatchPapers(items: (Zotero.Item | null | undefined)[]) {
  return [
    ...new Map(
      items
        .map((item) =>
          item?.parentID ? Zotero.Items.get(item.parentID) : item,
        )
        .filter((item): item is Zotero.Item =>
          Boolean(item?.isRegularItem?.() && !item.deleted),
        )
        .map((item) => [item.id, item]),
    ).values(),
  ];
}
function getBatchLibrarySelection() {
  const pane =
    Zotero.getActiveZoteroPane?.() || Zotero.getMainWindow()?.ZoteroPane;
  return normalizeBatchPapers(pane?.getSelectedItems?.() || []);
}
export function openSequentialPaperBatch(
  profile: Partial<BatchProfile>,
  sourceItem?: Zotero.Item | null,
  hostDocument?: Document,
) {
  const papers = sourceItem
    ? normalizeBatchPapers([resolveConversationBaseItem(sourceItem)])
    : getBatchLibrarySelection();
  if (paperBatchDialog?.isConnected) {
    paperBatchDialog.addPapers(papers);
    paperBatchDialog.reveal();
    return;
  }
  const doc = Zotero.getMainWindow()?.document || hostDocument;
  const win = doc.defaultView || Zotero.getMainWindow();
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const el = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];
    if (text) el.textContent = text;
    return el;
  };

  const panel = make("section") as BatchPanel;
  paperBatchDialog = panel;
  panel.style.cssText =
    "position:fixed;left:12px;top:12px;width:720px;height:620px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);min-width:min(360px,calc(100vw - 24px));min-height:220px;box-sizing:border-box;resize:both;z-index:2147483647;background:Canvas;color:CanvasText;border:1px solid #8b96a5;border-radius:12px;padding:18px;overflow:auto;font:14px/1.5 sans-serif;box-shadow:0 8px 40px #5558";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "批量论文队列");
  const title = make("h2", "批量论文队列 · 拖动此处移动");
  title.style.cssText =
    "margin:0 0 8px;cursor:move;touch-action:none;font-size:18px;user-select:none";
  const help = make(
    "p",
    "1. 添加论文 → 2. 选择模型、推理力度和提示词 → 3. 开始处理。单篇失败会保留错误并继续下一篇，不自动重试。可随时追加论文；右下角拖动缩放。暂停后更改模型将用于下一篇。",
  );
  const addSelected = make("button", "添加文库选中项");
  const dropZone = make(
    "div",
    "把 Zotero 文献条目拖到这里，或在文献列表中多选后点击“添加文库选中项”。本地 PDF 请先导入 Zotero。",
  );
  dropZone.style.cssText =
    "border:1px dashed #7a8ba0;border-radius:8px;padding:12px;margin:8px 0;background:#7187a010";
  const notice = make("p");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const presets = make("select");
  presets.append(make("option", "选择已保存的提示词，或在下方输入正文"));
  let shortcuts: Awaited<ReturnType<typeof loadConfiguredShortcutChoices>> = [],
    refreshGeneration = 0,
    refreshScheduled = false;
  const prompt = make("textarea");
  prompt.rows = 7;
  prompt.style.cssText = "display:block;width:98%;margin:10px 0";
  presets.setAttribute("aria-label", "提示词模板");
  const settings = make("div");
  const modelSelect = make("select"),
    reasoningSelect = make("select"),
    reloadModels = make("button", "刷新模型");
  modelSelect.setAttribute("aria-label", "批量模型");
  reasoningSelect.setAttribute("aria-label", "批量推理力度");
  settings.append(
    make("span", "模型 "),
    modelSelect,
    make("span", " 推理力度 "),
    reasoningSelect,
    reloadModels,
  );
  let catalogModels: Awaited<
      ReturnType<typeof loadCodexAppServerModelCatalog>
    >["models"] = [],
    catalogReady = false,
    catalogLoading = false;
  let selectedModel =
    profile?.authMode === "codex_app_server"
      ? profile.model || getCodexRuntimeModelPref()
      : getCodexRuntimeModelPref();
  let selectedEffort =
    profile?.reasoning?.effort || getCodexReasoningModePref();
  const rebuildModels = () => {
    modelSelect.replaceChildren();
    for (const entry of buildCodexRuntimeModelEntries({
      models: catalogModels,
      selectedModel,
      codexPath: getConfiguredCodexAppServerBinaryPath(),
    })) {
      const option = make("option", entry.displayModelLabel || entry.model);
      option.value = entry.model;
      modelSelect.append(option);
    }
    modelSelect.value = selectedModel;
    const selection = resolveCodexAppServerReasoningSelection({
      mode: selectedEffort,
      choices: getCodexAppServerReasoningChoices({
        models: catalogModels,
        selectedModel,
      }),
      catalogReady,
    });
    selectedEffort = selection.mode;
    reasoningSelect.replaceChildren();
    for (const choice of selection.choices) {
      const option = make("option", choice.label);
      option.value = choice.value;
      reasoningSelect.append(option);
    }
    reasoningSelect.value = selectedEffort;
  };
  const refreshModels = async () => {
    if (catalogLoading || batch?.running) return;
    catalogLoading = true;
    reloadModels.disabled = true;
    reloadModels.textContent = "读取模型中…";
    try {
      const catalog = await loadCodexAppServerModelCatalog({
        codexPath: getConfiguredCodexAppServerBinaryPath(),
      });
      if (!panel.isConnected) return;
      catalogModels = catalog.models;
      catalogReady = true;
      rebuildModels();
    } catch (error) {
      notice.textContent =
        "模型目录读取失败，可使用已选模型或点击刷新重试：" +
        String((error as Error)?.message || error);
    } finally {
      catalogLoading = false;
      reloadModels.textContent = "刷新模型";
      render();
    }
  };
  modelSelect.addEventListener("change", () => {
    selectedModel = modelSelect.value;
    rebuildModels();
    setCodexRuntimeModelPref(selectedModel);
    setCodexReasoningModePref(selectedEffort);
    persistChanged();
  });
  reasoningSelect.addEventListener("change", () => {
    selectedEffort = reasoningSelect.value;
    setCodexReasoningModePref(selectedEffort);
    persistChanged();
  });
  reloadModels.addEventListener("click", () => {
    void refreshModels();
  });
  let initialChoices = true;
  const refreshPrompts = async () => {
    const generation = ++refreshGeneration;
    try {
      const choices = await loadConfiguredShortcutChoices();
      if (!panel.isConnected || generation !== refreshGeneration) return;
      const selectedId = presets.value;
      const previous = shortcuts.find((s) => s.id === selectedId);
      const untouched = Boolean(previous && prompt.value === previous.prompt);
      shortcuts = choices;
      const placeholder = make("option", "选择提示词模板，或在下方输入正文");
      placeholder.value = "";
      presets.replaceChildren(placeholder);
      for (const shortcut of choices) {
        const option = make("option", shortcut.label);
        option.value = shortcut.id;
        presets.append(option);
      }
      const selected = choices.find((s) => s.id === selectedId);
      presets.value = selected ? selected.id : "";
      if (!submittedPrompt && selected && untouched)
        prompt.value = selected.prompt;
      if (initialChoices && !prompt.value && !submittedPrompt) {
        const preferred = choices.find(
          (s) => s.label.trim() === "My_Summary_Prompt",
        );
        if (preferred) {
          presets.value = preferred.id;
          prompt.value = preferred.prompt;
        }
      }
      initialChoices = false;
    } catch (error) {
      if (panel.isConnected)
        notice.textContent = "提示词列表加载失败，请重新打开队列。";
    }
  };
  const schedulePromptRefresh = () => {
    if (refreshScheduled) return;
    refreshScheduled = true;
    void Promise.resolve().then(() => {
      refreshScheduled = false;
      return refreshPrompts();
    });
  };
  const promptObservers: symbol[] = [];
  const cleanupPrompts = () => {
    ++refreshGeneration;
    for (const id of promptObservers.splice(0))
      Zotero.Prefs.unregisterObserver(id);
    win.removeEventListener?.("unload", cleanupPrompts);
    win.removeEventListener?.("unload", onBatchUnload);
  };
  presets.addEventListener("change", () => {
    const chosen = shortcuts.find((s) => s.id === presets.value);
    if (chosen && !submittedPrompt) {
      prompt.value = chosen.prompt;
      persistChanged();
    }
  });
  prompt.addEventListener("change", () => persistChanged());
  const start = make("button", "开始 / 继续"),
    pause = make("button", "本篇完成后暂停"),
    stop = make("button", "停止当前及后续"),
    close = make("button", "关闭"),
    collapse = make("button", "收起");
  const resetQueue = make("button", "新建队列");
  const status = make("p"),
    list = make("ol"),
    worker = make("div");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  worker.hidden = true;
  const jobs: PaperBatchJob[] = [];
  let batch: ReturnType<typeof createSequentialPaperBatch> | undefined,
    currentKey: number | null,
    submittedPrompt: string | undefined,
    submittedProfile: BatchProfile,
    currentCancelled = false;
  let loadingQueue = true,
    starting = false,
    storageError = "",
    loadError = "",
    store: ReturnType<typeof createZoteroPaperBatchStore> | undefined;
  const snapshot = () => ({
    jobs,
    prompt: submittedPrompt || prompt.value,
    model: selectedModel,
    effort: selectedEffort,
  });
  const checkpoint = async () => {
    if (loadingQueue || loadError || !store)
      throw new Error(loadError || "队列存储尚未就绪");
    try {
      await store.save(snapshot());
      storageError = "";
    } catch (error) {
      storageError = String((error as Error)?.message || error);
      throw error;
    }
  };
  const persistChanged = () => {
    if (!loadingQueue && !loadError && store)
      void checkpoint().catch(() => {
        notice.textContent = "队列保存失败，已暂停：" + storageError;
        if (batch && !batch.paused) batch.pause();
      });
  };
  const labels = {
    queued: "等待",
    running: "处理中",
    completed: "完成",
    failed: "失败",
    blocked: "未完成",
    cancelled: "已停止",
    interrupted: "中断待确认",
  };
  const render = () => {
    list.replaceChildren();
    for (const job of jobs) {
      const row = make("li");
      row.style.cssText = "margin:8px 0;overflow-wrap:anywhere";
      row.append(
        make(
          "span",
          (labels[job.state] || job.state) +
            " — " +
            job.title +
            (job.detail ? "：" + job.detail : "") +
            (job.model ? " [" + job.model + " / " + job.effort + "]" : ""),
        ),
      );
      if (job.state === "queued") {
        const remove = make("button", "移出队列");
        remove.addEventListener("click", () => {
          if (job.state !== "queued") return;
          const index = jobs.indexOf(job);
          if (index >= 0) jobs.splice(index, 1);
          render();
        });
        row.append(remove);
      }
      if (
        ["failed", "blocked", "cancelled", "interrupted"].includes(job.state)
      ) {
        const retry = make("button", "重新排队");
        retry.disabled = Boolean(batch?.running);
        retry.addEventListener("click", () => {
          if (batch?.running) return;
          job.state = "queued";
          job.detail = "";
          render();
        });
        row.append(retry);
      }
      if (job.conversationKey) {
        const open = make("button", "打开论文会话");
        open.addEventListener("click", async () => {
          try {
            await openBatchPaperConversation(job);
            if (!collapsed) setCollapsed(true);
          } catch (error) {
            notice.textContent = String((error as Error)?.message || error);
          }
        });
        row.append(open);
      }
      list.append(row);
    }
    status.textContent = `${batch?.running ? (batch.paused ? "本篇结束后暂停。" : "队列正在执行。") : batch?.paused ? "队列已暂停。" : jobs.length && !jobs.some((j) => j.state === "queued") ? "本轮队列已结束。" : "队列就绪。"}完成 ${jobs.filter((j) => j.state === "completed").length}/${jobs.length}；失败或未完成 ${jobs.filter((j) => ["failed", "blocked"].includes(j.state)).length}；等待 ${jobs.filter((j) => j.state === "queued").length}。结果和错误可通过“打开论文会话”访问；失败项可重新排队。`;
    close.disabled = Boolean(batch?.running);
    start.disabled =
      loadingQueue ||
      Boolean(loadError) ||
      starting ||
      Boolean(batch?.running) ||
      !jobs.some((job) => job.state === "queued");
    resetQueue.disabled =
      loadingQueue ||
      Boolean(loadError) ||
      starting ||
      Boolean(batch?.running) ||
      jobs.some((job) =>
        ["queued", "running", "interrupted"].includes(job.state),
      );
    pause.disabled = !batch?.running || batch.paused;
    stop.disabled =
      !batch?.running && !jobs.some((job) => job.state === "queued");
    modelSelect.disabled = reasoningSelect.disabled = Boolean(batch?.running);
    reloadModels.disabled =
      loadingQueue || catalogLoading || Boolean(batch?.running);
    persistChanged();
  };
  panel.addPapers = (items) => {
    const normalized = normalizeBatchPapers(items),
      known = new Set(jobs.map((job) => job.libraryID + ":" + job.id));
    let added = 0;
    for (const paper of normalized) {
      if (known.has(paper.libraryID + ":" + paper.id)) continue;
      known.add(paper.libraryID + ":" + paper.id);
      added++;
      jobs.push({
        id: paper.id,
        libraryID: paper.libraryID,
        itemKey: paper.key,
        title: String(paper.getField("title")),
        state: "queued",
      });
    }
    if (batch?.stopped && !batch.running && added)
      batch = createSequentialPaperBatch(jobs, execute, render, checkpoint);
    notice.textContent = normalized.length
      ? "新增 " +
        added +
        " 篇；跳过 " +
        (normalized.length - added) +
        " 篇重复文献。队列共 " +
        jobs.length +
        " 篇。" +
        (batch?.running
          ? "新增论文将按顺序接着处理。"
          : "点击“开始 / 继续”处理待执行论文。") +
        (submittedPrompt
          ? "沿用本队列已确认的提示词；模型按开始时的选项执行。"
          : "")
      : "没有可添加的论文。请在 Zotero 文献列表选中条目，或从论文对话点击“加入批量队列”。";
    render();
  };
  addSelected.addEventListener("click", () =>
    panel.addPapers(getBatchLibrarySelection()),
  );
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const ids = (event.dataTransfer?.getData("zotero/item") || "")
      .split(",")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) {
      notice.textContent = "请拖入 Zotero 文献条目；本地 PDF 需先导入 Zotero。";
      return;
    }
    panel.addPapers(ids.map((id) => Zotero.Items.get(id)).filter(Boolean));
  });
  const execute = async (job: PaperBatchJob): Promise<PaperBatchOutcome> => {
    currentCancelled = false;
    job.model = submittedProfile.model;
    job.effort = submittedProfile.reasoningMode;
    job.detail = "正在创建论文会话…";
    render();
    const paper = Zotero.Items.get(job.id);
    if (
      !paper ||
      paper.deleted ||
      paper.libraryID !== job.libraryID ||
      (job.itemKey && job.itemKey !== paper.key)
    )
      throw new Error("文献已删除或所属文库已改变");
    const summary = await createCodexPaperConversation(job.libraryID, job.id);
    if (!summary) throw new Error("无法创建论文会话");
    job.conversationKey = summary.conversationKey;
    await checkpoint();
    if (currentCancelled)
      return { status: "cancelled", detail: "在准备期间停止" };
    await touchCodexConversationTitle(
      summary.conversationKey,
      "批量 · " +
        (shortcuts.find((s) => s.id === presets.value)?.label ||
          submittedPrompt),
    );
    const item = createCodexPaperPortalItem(paper, summary.conversationKey);
    await ensureConversationLoaded(item);
    if (currentCancelled)
      return { status: "cancelled", detail: "在准备期间停止" };
    currentKey = getConversationKey(item);
    job.conversationKey = currentKey;
    setLastUsedCodexPaperConversationKey(job.libraryID, job.id, currentKey);
    activeCodexPaperConversationByPaper.set(
      buildCodexPaperStateKey(job.libraryID, job.id),
      currentKey,
    );
    job.detail = "正在准备请求…";
    render();
    const root = make("div");
    root.id = "llm-main";
    Object.assign(root.dataset, {
      itemId: String(currentKey),
      libraryId: String(job.libraryID),
      basePaperItemId: String(job.id),
      conversationKind: "paper",
      conversationSystem: "codex",
      standalone: "true",
    });
    const workerStatus = make("span");
    workerStatus.id = "llm-status";
    root.append(workerStatus);
    worker.replaceChildren(root);
    bindStandalonePanelHost(worker, item);
    const statusObserver = new (
      win as unknown as Window & typeof globalThis
    ).MutationObserver(() => {
      job.detail = workerStatus.textContent || "等待模型响应…";
      render();
    });
    statusObserver.observe(workerStatus, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    try {
      const paperContext = resolvePaperContextRefFromItem(paper);
      const contextSource = {
        paperContext,
        contextItem: paperContext?.contextItemId
          ? Zotero.Items.get(paperContext.contextItemId)
          : null,
        statusText: `批量处理：${job.title}`,
      };
      const outcome = await sendQuestion({
        body: worker,
        item,
        contextSource,
        question: submittedPrompt!,
        displayQuestion: submittedPrompt,
        model: submittedProfile.model,
        apiBase: submittedProfile.apiBase,
        apiKey: submittedProfile.apiKey,
        authMode: submittedProfile.authMode,
        providerProtocol: submittedProfile.providerProtocol,
        modelEntryId: submittedProfile.entryId,
        modelProviderLabel: submittedProfile.providerLabel,
        advanced: submittedProfile.advanced,
        reasoning: submittedProfile.reasoning,
        reasoningMode: submittedProfile.reasoningMode,
        runtimeMode: "chat",
      });
      if (outcome?.status === "completed") {
        job.detail = "正在确认会话保存…";
        render();
        const stored = await loadStoredConversationByKey(
          currentKey,
          PERSISTED_HISTORY_LIMIT,
          "codex",
        );
        if (
          !stored.some(
            (m) => m.role === "user" && m.text === submittedPrompt,
          ) ||
          !stored.some((m) => m.role === "assistant" && m.text?.trim())
        )
          throw new Error("未确认提示词及回答已保存；请打开论文会话检查");
        return { status: "completed", detail: "回答已保存，可打开论文会话" };
      }
      return (
        outcome || {
          status: "blocked",
          detail:
            workerStatus.textContent || "请求未到达完成状态；请查看该论文会话",
        }
      );
    } finally {
      statusObserver.disconnect();
      currentKey = null;
      clearPanelHostBinding(worker);
      worker.replaceChildren();
    }
  };
  start.addEventListener("click", async () => {
    if (batch?.running || starting || loadingQueue || loadError) return;
    starting = true;
    try {
      if (!jobs.some((job) => job.state === "queued")) {
        notice.textContent =
          "没有等待执行的论文。请添加文献或将失败项重新排队。";
        return;
      }
      if (!prompt.value.trim()) {
        notice.textContent = "请填写提示词正文。";
        return;
      }
      const entry = buildCodexRuntimeModelEntries({
        models: catalogModels,
        selectedModel,
        codexPath: getConfiguredCodexAppServerBinaryPath(),
      }).find((entry) => entry.model === selectedModel);
      if (!entry) throw new Error("请选择 Codex 模型");
      submittedProfile = {
        ...entry,
        reasoning: buildCodexAppServerReasoningConfig(selectedEffort),
        reasoningMode: selectedEffort,
      };
      submittedPrompt = submittedPrompt || prompt.value.trim();
      prompt.disabled = presets.disabled = true;
      if (!batch || batch.stopped)
        batch = createSequentialPaperBatch(jobs, execute, render, checkpoint);
      notice.textContent =
        "已开始：" +
        selectedModel +
        " / " +
        selectedEffort +
        "。正在准备第一篇待执行论文。";
      await batch.run();
    } catch (error) {
      notice.textContent =
        "启动或执行失败：" + String((error as Error)?.message || error);
    } finally {
      starting = false;
      render();
    }
  });
  resetQueue.addEventListener("click", () => {
    if (resetQueue.disabled) return;
    jobs.splice(0);
    batch = undefined;
    submittedPrompt = undefined;
    prompt.disabled = presets.disabled = false;
    notice.textContent =
      "已新建队列。历史回答仍保存在各篇论文会话中；请选择提示词并添加论文。";
    render();
  });
  pause.addEventListener("click", () => {
    batch?.pause();
    notice.textContent = "已请求暂停，本篇完成后停止领取下一篇。";
  });
  stop.addEventListener("click", () => {
    currentCancelled = true;
    if (!batch)
      batch = createSequentialPaperBatch(jobs, execute, render, checkpoint);
    batch.stop();
    if (currentKey) getAbortController(currentKey)?.abort();
    notice.textContent =
      "已请求停止当前及后续论文；已有会话保留，可将停止项重新排队。";
  });
  close.addEventListener("click", async () => {
    if (!batch?.running && !starting && !loadingQueue) {
      try {
        batch?.pause();
        if (!loadError) await checkpoint();
        cleanupPrompts();
        panel.remove();
        paperBatchDialog = null;
      } catch (error) {
        notice.textContent =
          "无法保存队列，请保持窗口打开：" +
          String((error as Error)?.message || error);
      }
    }
  });
  let collapsed = false,
    expandedGeometry:
      | { left: string; top: string; width: string; height: string }
      | undefined;
  const setCollapsed = (value: boolean) => {
    collapsed = value;
    for (const element of [
      help,
      addSelected,
      dropZone,
      notice,
      settings,
      presets,
      prompt,
      list,
    ])
      element.hidden = collapsed;
    prompt.style.display = collapsed ? "none" : "block";
    if (collapsed) {
      expandedGeometry = {
        left: panel.style.left,
        top: panel.style.top,
        width: panel.style.width,
        height: panel.style.height,
      };
      panel.style.width = "360px";
      panel.style.height = "240px";
      panel.style.resize = "none";
    } else if (expandedGeometry) {
      Object.assign(panel.style, expandedGeometry);
      panel.style.resize = "both";
    }
    collapse.textContent = collapsed ? "展开队列" : "收起";
  };
  collapse.addEventListener("click", () => setCollapsed(!collapsed));
  panel.reveal = () => {
    if (collapsed) setCollapsed(false);
    win.focus?.();
    panel.scrollIntoView({ block: "nearest" });
  };
  let drag: {
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null;
  title.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    title.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  title.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left =
      Math.max(
        0,
        Math.min(
          win.innerWidth - Math.min(rect.width, win.innerWidth),
          drag.left + event.clientX - drag.x,
        ),
      ) + "px";
    panel.style.top =
      Math.max(
        0,
        Math.min(
          win.innerHeight - Math.min(rect.height, win.innerHeight),
          drag.top + event.clientY - drag.y,
        ),
      ) + "px";
  });
  const endDrag = () => {
    drag = null;
  };
  title.addEventListener("pointerup", endDrag);
  title.addEventListener("pointercancel", endDrag);
  panel.append(
    title,
    help,
    addSelected,
    dropZone,
    notice,
    settings,
    presets,
    prompt,
    start,
    pause,
    stop,
    resetQueue,
    close,
    collapse,
    status,
    list,
    worker,
  );
  doc.documentElement.append(panel);
  win.focus();
  const incomingPapers = [...papers];
  const addPapersNow = panel.addPapers;
  panel.addPapers = (items) => {
    if (loadingQueue) incomingPapers.push(...items);
    else addPapersNow(items);
  };
  void (async () => {
    try {
      store = createZoteroPaperBatchStore();
      const saved = await store.load();
      if (saved) {
        jobs.push(...saved.jobs);
        prompt.value = saved.prompt;
        submittedPrompt = saved.jobs.some((job) => job.conversationKey)
          ? saved.prompt
          : undefined;
        if (saved.model) selectedModel = saved.model;
        if (saved.effort) selectedEffort = saved.effort;
        if (submittedPrompt) prompt.disabled = presets.disabled = true;
        batch = createSequentialPaperBatch(jobs, execute, render, checkpoint);
        batch.pause();
        notice.textContent =
          "已恢复队列，当前暂停。中断项请先检查会话再决定是否重新排队。";
      }
      loadingQueue = false;
      if (incomingPapers.length) addPapersNow(incomingPapers);
      rebuildModels();
      render();
    } catch (error) {
      loadingQueue = false;
      loadError = String((error as Error)?.message || error);
      notice.textContent = "队列读取失败，原文件保留：" + loadError;
      render();
    }
  })();
  for (const key of [
    "shortcuts",
    "shortcutLabels",
    "shortcutDeleted",
    "customShortcuts",
    "shortcutOrder",
  ]) {
    promptObservers.push(
      Zotero.Prefs.registerObserver(
        config.prefsPrefix + "." + key,
        schedulePromptRefresh,
        true,
      ),
    );
  }
  const onBatchUnload = () => {
    cleanupPrompts();
    batch?.pause();
    currentCancelled = true;
    if (currentKey) getAbortController(currentKey)?.abort();
    persistChanged();
  };
  win.addEventListener?.("unload", onBatchUnload, { once: true });
  panel.shutdown = async () => {
    batch?.pause();
    currentCancelled = true;
    if (currentKey) getAbortController(currentKey)?.abort();
    if (!loadingQueue && !loadError) await checkpoint();
    await store?.flush();
    cleanupPrompts();
    panel.remove();
    paperBatchDialog = null;
  };

  rebuildModels();
  void refreshModels();
  void refreshPrompts();
}

export async function shutdownSequentialPaperBatch() {
  await paperBatchDialog?.shutdown();
}
