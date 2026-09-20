interface ChatParams {
  personaId: string;
  provider: string;
  providerLabel: string;
}

export interface PendingGalleryMedia {
  uri: string;
  isVideo: boolean;
  mimeType: string;
  fileName: string;
  durationSec?: number;
}

let _chatParams: ChatParams | null = null;
let _groupPersonaIds: string[] = [];
let _editPersonaId: string | null = null;
let _offlineChatPersonaId: string | null = null;
let _pendingPhotoStyle: string = '';
let _autoStoryQuery: boolean = false;
let _pendingGalleryMedia: PendingGalleryMedia | null = null;
let _urlPersonaId: string | null = null;

export const ParamsStore = {
  setChatParams: (p: ChatParams) => { _chatParams = p; },
  getChatParams: () => _chatParams,

  setGroupPersonaIds: (ids: string[]) => { _groupPersonaIds = ids; },
  getGroupPersonaIds: () => _groupPersonaIds,

  setEditPersonaId: (id: string) => { _editPersonaId = id; },
  getEditPersonaId: () => _editPersonaId,

  setOfflineChatPersonaId: (id: string | null) => { _offlineChatPersonaId = id; },
  getOfflineChatPersonaId: () => _offlineChatPersonaId,

  setPendingPhotoStyle: (style: string) => { _pendingPhotoStyle = style; },
  getPendingPhotoStyle: () => _pendingPhotoStyle,
  clearPendingPhotoStyle: () => { _pendingPhotoStyle = ''; },

  setAutoStoryQuery: (v: boolean) => { _autoStoryQuery = v; },
  getAutoStoryQuery: () => _autoStoryQuery,
  clearAutoStoryQuery: () => { _autoStoryQuery = false; },

  setPendingGalleryMedia: (media: PendingGalleryMedia) => { _pendingGalleryMedia = media; },
  getPendingGalleryMedia: () => _pendingGalleryMedia,
  clearPendingGalleryMedia: () => { _pendingGalleryMedia = null; },
  setUrlPersonaId: (id: string) => {
    _urlPersonaId = id;
  },
  getUrlPersonaId: () => _urlPersonaId,
};
