import {Icon} from '@iconify/react';
import {useSelector} from 'react-redux';
import {IPC_MAIN_CHANNELS, Notification as NotificationType} from 'common/constants';
import {selectNotifications} from 'renderer/store/features/renderer';

/** Release highlights shown in the bell panel (Hybrid Studio design). */
const WHATS_NEW: Array<{icon: string; title: string; body: string; when: string}> = [
  {
    icon: 'lucide:plug-zap',
    title: 'MCP integration',
    body: 'Add the local MCP server to Claude, Codex, Cursor or VS Code in one click.',
    when: '2.0',
  },
  {
    icon: 'lucide:presentation',
    title: 'Canvas mode',
    body: 'Free-arrange devices, add frames, hit Present for clean recordings.',
    when: '2.0',
  },
];

const Row = ({
  icon,
  title,
  body,
  when,
  link,
  linkText,
}: {
  icon: string;
  title: string;
  body: string;
  when?: string;
  link?: string;
  linkText?: string;
}) => (
  <div className="flex gap-2 border-t border-line-soft py-[6px]">
    <Icon icon={icon} fontSize={14} className="mt-px shrink-0 text-accent" />
    <div className="min-w-0">
      <div className="text-[12px] font-bold">{title}</div>
      <div className="text-[11.5px] leading-[1.45] text-muted">{body}</div>
      {link !== undefined && linkText !== undefined ? (
        <button
          type="button"
          onClick={() =>
            window.electron.ipcRenderer.sendMessage(IPC_MAIN_CHANNELS.OPEN_EXTERNAL, {url: link})
          }
          className="mt-1 text-[11.5px] font-bold text-accent hover:underline focus:outline-none"
        >
          {linkText}
        </button>
      ) : null}
    </div>
    {when !== undefined ? (
      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">{when}</span>
    ) : null}
  </div>
);

/** Bell panel: live notifications, release highlights and the sponsor strip. */
const Notifications = () => {
  const notifications = useSelector(selectNotifications);

  return (
    <div>
      <div className="mb-[6px] text-[12.5px] font-bold">Notifications</div>
      {(notifications ?? []).map((notification: NotificationType) => (
        <Row
          key={notification.id}
          icon="carbon:notification"
          title={notification.text}
          body=""
          link={notification.link}
          linkText={notification.linkText}
        />
      ))}
      {WHATS_NEW.map((item) => (
        <Row key={item.title} {...item} />
      ))}
    </div>
  );
};

export default Notifications;
