import { memo } from 'react';
import type { Channel } from '@/types';
import { Artwork } from '../ui/Artwork';

export const ChannelCard = memo(function ChannelCard({ channel, program, onOpen }: { channel: Channel; program?: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="card flex w-64 items-center gap-3 p-3 text-start transition duration-200 ease-out hover:border-line-strong active:scale-[0.98]">
      <Artwork variant="logo" src={channel.logo} name={channel.name} className="h-12 w-12" />
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate ltr:text-left rtl:text-right text-sm font-medium">{channel.name}</span>
        <span className="block truncate text-xs text-muted">{program ?? channel.group}</span>
      </span>
      <span className="font-mono text-xs text-faint tabular">{channel.number}</span>
    </button>
  );
});
