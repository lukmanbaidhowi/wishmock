export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

export const FILE_EXTENSIONS = {
  PROTO: ['.proto'],
  RULES: ['.yaml', '.yml', '.json']
} as const;