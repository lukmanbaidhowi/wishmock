import { sendBadRequest } from './responseHelper.js';
import path from 'path';

export function validateFilename(filename: string, res: any): boolean {
  if (!filename) {
    sendBadRequest(res, "filename required");
    return false;
  }
  return true;
}

export function validateContent(content: string, res: any): boolean {
  if (!content) {
    sendBadRequest(res, "content required");
    return false;
  }
  return true;
}

export function validateUploadData(filename: string, content: string, res: any): boolean {
  if (!filename || !content) {
    sendBadRequest(res, "filename & content required");
    return false;
  }
  return true;
}

// Validate a user-provided relative path (e.g., "common/types.proto").
// - Must not be empty
// - Must not be absolute
// - Must not traverse upward (no ".." after normalization)
export function validateRelativePath(relPath: string, res: any): boolean {
  if (!relPath) {
    sendBadRequest(res, "path required");
    return false;
  }
  if (path.isAbsolute(relPath)) {
    sendBadRequest(res, "absolute paths not allowed");
    return false;
  }
  const norm = path.normalize(relPath).replace(/\\/g, '/');
  if (norm.startsWith('../') || norm.includes('/../') || norm === '..') {
    sendBadRequest(res, "path traversal not allowed");
    return false;
  }
  const normNoTrail = norm.replace(/\/+$/, '');
  if (normNoTrail === '.' || normNoTrail.length === 0) {
    sendBadRequest(res, "invalid path");
    return false;
  }
  return true;
}
