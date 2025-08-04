# 压力测试操作手册（粘贴图片与上传队列）

目的：在真实/极端条件下验证粘贴链路与调度器的稳定性，确保无“幽灵监听/定时器”、无重复消费、无路径失真导致的读取失败。

适用版本范围：已实现本地写入与占位、入队、手动处理、最小 Scheduler（不自动启动）

相关命令与入口：
- 命令面板：
  - Queue: Status
  - Queue: Process Next Item
  - Scheduler: Start / Stop / Status
- 粘贴入口：
  - 编辑器中直接 Ctrl+V 粘贴图片

验证环境准备：
1. 打开一个 Markdown 笔记用于粘贴测试。
2. 确保 vault 下 .assets 目录可写；粘贴后应生成临时文件。
3. S3 配置已正确（keyPrefix 等），确保上传成功路径可访问。

测试用例清单：

A. 基本链路（手动处理）
1) 粘贴多张图片，观察笔记中出现“上传中占位”（optimistic 协议）。
2) 执行 “Queue: Status”，确认队列长度与前几项信息（id/filename/mime/path）。
3) 执行 “Queue: Process Next Item”，预期：
   - 出现 “Upload successful!” 与 “Queue processed 1 item”
   - 占位替换为最终 URL（图片用 ![](...)，非图片为超链接）
   - 对应临时文件被删除（尽力而为）
4) 重复第 3 步，直至队列清空。

B. 调度器消费（单条/间隔）
1) 粘贴 3-5 张图片。
2) 执行 “Scheduler: Start”，随后执行 “Scheduler: Status”，预期：
   - running=true
   - inFlight=false（空闲时）
   - intervalMs=2500
3) 等待 10 秒，执行 “Queue: Status”，预期队列长度按 tick 每次减少 1 条。
4) 在调度器运行中手动执行 “Queue: Process Next Item”，预期不会重复消费同一条，整体仍串行。

C. 调度器停止与幂等
1) 执行 “Scheduler: Stop”，等待 5 秒。
2) 执行 “Scheduler: Status”，预期 running=false。
3) 再次执行 “Queue: Status”，队列不再下降。

D. 冷/热态启停回归
1) 运行中执行 “Scheduler: Stop”。
2) 在 Obsidian 插件管理中禁用插件 → 再启用插件（共 3 轮）。
3) 每轮启用后执行 “Scheduler: Status”，预期不自动启动（running=false）。
4) 手动 “Start/Stop/Status” 循环，确认无“幽灵定时器”（症状：一个周期内多次消费或状态错乱）。

E. 路径健壮性（查询串剥离与缓存兜底）
1) 粘贴 1 张图片，记录队首项 path（如 .assets/foo.png）。
2) 在文件名后手动追加查询串（例如重命名为 foo.png?12345 或通过外部工具模拟带查询访问）。
3) 启动调度器或执行手动处理，预期仍能成功消费（processNext 会剥离 ? 后缀）。
4) 删除该条目的本地临时文件，但保持 optimistic 内存缓存存在（不要重启 Obsidian），再处理，预期成功（走缓存）。
5) 同时删除缓存与本地文件，处理应失败：保留队列项并替换为失败占位；后续可重试。

判定标准与记录：
- 任一环节失败需记录具体提示（Notice）与日志片段（如队列长度、队首 id、path）。
- 重点观察：是否出现重复消费、是否有“Upload successful!”漏发、是否存在残留定时器导致异步继续消费。

已知风险与规避：
- 手动改名/删除临时文件仅用于测试；实际用户流程不建议操作。
- 若 S3 配置错误，全部上传均会失败，此时需先修正配置再重复测试。

结论输出模板：
- 版本号 / 提交号：
- 执行轮次：
- 核心结果：通过 / 发现问题（附问题清单与复现步骤）
- 建议修复与回归范围：