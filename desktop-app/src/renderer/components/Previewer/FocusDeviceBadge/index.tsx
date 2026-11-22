import type React from 'react';
import {useDispatch} from 'react-redux';
import {Icon} from '@iconify/react';
import cx from 'classnames';
import {setLayout} from 'renderer/store/features/renderer';
import {PREVIEW_LAYOUTS} from 'common/constants';
import {Device as IDevice} from 'common/deviceList';

/**
 * Focus-mode HUD: the single centered pill that replaces the old tab strip.
 * Shows which device is focused and steps through the active devices.
 * Deliberately quiet — one accent, no decoration: icon chip, name, mono
 * dimensions, position dots, prev/next. Pure CSS motion, reduced-motion safe.
 */

const DEVICE_ICON: Record<string, string> = {
  phone: 'lucide:smartphone',
  tablet: 'lucide:tablet',
  notebook: 'lucide:laptop',
  desktop: 'lucide:monitor',
};

interface Props {
  devices: IDevice[];
  individualDevice: IDevice;
  setIndividualDevice: (device: IDevice) => void;
}

const FocusDeviceBadge = ({devices, individualDevice, setIndividualDevice}: Props) => {
  const dispatch = useDispatch();
  const index = Math.max(
    0,
    devices.findIndex((device) => device.id === individualDevice.id)
  );
  const count = devices.length;
  const cycle = (delta: number) => {
    if (count < 2) {
      return;
    }
    const next = devices[(index + delta + count) % count];
    setIndividualDevice(next);
  };

  const onArrowKeys = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      cycle(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      cycle(1);
    }
  };

  const icon = DEVICE_ICON[individualDevice.type] ?? 'lucide:monitor';

  return (
    <div className="flex h-12 shrink-0 items-center justify-center">
      <div
        role="group"
        aria-label="Focused device"
        className="flex h-9 items-center gap-2 rounded-full border border-line bg-panel/80 py-1 pr-1.5 pl-1 shadow-elevated backdrop-blur-md transition-[border-color] duration-200 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/30 hover:border-accent/35"
      >
        <span
          key={individualDevice.id}
          className="flex items-center gap-2 motion-safe:animate-[badge-in_.26s_ease-out]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent">
            <Icon icon={icon} fontSize={14} />
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-fg">
              {individualDevice.name}
            </span>
            <span className="font-mono text-[10px] tracking-tight text-muted tabular-nums">
              {individualDevice.width}×{individualDevice.height}
            </span>
          </span>
        </span>

        {count > 1 && (
          <>
            <span className="ml-1 flex h-4 w-px bg-line" aria-hidden="true" />
            <span className="flex items-center gap-[5px]" aria-hidden="true">
              {devices.map((device, i) => (
                <span
                  key={device.id}
                  className={cx(
                    'h-[5px] rounded-full transition-all duration-200',
                    i === index ? 'w-3 bg-accent' : 'w-[5px] bg-line'
                  )}
                />
              ))}
            </span>
            <button
              type="button"
              aria-label="Previous device"
              onKeyDown={onArrowKeys}
              onClick={() => cycle(-1)}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <Icon icon="lucide:chevron-left" fontSize={14} />
            </button>
            <button
              type="button"
              aria-label="Next device"
              onKeyDown={onArrowKeys}
              onClick={() => cycle(1)}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <Icon icon="lucide:chevron-right" fontSize={14} />
            </button>
          </>
        )}
        <span className="ml-0.5 h-4 w-px bg-line" aria-hidden="true" />
        <button
          type="button"
          aria-label="Exit focus mode"
          title="Exit focus"
          onClick={() => dispatch(setLayout(PREVIEW_LAYOUTS.COLUMN))}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <Icon icon="lucide:x" fontSize={13} />
        </button>
      </div>
    </div>
  );
};

export default FocusDeviceBadge;
