/**
 * Queue Scheduler (minimal, annotated)
 * - 单实例、手动启动/停止、每 tick 处理 1 条、幂等防重入
 * - 仅封装调度与并发控制；实际处理复用 processNext(plugin)
 */
import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';
import { processNext } from '../queue/processNext';

type Status = {
  running: boolean;
  inFlight: boolean;
  intervalMs: number;
};

export interface QueueScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  status(): Status;
}

/**
 * 通过模块级弱引用/标识避免重复实例（按需）
 * 这里交由调用方持有返回实例，并在 onload/onunload 控制其生命周期
 */
export function createQueueScheduler(plugin: Plugin, opts?: { intervalMs?: number }): QueueScheduler {
  const intervalMs = Math.max(500, Number(opts?.intervalMs ?? 2500));
  let timer: number | NodeJS.Timer | null = null;
  let running = false;
  let inFlight = false;

  async function tick() {
    if (!running) return;
    if (inFlight) {
      // 并发保护：仍在进行中，不重入
      try { console.debug?.('[ob-s3-gemini][scheduler] skip: inFlight'); } catch {}
      return;
    }
    inFlight = true;
    try {
      // 每次仅处理 1 条
      const { processed } = await processNext(plugin);
      try {
        console.info?.('[ob-s3-gemini][scheduler] tick', { processed });
      } catch {}
      // processed 为 false 时不做额外处理，等下一次 tick
    } catch (e: any) {
      try {
        console.warn?.('[ob-s3-gemini][scheduler] error', { err: e?.message ?? String(e) });
      } catch {}
      new Notice(`Scheduler tick failed: ${e?.message ?? String(e)}`);
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (running) {
      try { console.info?.('[ob-s3-gemini][scheduler] already running'); } catch {}
      return;
    }
    running = true;
    try { console.info?.('[ob-s3-gemini][scheduler] start', { intervalMs }); } catch {}
    // 立即触发一次，随后进入节拍
    void tick();
    timer = setInterval(() => void tick(), intervalMs) as unknown as number;
    // 由调用方（命令/插件）在 onunload 时 stop() 或通过 this.registerInterval 包装
  }

  function stop() {
    if (!running) return;
    running = false;
    try { console.info?.('[ob-s3-gemini][scheduler] stop'); } catch {}
    if (timer) {
      clearInterval(timer as number);
      timer = null;
    }
  }

  function isRunning() {
    return running;
  }

  function status(): Status {
    return { running, inFlight, intervalMs };
  }

  return { start, stop, isRunning, status };
}

export default { createQueueScheduler };