/**
 * Saving Tuning Data back to the repo's JSON files. Uses the File System
 * Access API where available (Chrome/Edge), otherwise falls back to a download.
 */

interface FileHandle {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
type SaveFilePicker = (opts: {
  suggestedName: string;
  id?: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandle>;

export type SaveResult = 'written' | 'downloaded' | 'cancelled';

/** Handles picked this session, so later saves of the same file don't ask again. */
const handles = new Map<string, FileHandle>();

export async function saveJsonFile(fileName: string, text: string): Promise<SaveResult> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    download(fileName, text);
    return 'downloaded';
  }
  let handle = handles.get(fileName);
  if (!handle) {
    try {
      handle = await picker({
        suggestedName: fileName,
        id: 'sword-tuning-data',
        types: [{ description: 'Tuning Data JSON', accept: { 'application/json': ['.json'] } }],
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      throw e;
    }
    handles.set(fileName, handle);
  }
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
  return 'written';
}

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
