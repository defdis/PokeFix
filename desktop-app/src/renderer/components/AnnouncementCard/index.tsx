import {Icon} from '@iconify/react';
import {PREVIEW_LAYOUTS} from 'common/constants';
import {useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {selectLayout} from 'renderer/store/features/renderer';
import {selectAnnouncements, selectIsPresenting, setWhatsNewSeen} from 'renderer/store/features/ui';

/** "2.0.0" → "2.0" for the card title. */
const shortVersion = (version: string) => version.split('.').slice(0, 2).join('.');

const WHATS_NEW_ROWS: Array<{icon: string; label: string}> = [
  {icon: 'lucide:plug-zap', label: 'MCP server — connect Claude, Codex & more'},
  {icon: 'lucide:presentation', label: 'Canvas mode for presentations & recordings'},
];

/**
 * Launch card (Hybrid Studio design): floats above the status bar, bottom
 * right. Shows "What's new" once per release. Never during Present mode.
 */
const AnnouncementCard = () => {
  const dispatch = useDispatch();
  const announcements = useSelector(selectAnnouncements);
  const layout = useSelector(selectLayout);
  const isPresenting = useSelector(selectIsPresenting);
  const {appVersion} = window.responsively;

  // Decided once at mount so dismissals elsewhere (e.g. opening the bell)
  // don't yank a card the user is looking at.
  const [variant] = useState<'whats-new' | null>(() =>
    announcements.seenVersion !== appVersion ? 'whats-new' : null
  );
  const [open, setOpen] = useState<boolean>(true);

  if (variant === null || !open || (isPresenting && layout === PREVIEW_LAYOUTS.CANVAS)) {
    return null;
  }

  const dismiss = () => {
    dispatch(setWhatsNewSeen(appVersion));
    setOpen(false);
  };

  const seeUpdates = () => {
    dismiss();
    // The bell popover's open state lives inside Headless UI; its trigger
    // button is the one supported way in.
    document.querySelector<HTMLButtonElement>('button[title="Notifications"]')?.click();
  };

  return (
    <div
      data-testid="announcement-card"
      className="fixed right-[14px] bottom-[52px] z-40 w-[308px] rounded-xl border border-line bg-panel p-[14px] text-fg shadow-elevated"
    >
      <div className="flex items-center gap-[9px]">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon icon="lucide:megaphone" fontSize={15} />
        </span>
        <span className="text-[13.5px] font-bold">
          {`What's new in ${shortVersion(appVersion)}`}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          title="Dismiss"
          onClick={dismiss}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[14px] text-muted transition-colors hover:bg-hover hover:text-fg focus:outline-none"
        >
          <span className="pointer-events-none contents">
            <Icon icon="ic:round-close" />
          </span>
        </button>
      </div>
      <>
        <div className="mt-[10px] mb-3 flex flex-col gap-[5px]">
          {WHATS_NEW_ROWS.map((row) => (
            <div key={row.label} className="flex gap-[7px] text-[12px] text-fg">
              <Icon icon={row.icon} fontSize={13} className="mt-px shrink-0 text-accent" />
              {row.label}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={seeUpdates}
            className="h-7 rounded-[7px] bg-accent px-3 text-[11.5px] font-bold text-on-accent transition-[filter] hover:brightness-110 focus:outline-none"
          >
            <span className="pointer-events-none contents">See all updates</span>
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="h-7 rounded-[7px] px-[10px] text-[11.5px] text-muted transition-colors hover:bg-hover hover:text-fg focus:outline-none"
          >
            <span className="pointer-events-none contents">Later</span>
          </button>
        </div>
      </>
    </div>
  );
};

export default AnnouncementCard;
