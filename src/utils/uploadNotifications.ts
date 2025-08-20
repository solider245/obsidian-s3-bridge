// 概述: 上传通知管理器，提供美观的上传进度通知
// 导出: UploadNotificationManager
// 依赖: Obsidian, UploadProgressManager

import { Notice, Plugin } from 'obsidian';
import { uploadProgressManager, ProgressUpdate, formatFileSize, formatSpeed, formatEta } from './uploadProgress';

export class UploadNotificationManager {
  private plugin: Plugin;
  private activeNotices = new Map<string, Notice>();
  private progressBars = new Map<string, HTMLElement>();

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    uploadProgressManager.addListener(this.onProgressUpdate.bind(this));
  }

  private onProgressUpdate(update: ProgressUpdate): void {
    switch (update.stage) {
      case 'preparing':
        this.showPreparingNotice(update);
        break;
      case 'uploading':
        this.updateProgressNotice(update);
        break;
      case 'processing':
        this.updateProcessingNotice(update);
        break;
      case 'completed':
        this.showCompletedNotice(update);
        break;
      case 'error':
        this.showErrorNotice(update);
        break;
    }
  }

  private showPreparingNotice(update: ProgressUpdate): void {
    const message = this.buildProgressMessage(update);
    const notice = new Notice(message, 0); // 0 = no timeout
    this.activeNotices.set(update.id, notice);
  }

  private updateProgressNotice(update: ProgressUpdate): void {
    const notice = this.activeNotices.get(update.id);
    if (!notice) return;

    const message = this.buildProgressMessage(update);
    notice.setMessage(message);
  }

  private updateProcessingNotice(update: ProgressUpdate): void {
    const notice = this.activeNotices.get(update.id);
    if (!notice) return;

    const message = this.buildProgressMessage(update);
    notice.setMessage(message);
  }

  private showCompletedNotice(update: ProgressUpdate): void {
    const notice = this.activeNotices.get(update.id);
    if (notice) {
      notice.hide();
      this.activeNotices.delete(update.id);
    }

    const fileName = update.fileName || 'File';
    const fileSize = update.fileSize ? ` (${formatFileSize(update.fileSize)})` : '';
    const duration = update.speed ? ` in ${formatEta(update.fileSize! / update.speed)}` : '';
    
    new Notice(`✅ ${fileName}${fileSize} uploaded successfully${duration}`, 5000);
  }

  private showErrorNotice(update: ProgressUpdate): void {
    const notice = this.activeNotices.get(update.id);
    if (notice) {
      notice.hide();
      this.activeNotices.delete(update.id);
    }

    const fileName = update.fileName || 'File';
    new Notice(`❌ Failed to upload ${fileName}: ${update.message}`, 8000);
  }

  private buildProgressMessage(update: ProgressUpdate): string {
    const fileName = update.fileName || 'File';
    const fileSize = update.fileSize ? ` (${formatFileSize(update.fileSize)})` : '';
    const progress = Math.round(update.progress);
    
    let message = `${fileName}${fileSize}\n`;
    
    // 进度条
    const progressBar = this.createProgressBar(progress);
    message += `${progressBar}\n`;
    
    // 详细信息
    const details = [];
    details.push(`${progress}%`);
    
    if (update.stage === 'uploading' && update.speed) {
      details.push(formatSpeed(update.speed));
    }
    
    if (update.stage === 'uploading' && update.eta) {
      details.push(`${formatEta(update.eta)} left`);
    }
    
    message += details.join(' • ');
    
    return message;
  }

  private createProgressBar(progress: number): string {
    const width = 20;
    const filled = Math.round(width * progress / 100);
    const empty = width - filled;
    
    const filledBar = '█'.repeat(filled);
    const emptyBar = '░'.repeat(empty);
    
    return `${filledBar}${emptyBar}`;
  }

  /**
   * 清理所有通知
   */
  cleanup(): void {
    this.activeNotices.forEach(notice => notice.hide());
    this.activeNotices.clear();
    this.progressBars.clear();
  }
}

// 全局实例管理器
let globalNotificationManager: UploadNotificationManager | null = null;

export function initUploadNotifications(plugin: Plugin): UploadNotificationManager {
  if (!globalNotificationManager) {
    globalNotificationManager = new UploadNotificationManager(plugin);
  }
  return globalNotificationManager;
}

export function getUploadNotificationManager(): UploadNotificationManager | null {
  return globalNotificationManager;
}

export function cleanupUploadNotifications(): void {
  if (globalNotificationManager) {
    globalNotificationManager.cleanup();
    globalNotificationManager = null;
  }
}