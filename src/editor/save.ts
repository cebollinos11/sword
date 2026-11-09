/**
 * Saving Tuning Data back to the repo's JSON files (and, for the Map Editor, a map's model beside them). Uses the File System
 * Access API where available (Chrome/Edge), otherwise falls back to a download.
 */

interface FileHandle {
  createWritable(): Promise<{ write(data: string | ArrayBuffer): Promise<void>; close(): Promise<void> }>;
}
type SaveFilePicker = (opts: {
  suggestedName: string;
  id?: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandle>;

export type SaveResult = 'written' | 'downloaded' | 'cancelled';

/** Handles picked this session, so later saves of the same file don't ask again. */
const handles = new Map<string, FileHandle>();

/** A kind of file saved: what the picker calls it, its media type and extension, and the folder the picker remembers for it. */
interface FileKind {
  readonly description: string;
  readonly type: string;
  readonly extension: string;
  readonly id: string;
}
const JSON_FILE: FileKind = { description: 'Tuning Data JSON', type: 'application/json', extension: '.json', id: 'sword-tuning-data' };
const GLB_FILE: FileKind = { description: 'glTF binary model', type: 'model/gltf-binary', extension: '.glb', id: 'sword-models' };

export function saveJsonFile(fileName: string, text: string): Promise<SaveResult> {
  return saveFile(fileName, text, JSON_FILE);
}

/** Save a binary glTF model (a Map Editor map's, `public/models/arenas/battle_<map>.glb`). */
export function saveGlbFile(fileName: string, data: ArrayBuffer): Promise<SaveResult> {
  return saveFile(fileName, data, GLB_FILE);
}

async function saveFile(fileName: string, data: string | ArrayBuffer, kind: FileKind): Promise<SaveResult> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    download(fileName, data, kind.type);
    return 'downloaded';
  }
  let handle = handles.get(fileName);
  if (!handle) {
    try {
      handle = await picker({
        suggestedName: fileName,
        id: kind.id,
        types: [{ description: kind.description, accept: { [kind.type]: [kind.extension] } }],
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      throw e;
    }
    handles.set(fileName, handle);
  }
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
  return 'written';
}

function download(fileName: string, data: string | ArrayBuffer, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
