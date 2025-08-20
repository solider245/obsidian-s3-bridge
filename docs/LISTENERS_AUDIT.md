# 监听注册与卸载审计清单

目的：系统性盘点并审计插件内所有“注册型副作用”，确保生命周期可控、无幽灵监听/定时器、启停一致、卸载彻底。

适用范围：事件监听（registerEvent/registerDomEvent）、命令（addCommand）、定时任务（registerInterval/自建 setInterval）、文件系统观察、全局状态持有（单例/缓存）等。

一、审计对象分类

1. 命令类（Command）

- 注册：this.addCommand
- 清理：由 Obsidian 宿主托管（卸载即失效）
- 风险：重复注册（onload 被重复调用或模块顶层副作用）

2. 事件类（Workspace/Vault/DOM）

- 注册：this.registerEvent / this.registerDomEvent
- 清理：由 this.registerXxx 托管；若未通过 this.registerXxx 注册，需手动 remove
- 风险：未托管的 addEventListener 导致幽灵回调

3. 定时器/调度器

- 注册：this.registerInterval（推荐）或 setInterval（不推荐）
- 清理：registerInterval 自动托管；setInterval 需手动 clearInterval
- 风险：重复创建多实例、onunload 未清理、并发消费

4. 文件系统/适配器监听

- 注册：adapter.watch / Vault.on('modify'...)
- 清理：对应 off/close
- 风险：顶层注册/跨 onload 生命周期

5. 全局单例与缓存

- 对象：scheduler、optimistic 缓存、队列持久化
- 清理：onunload 主动 stop/清空内存快照
- 风险：模块级静态在热重载后残留旧实例

二、当前项目登记表（示例与要求）

- src/commands/registerCommands.ts
  - addCommand：Queue: Status / Process Next Item / Scheduler: Start/Stop/Status
  - 风险：低；命令由宿主托管，无需显式清理
  - 注意：内部保持 scheduler 单例，需要在 index.onunload 做 stop

- src/scheduler/queueScheduler.ts
  - 内部：持有 interval 句柄 + inFlight 并发锁
  - 生命周期：创建于 getScheduler(plugin)；stop() 清理 interval
  - 注意：不自动启动；index.onunload 调用 stop

- src/features/installRetryHandler.ts
  - 计划：统一失败占位的点击重试入口（通过 this.registerDomEvent 或 editor 事件）
  - 要求：必须用 this.registerXxx 托管，避免顶层副作用

三、审计流程（每次改动后执行）

1. 顶层副作用扫描

- 禁止在模块顶层直接 setInterval、addEventListener、adapter.watch
- 如需单例，暴露工厂 + 由 onload/命令侧控制创建

2. 生命周期归一

- 所有外部资源注册必须经 this.registerXxx 托管
- 不可直接 window.addEventListener（除非 this.registerDomEvent 包裹）

3. onunload 清理

- 若存在模块级单例（scheduler 等），onunload 必须显式 stop/释放
- 缓存/临时状态（optimistic）允许自然释放；但建议提供 clear() 便于测试

4. 重复注册检测

- 压力测试：多次禁用/启用插件 + Start/Stop 循环
- 观察是否出现重复消费或重复回调现象

四、检查清单（开发前/合入前）

- [ ] 所有监听均使用 this.registerXxx 托管
- [ ] 定时器由 this.registerInterval 或集中 stop 管理
- [ ] 单例创建点唯一，且在 onunload 停止
- [ ] 无模块顶层副作用造成跨生命周期资源占用
- [ ] 对应文档与代码注释已补充

五、建议与最佳实践

- 单一职责：监听注册集中在 installXxx 模块，onload 中仅调用安装函数
- 可测试性：调度器暴露 status() 便于测试；提供 stop() 幂等
- 失败策略：监听内部出错要捕获并降级，避免影响全局
