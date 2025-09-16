import { sendBadRequest } from './responseHelper.js';

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