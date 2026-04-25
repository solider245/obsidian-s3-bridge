# Bug 修复手册

本文档记录 Obsidian S3-Bridge 仓库中的 Bug 修复计划。

## 修复清单

### 高优先级

#### 1. SupabaseDatabaseManager.ts:357 - 操作符优先级错误
**问题**: `access_count` 逻辑计算错误，永远只返回 1
**原因**: `|| 0 + 1` 优先级导致先计算 `0 + 1 = 1`
**修复**: 添加括号 `(access_count || 0) + 1`
**状态**: 待修复

#### 2. DataSyncService.ts:79-86 - setInterval 内存泄漏
**问题**: `setInterval` 从未清理，导致内存泄漏
**修复**: 存储 interval ID，在 resetSyncState 中清理
**状态**: 待修复

#### 3. DataSyncService.ts:69-76 - 事件监听器内存泄漏
**问题**: `online/offline` 事件监听器从未移除
**修复**: 存储监听器引用，在 resetSyncState 中移除
**状态**: 待修复

#### 4. main.ts:136-138 - sync 监听器未移除
**问题**: 添加了 sync 监听器但未在 cleanup 时移除
**修复**: 存储监听器引用，在 cleanupSupabase 中移除
**状态**: 待修复

### 中等优先级

#### 5. main.ts:128 - 缺少 await
**问题**: `saveSettings()` 缺少 await，可能导致竞态条件
**修复**: 添加 await
**状态**: 待修复

#### 6. sizeGuard.ts:14-15 - 操作符优先级
**问题**: `maxMB * 1024 * 1024` 可能被错误计算
**修复**: 添加括号确保优先级正确
**状态**: 待修复

---

## 修复记录

| 日期 | Bug ID | 描述 | 状态 |
|------|--------|------|------|
| 2026-04-25 | 1 | SupabaseDatabaseManager.ts:357 操作符优先级错误 | ✅ 已修复 |
| 2026-04-25 | 2 | DataSyncService.ts:79-86 setInterval 内存泄漏 | ✅ 已修复 |
| 2026-04-25 | 3 | DataSyncService.ts:69-76 事件监听器内存泄漏 | ✅ 已修复 |
| 2026-04-25 | 4 | main.ts:136-138 sync 监听器未移除 | ✅ 已修复 |
| 2026-04-25 | 5 | main.ts:128 缺少 await | ✅ 已修复 |
| 2026-04-25 | 6 | sizeGuard.ts:14-15 操作符优先级 | ✅ 已修复 |