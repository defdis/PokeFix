import {useSelector} from 'react-redux';
import {DndProvider} from 'react-dnd';
import {HTML5Backend} from 'react-dnd-html5-backend';
import {selectActiveSuite, selectSuites} from 'renderer/store/features/device-manager';
import {Suite} from './Suite';
import {CreateSuiteButton} from './CreateSuiteButton';

export const PreviewSuites = () => {
  const suites = useSelector(selectSuites);
  const activeSuite = useSelector(selectActiveSuite);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex flex-col">
        <div className="flex w-full items-center gap-4 overflow-x-auto">
          <div className="flex shrink-0 gap-4">
            {suites.map((suite) => (
              <Suite suite={suite} isActive={suite.id === activeSuite.id} key={suite.name} />
            ))}
          </div>
          <CreateSuiteButton />
        </div>
      </div>
    </DndProvider>
  );
};
