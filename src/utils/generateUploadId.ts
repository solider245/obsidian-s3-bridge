// 概述: 生成唯一的上传ID，用于确保每次上传都有唯一的对象键
// 导出: generateUploadId(): string
// 依赖: 无（纯函数）

export function generateUploadId(): string {
  // 使用时间戳 + 随机数确保唯一性
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}`;
}

export default { generateUploadId };