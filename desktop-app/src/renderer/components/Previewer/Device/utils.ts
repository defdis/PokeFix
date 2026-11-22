import {getHistory, setHistory} from 'renderer/lib/historyCache';

export const appendHistory = (url: string, title: string) => {
  if (url === `${title}/`) {
    return;
  }
  setHistory(
    [
      {url, title, lastVisited: new Date().getTime()},
      ...getHistory().filter(({url: _url}) => url !== _url),
    ].slice(0, 100)
  );
};
