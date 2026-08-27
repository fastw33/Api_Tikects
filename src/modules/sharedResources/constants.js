export const PROVIDERS = {
  ONEDRIVE: 'onedrive',
  SHAREPOINT: 'sharepoint',
  GOOGLE_DRIVE: 'google-drive',
  DROPBOX: 'dropbox',
  DIRECT: 'direct',
  UNKNOWN: 'unknown',
}

export const RESOURCE_TYPES = {
  SPREADSHEET: 'spreadsheet',
  DOCUMENT: 'document',
  PRESENTATION: 'presentation',
  PDF: 'pdf',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  ARCHIVE: 'archive',
  FOLDER: 'folder',
  FILE: 'file',
  UNKNOWN: 'unknown',
}

export const SOURCES = {
  API: 'api',
  CONTENT_DISPOSITION: 'content-disposition',
  HTML_METADATA: 'html-metadata',
  PROVIDER_METADATA: 'provider-metadata',
  URL: 'url',
  URL_HINT: 'url-hint',
}

export const CONFIDENCE = {
  CONFIRMED: 'confirmed',
  PROBABLE: 'probable',
}

export const EXTENSION_RESOURCE_TYPE = {
  xlsx: RESOURCE_TYPES.SPREADSHEET,
  xls: RESOURCE_TYPES.SPREADSHEET,
  xlsm: RESOURCE_TYPES.SPREADSHEET,
  csv: RESOURCE_TYPES.SPREADSHEET,
  docx: RESOURCE_TYPES.DOCUMENT,
  doc: RESOURCE_TYPES.DOCUMENT,
  txt: RESOURCE_TYPES.DOCUMENT,
  rtf: RESOURCE_TYPES.DOCUMENT,
  pptx: RESOURCE_TYPES.PRESENTATION,
  ppt: RESOURCE_TYPES.PRESENTATION,
  pdf: RESOURCE_TYPES.PDF,
  png: RESOURCE_TYPES.IMAGE,
  jpg: RESOURCE_TYPES.IMAGE,
  jpeg: RESOURCE_TYPES.IMAGE,
  webp: RESOURCE_TYPES.IMAGE,
  gif: RESOURCE_TYPES.IMAGE,
  svg: RESOURCE_TYPES.IMAGE,
  mp4: RESOURCE_TYPES.VIDEO,
  mov: RESOURCE_TYPES.VIDEO,
  webm: RESOURCE_TYPES.VIDEO,
  mp3: RESOURCE_TYPES.AUDIO,
  wav: RESOURCE_TYPES.AUDIO,
  m4a: RESOURCE_TYPES.AUDIO,
  zip: RESOURCE_TYPES.ARCHIVE,
  rar: RESOURCE_TYPES.ARCHIVE,
  '7z': RESOURCE_TYPES.ARCHIVE,
  tar: RESOURCE_TYPES.ARCHIVE,
  gz: RESOURCE_TYPES.ARCHIVE,
}

export const MIME_RESOURCE_TYPE = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    RESOURCE_TYPES.SPREADSHEET,
  'application/vnd.ms-excel': RESOURCE_TYPES.SPREADSHEET,
  'text/csv': RESOURCE_TYPES.SPREADSHEET,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    RESOURCE_TYPES.DOCUMENT,
  'application/msword': RESOURCE_TYPES.DOCUMENT,
  'text/plain': RESOURCE_TYPES.DOCUMENT,
  'application/rtf': RESOURCE_TYPES.DOCUMENT,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    RESOURCE_TYPES.PRESENTATION,
  'application/vnd.ms-powerpoint': RESOURCE_TYPES.PRESENTATION,
  'application/pdf': RESOURCE_TYPES.PDF,
  'application/zip': RESOURCE_TYPES.ARCHIVE,
  'application/x-7z-compressed': RESOURCE_TYPES.ARCHIVE,
  'application/x-rar-compressed': RESOURCE_TYPES.ARCHIVE,
  'application/x-tar': RESOURCE_TYPES.ARCHIVE,
  'application/gzip': RESOURCE_TYPES.ARCHIVE,
}

export const DEFAULT_RESOLVE_OPTIONS = {
  maxUrlsPerMessage: 5,
  concurrency: 3,
  redirectLimit: 5,
  timeoutMs: 5000,
  maxHtmlBytes: 128 * 1024,
  cacheTtlMs: 30 * 60 * 1000,
}
