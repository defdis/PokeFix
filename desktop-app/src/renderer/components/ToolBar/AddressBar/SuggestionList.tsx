import {useCallback, useEffect, useMemo, useState} from 'react';
import cx from 'classnames';
import {Icon} from '@iconify/react';
import {getHistory, type HistoryEntry as HistoryItem} from 'renderer/lib/historyCache';

interface Props {
  match: string;
  onEnter: (url?: string) => void;
}

const SuggestionList = ({match, onEnter}: Props) => {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [history] = useState<HistoryItem[]>(getHistory);

  const lowered = useMemo(
    () => history.map((item) => ({item, hay: `${item.title}-${item.url}`.toLowerCase()})),
    [history]
  );
  const needle = match.toLowerCase();
  const suggestions = useMemo(
    () =>
      lowered
        .filter(({hay}) => hay.includes(needle))
        .slice(0, 10)
        .map(({item}) => item),
    [lowered, needle]
  );

  const keyDownHandler = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        onEnter(suggestions[activeIndex] != null ? suggestions[activeIndex].url : undefined);
        return;
      }
      if (e.key === 'ArrowUp') {
        if (activeIndex === 0) {
          return;
        }
        setActiveIndex(activeIndex - 1);
      }
      if (e.key === 'ArrowDown') {
        if (activeIndex === suggestions.length - 1) {
          return;
        }
        setActiveIndex(activeIndex + 1);
      }
    },
    [activeIndex, suggestions, onEnter]
  );

  useEffect(() => {
    document.addEventListener('keydown', keyDownHandler);
    return () => {
      document.removeEventListener('keydown', keyDownHandler);
    };
  }, [keyDownHandler]);

  return (
    <div className="absolute z-20 flex w-full flex-col items-start rounded-b-lg bg-white pb-2 shadow-lg dark:bg-slate-900">
      {suggestions.map(({title, url}, idx) => (
        <button
          onPointerDown={() => {
            // A classic click here can lose the race with the address input's
            // blur: the list unmounts ~100 ms after focus leaves the input and
            // a slow mouse-up never delivers the click. Pointer-down is
            // delivered regardless of blur order.
            onEnter(url);
          }}
          className={cx(
            'pointer-events-auto flex w-full items-center gap-2 py-1 pr-8 pl-2 hover:bg-slate-200 dark:hover:bg-slate-700',
            {'bg-slate-200 dark:bg-slate-700': activeIndex === idx}
          )}
          type="button"
          key={url}
        >
          <span className="flex h-4 w-4 items-center justify-center">
            {/* No network favicons (leaks typed URLs to Google, blocks paint): use a local glyph. */}
            <Icon icon="mdi:web" fontSize={16} className="text-slate-400" />
          </span>
          <span className="flex flex-row gap-1 overflow-hidden">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{title}</span>-
            <span className="max-w-2/5 overflow-hidden text-ellipsis whitespace-nowrap text-blue-500">
              {url}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};

export default SuggestionList;
