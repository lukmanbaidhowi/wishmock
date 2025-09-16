import { HTTP_STATUS } from './constants.js';

export function sendError(res: any, error: unknown, defaultMessage: string) {
  const message = error instanceof Error ? error.message : String(error);
  res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: message || defaultMessage });
}

export function sendBadRequest(res: any, message: string) {
  res.status(HTTP_STATUS.BAD_REQUEST).json({ error: message });
}

export function sendNotFound(res: any, message: string) {
  res.status(HTTP_STATUS.NOT_FOUND).json({ error: message });
}

export function sendSuccess(res: any, data: any) {
  res.status(HTTP_STATUS.OK).json(data);
}