import { memo } from 'react';
import type { Channel, EPGProgram } from '@/types';
import { cx } from '@/lib/utils';
import { Artwork } from '../ui/Artwork';
import { FavoriteButton, ProgressBar } from '../ui/controls';

interface Props {
  channel: Channel;
  active: boolean;
  program?: EPGProgram;
  now: number;
  onSelect: (id: string) => void;
}

export const CHANNEL_ROW_HEIGHT = 64;

/** Memoised: zapping re-renders two rows (old + new active), not the list. */
export const ChannelRow = memo(function ChannelRow({ channel, active, program, now, onSelect }: Props) {
  return (
    <div
      role="option" aria-selected={active} tabIndex={0} data-autofocus={active || undefined}
      onClick={() => onSelect(channel.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onSelect(channel.id); } }}
      style={{ height: CHANNEL_ROW_HEIGHT }}
      className={cx(
        'group relative flex cursor-pointer items-center gap-3 rounded-md pe-1 ps-3 transition-colors duration-150 focus-visible:-outline-offset-2',
        active ? 'bg-accent/10' : 'hover:bg-raised',
      )}
    >
      {active && <span className="absolute inset-y-3 start-0 w-[3px] rounded-full bg-accent" aria-hidden="true" />}
      <span className={cx('w-8 shrink-0 text-end font-mono text-xs tabular', active ? 'text-accent' : 'text-faint')}>{channel.number}</span>
      <Artwork variant="logo" src={channel.logo} name={channel.name} className="h-10 w-10" />
      <span className="min-w-0 flex-1">
        <span dir="auto" className={cx('block truncate text-sm ltr:text-left rtl:text-right font-medium', active && 'text-accent')}>{channel.name}</span>
        {program ? (
          <>
            <span className="block truncate text-xs text-muted">{program.title}</span>
            <ProgressBar value={(now - program.start) / (program.end - program.start)} className="mt-1.5 max-w-[10rem]" />
          </>
        ) : (
          channel.group && <span className="block truncate text-xs text-faint">{channel.group}</span>
        )}
      </span>
      <FavoriteButton kind="channel" id={channel.id} className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100 [@media(hover:none)]:opacity-100" />
    </div>
  );
});
