import ServerContentContainer from '@/elements/containers/ServerContentContainer.tsx';
import EggChanger from '../components/EggChanger.tsx';

/** The sidebar page of the `page` and `both` placements. */
export default function EggChangerPage() {
  return (
    <ServerContentContainer title='Change Egg'>
      <EggChanger variant='page' />
    </ServerContentContainer>
  );
}
