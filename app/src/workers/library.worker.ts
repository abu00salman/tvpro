/// <reference lib="webworker" />
import { parseM3U } from '@/lib/m3u/parser';
import { parseXMLTV } from '@/lib/epg/xmltv';
import type { WorkerRequest, WorkerResponse } from '@/lib/iptv/workerClient';

/** Heavy text parsing happens here so the UI thread never freezes on big playlists. */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  let res: WorkerResponse;
  try {
    res = req.type === 'm3u'
      ? { id: req.id, ok: true, type: 'm3u', result: parseM3U(req.text, req.playlistId) }
      : { id: req.id, ok: true, type: 'xmltv', result: parseXMLTV(req.text) };
  } catch (e) {
    res = { id: req.id, ok: false, error: e instanceof Error ? e.message : 'parse failed' };
  }
  (self as DedicatedWorkerGlobalScope).postMessage(res);
};
