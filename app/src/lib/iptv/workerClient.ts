import { parseM3U, type ParsedLibrary } from '../m3u/parser';
import { parseXMLTV, type EpgIndex } from '../epg/xmltv';

export type WorkerRequest =
  | { id: number; type: 'm3u'; text: string; playlistId: string }
  | { id: number; type: 'xmltv'; text: string };

export type WorkerResponse =
  | { id: number; ok: true; type: 'm3u'; result: ParsedLibrary }
  | { id: number; ok: true; type: 'xmltv'; result: EpgIndex }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (res: WorkerResponse) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../../workers/library.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    return worker;
  } catch {
    return null; // very old browsers: fall back to the main thread
  }
}

function call(req: WorkerRequest): Promise<WorkerResponse> | null {
  const w = getWorker();
  if (!w) return null;
  return new Promise((resolve) => {
    waiting.set(req.id, resolve);
    w.postMessage(req);
  });
}

export async function parseM3UAsync(text: string, playlistId: string): Promise<ParsedLibrary> {
  const res = await call({ id: ++seq, type: 'm3u', text, playlistId });
  if (res?.ok && res.type === 'm3u') return res.result;
  return parseM3U(text, playlistId);
}

export async function parseXMLTVAsync(text: string): Promise<EpgIndex> {
  const res = await call({ id: ++seq, type: 'xmltv', text });
  if (res?.ok && res.type === 'xmltv') return res.result;
  return parseXMLTV(text);
}
