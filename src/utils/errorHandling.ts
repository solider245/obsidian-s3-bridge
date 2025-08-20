// 概述: 统一的错误类型定义和错误处理工具
// 导出: UploadError, ErrorType, createUploadError, isUploadError
// 依赖: 无（纯类型定义）

export type ErrorType = 
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'CONFIG_ERROR'
  | 'VALIDATION_ERROR'
  | 'UPLOAD_ERROR'
  | 'UNKNOWN_ERROR';

export interface UploadError extends Error {
  type: ErrorType;
  code?: string;
  details?: Record<string, unknown>;
  originalError?: unknown;
}

export function createUploadError(
  type: ErrorType,
  message: string,
  originalError?: unknown,
  details?: Record<string, unknown>
): UploadError {
  const error = new Error(message) as UploadError;
  error.type = type;
  error.originalError = originalError;
  error.details = details || {};
  
  // 保留原始错误的堆栈信息
  if (originalError instanceof Error) {
    error.stack = originalError.stack;
  }
  
  return error;
}

export function isUploadError(error: unknown): error is UploadError {
  return error instanceof Error && 'type' in error;
}

export function getErrorMessage(error: unknown): string {
  if (isUploadError(error)) {
    return error.message;
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  return 'Unknown error occurred';
}

export function getErrorType(error: unknown): ErrorType {
  if (isUploadError(error)) {
    return error.type;
  }
  
  if (error instanceof Error) {
    // 根据错误消息推断类型
    const message = error.message.toLowerCase();
    if (message.includes('network') || message.includes('fetch')) {
      return 'NETWORK_ERROR';
    }
    if (message.includes('auth') || message.includes('unauthorized')) {
      return 'AUTH_ERROR';
    }
    if (message.includes('config') || message.includes('setting')) {
      return 'CONFIG_ERROR';
    }
    if (message.includes('valid') || message.includes('invalid')) {
      return 'VALIDATION_ERROR';
    }
    if (message.includes('upload')) {
      return 'UPLOAD_ERROR';
    }
  }
  
  return 'UNKNOWN_ERROR';
}