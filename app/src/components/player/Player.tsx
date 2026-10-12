'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { playback, playerStore } from '@/lib/player/controller';
import { useI18n } from '@/lib/i18n';
import { app, updateSettings } from '@/store/app';
import { useStore } from '@/store/createStore';
import { clamp, cx, formatClock } from '@/lib/utils';
import type { ItemKind } from '@/types';
import { Artwork } from '../ui/Artwork';
import { FavoriteButton, IconButton } from '../ui/controls';
import { PlayerMenu } from './PlayerMenu';
import { PlayerStatusOverlay } from './PlayerOverlays';

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export interface PlayerProps {
  title: string;
  subtitle?: string;
  logo?: string;
  /** Channel number, shown TV-style when zapping. */
  number?: number;
  /** Changes whenever the source changes; re-triggers the on-screen banner. */
  bannerKey: string | number;
  favorite?: { kind: ItemKind; id: string };
  onZap?: (delta: number) => void;
  onPrevious?: () => void;
  onBack?: () => void;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
  /** Shown instead of the video surface while nothing is selected. */
  placeholder?: ReactNode;
  className?: string;
}

const HIDE_AFTER = 3200;

/** TV Pro's own player chrome. The <video> element is mounted once and only its source changes. */
export function Player(props: PlayerProps) {
  const { title, subtitle, logo, number, bannerKey, favorite, onZap, onPrevious, onBack, onProgress, onEnded, placeholder, className } = props;
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<FullscreenVideo>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastSaved = useRef(0);

  const status = useStore(playerStore, (s) => s.status);
  const live = useStore(playerStore, (s) => s.isLive);
  const unstable = useStore(playerStore, (s) => s.unstable);
  const pipEnabled = useStore(app, (s) => s.settings.pictureInPicture);

  const [controls, setControls] = useState(true);
  const [banner, setBanner] = useState(false);
  const [menu, setMenu] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const [volume, setVolume] = useState(() => app.get().settings.volume);
  const [muted, setMuted] = useState(() => app.get().settings.muted);
  const [speed, setSpeed] = useState(1);
  const [pipSupported, setPipSupported] = useState(false);

  const idle = status === 'idle';
  const playing = status === 'playing' || status === 'buffering';
  const seekable = !live && time.duration > 0 && Number.isFinite(time.duration);

  /* ── lifecycle: attach once, destroy on leave (no leaked engines, sockets or buffers) ── */
  useEffect(() => {
    const video = videoRef.current!;
    video.volume = app.get().settings.volume;
    video.muted = app.get().settings.muted;
    playback.attach(video);
    setPipSupported('pictureInPictureEnabled' in document && document.pictureInPictureEnabled);
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
      playback.detach();
    };
  }, []);

  /* ── controls visibility ── */
  const wake = useCallback(() => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), HIDE_AFTER);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const visible = controls || menu || !playing;

  useEffect(() => {
    setBanner(true);
    setSpeed(1);
    const id = setTimeout(() => setBanner(false), 2400);
    return () => clearTimeout(id);
  }, [bannerKey]);

  /* ── actions ── */
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || playerStore.get().status === 'error') return;
    if (v.paused) void v.play().catch(() => undefined); else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    updateSettings({ muted: v.muted });
  }, []);

  const changeVolume = useCallback((value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = clamp(value, 0, 1);
    v.muted = v.volume === 0;
    setVolume(v.volume);
    setMuted(v.muted);
    updateSettings({ volume: v.volume, muted: v.muted });
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) v.currentTime = clamp(v.currentTime + delta, 0, v.duration);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) return void document.exitFullscreen();
    const wrap = wrapRef.current;
    if (wrap?.requestFullscreen) void wrap.requestFullscreen().catch(() => undefined);
    else videoRef.current?.webkitEnterFullscreen?.(); // iPhone only offers native video full screen
  }, []);

  const togglePip = useCallback(() => {
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void videoRef.current?.requestPictureInPicture().catch(() => undefined);
  }, []);

  const changeSpeed = useCallback((rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setSpeed(rate);
  }, []);

  /* ── keyboard & remote ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || playerStore.get().status === 'idle') return;
      const target = e.target as HTMLElement;
      if (target.closest('input:not([type="range"]),textarea,select,[contenteditable="true"]')) return;
      const active = document.activeElement;
      const onActiveChannel = Boolean(active?.matches('[role="option"][aria-selected="true"]')); // the row that is playing: ↑ ↓ zap
      const owns = !active || active === document.body || onActiveChannel || Boolean(wrapRef.current?.contains(active)) || Boolean(document.fullscreenElement);
      const onControl = Boolean(target.closest('button,a,input,[role="button"]'));
      let handled = true;

      switch (e.key) {
        case ' ': case 'Enter': if (onControl) return; togglePlay(); break;
        case 'k': case 'MediaPlayPause': togglePlay(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'm': case 'M': toggleMute(); break;
        case 'p': case 'P': if (pipSupported) togglePip(); break;
        case 'l': case 'L': onPrevious?.(); break;
        case 'ChannelUp': case 'PageUp': onZap?.(1); break;
        case 'ChannelDown': case 'PageDown': onZap?.(-1); break;
        case 'ArrowUp': case 'ArrowDown':
          if (!owns || menu || !onZap || target instanceof HTMLInputElement) return;
          onZap(e.key === 'ArrowUp' ? -1 : 1);
          break;
        case 'ArrowLeft': case 'ArrowRight':
          if (!owns || menu || playerStore.get().isLive || onControl) return;
          seekBy(e.key === 'ArrowLeft' ? -10 : 10);
          break;
        case 'Escape': if (!menu) return; setMenu(false); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); e.stopPropagation(); }
      wake();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, onPrevious, onZap, pipSupported, seekBy, toggleFullscreen, toggleMute, togglePip, togglePlay, wake]);

  /* ── progress (recorded content only) ── */
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || playerStore.get().isLive) return;
    setTime({ current: v.currentTime, duration: v.duration });
    if (onProgress && Number.isFinite(v.duration) && Math.abs(v.currentTime - lastSaved.current) > 5) {
      lastSaved.current = v.currentTime;
      onProgress(v.currentTime, v.duration);
    }
  };

  const connection = status === 'reconnecting' ? t('player.reconnecting') : unstable ? t('player.unstable') : null;

  return (
    <div
      ref={wrapRef}
      onPointerMove={wake}
      onPointerLeave={() => playing && !menu && setControls(false)}
      className={cx('group relative isolate overflow-hidden bg-black text-white', !visible && playing && 'cursor-none', className)}
    >
      <video
        ref={videoRef} playsInline autoPlay preload="none" aria-label={title}
        className="absolute inset-0 h-full w-full"
        onTimeUpdate={onTimeUpdate} onEnded={onEnded}
        onDoubleClick={toggleFullscreen}
        onPointerUp={(e) => { if (e.pointerType === 'touch') { if (controls) setControls(false); else wake(); } else togglePlay(); }}
      />

      {idle && placeholder ? <div className="absolute inset-0 z-10">{placeholder}</div> : <PlayerStatusOverlay onBack={onBack} />}

      {/* top: what am I watching — also flashes on every zap, like a TV banner */}
      {!idle && (
        <div
          className={cx('pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-3 bg-gradient-to-b from-black/75 to-transparent p-4 pb-12 transition-opacity duration-200 sm:p-5 sm:pb-14',
            visible || banner ? 'opacity-100' : 'opacity-0')}
        >
          {onBack && <IconButton icon="back" label={t('player.back')} tone="onVideo" onClick={onBack} className="pointer-events-auto -ms-1 rtl:-scale-x-100" />}
          {number !== undefined && <span className="pt-0.5 font-mono text-2xl font-medium leading-none text-white/90 tabular sm:text-3xl">{String(number).padStart(2, '0')}</span>}
          {logo && <Artwork variant="logo" src={logo} name={title} className="h-10 w-10 !bg-white/10" />}
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate ltr:text-left rtl:text-right text-base font-semibold leading-tight sm:text-lg">{title}</p>
            {subtitle && <p className="mt-0.5 truncate text-sm text-white/70">{subtitle}</p>}
          </div>
          {live && (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-black/40 px-2 py-1 text-[0.68rem] font-semibold tracking-[0.08em]">
                <span className="h-1.5 w-1.5 rounded-full bg-live" style={{ animation: status === 'playing' ? 'live-pulse 2s ease-in-out infinite' : undefined }} />
                {t('player.live')}
              </span>
              {connection && <span className="text-[0.7rem] text-amber-200/90" role="status">{connection}</span>}
            </div>
          )}
        </div>
      )}

      {/* bottom: controls */}
      {!idle && (
        <div
          className={cx('absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-12 transition-opacity duration-200 sm:px-3',
            visible ? 'opacity-100' : 'pointer-events-none opacity-0')}
          onPointerMove={(e) => { e.stopPropagation(); setControls(true); clearTimeout(hideTimer.current); }}
        >
          {seekable && (
            <div className="flex items-center gap-3 px-2 pb-1" dir="ltr">
              <span className="font-mono text-xs text-white/80 tabular">{formatClock(time.current)}</span>
              <input
                type="range" aria-label={t('player.seek')} className="range flex-1" min={0} max={time.duration} step={1} value={time.current}
                style={{ ['--fill' as string]: `${(time.current / time.duration) * 100}%` }}
                onChange={(e) => { const v = videoRef.current; if (v) { v.currentTime = Number(e.target.value); setTime((s) => ({ ...s, current: v.currentTime })); } }}
              />
              <span className="font-mono text-xs text-white/60 tabular">{formatClock(time.duration)}</span>
            </div>
          )}
          <div className="relative flex items-center gap-0.5">
            <IconButton icon={playing ? 'pause' : 'play'} filled={!playing} label={t(playing ? 'player.pause' : 'player.play')} tone="onVideo" onClick={togglePlay} size={22} />
            {onPrevious && <IconButton icon="swap" label={`${t('player.previous')} (L)`} tone="onVideo" onClick={onPrevious} />}
            <IconButton icon={muted || volume === 0 ? 'muted' : 'volume'} label={`${t(muted ? 'player.unmute' : 'player.mute')} (M)`} tone="onVideo" onClick={toggleMute} />
            <input
              type="range" aria-label={t('player.volume')} className="range hidden w-20 sm:block" min={0} max={1} step={0.05} value={muted ? 0 : volume}
              style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }} onChange={(e) => changeVolume(Number(e.target.value))}
            />
            <span className="flex-1" />
            {favorite && <FavoriteButton kind={favorite.kind} id={favorite.id} tone="onVideo" />}
            <span data-menu-toggle><IconButton icon="sliders" label={t('player.options')} tone="onVideo" active={menu} onClick={() => setMenu((m) => !m)} /></span>
            {pipSupported && pipEnabled && <IconButton icon="pip" label={`${t('player.pip')} (P)`} tone="onVideo" onClick={togglePip} />}
            <IconButton icon={fullscreen ? 'exitFullscreen' : 'fullscreen'} label={`${t(fullscreen ? 'player.exitFullscreen' : 'player.fullscreen')} (F)`} tone="onVideo" onClick={toggleFullscreen} />
            {menu && <PlayerMenu live={live} speed={speed} onSpeed={changeSpeed} onClose={() => setMenu(false)} />}
          </div>
        </div>
      )}
    </div>
  );
}
