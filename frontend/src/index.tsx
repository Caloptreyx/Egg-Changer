import type { FC, ReactNode } from 'react';
import { faEgg } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Extension, ExtensionContext } from 'shared';
import EggChangerContainer from './components/EggChangerContainer.tsx';
import AdminEggChangerPage from './pages/AdminEggChangerPage.tsx';

class DevCaloptreyxEggChangerExtension extends Extension {
  public cardConfigurationPage: FC | null = AdminEggChangerPage;
  public cardIcon: ReactNode = <FontAwesomeIcon icon={faEgg} />;

  public initialize(ctx: ExtensionContext): void {
    ctx.extensionRegistry.pages.server.settings.settingContainers.appendComponent(EggChangerContainer);

    ctx.extensionRegistry.enterPermissionIcons((icons) =>
      icons.addServerPermissionIcon('eggchanger', <FontAwesomeIcon icon={faEgg} />),
    );
  }
}

export default new DevCaloptreyxEggChangerExtension();
