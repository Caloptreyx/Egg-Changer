import type { FC } from 'react';
import { faEgg } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Extension, ExtensionContext } from 'shared';
import type { IconLike } from '@/elements/data-display/Icon.tsx';
import EggChanger from './components/EggChanger.tsx';
import { placementShells } from './lib/placement.ts';
import AdminEggChangerPage from './pages/AdminEggChangerPage.tsx';
import EggChangerPage from './pages/EggChangerPage.tsx';

function EggChangerSettingsSection() {
  return <EggChanger variant='section' />;
}

class DevCaloptreyxEggChangerExtension extends Extension {
  public cardConfigurationPage: FC | null = AdminEggChangerPage;
  public cardIcon: IconLike | null = faEgg;

  public initialize(ctx: ExtensionContext): void {
    // The backend renders the placement into index.html, so it is known before the sidebar is
    // built. A changed setting applies after the next page load.
    const shells = placementShells(this.getIndexVariable('placement'));

    if (shells.settings) {
      ctx.extensionRegistry.pages.server.settings.settingContainers.appendComponent(EggChangerSettingsSection);
    }

    ctx.extensionRegistry.routes.addServerRoute({
      name: 'Change Egg',
      icon: faEgg,
      path: '/egg-changer',
      element: EggChangerPage,
      permission: 'eggchanger.change',
      filter: () => shells.page,
    });

    ctx.extensionRegistry.enterPermissionIcons((icons) =>
      icons.addServerPermissionIcon('eggchanger', <FontAwesomeIcon icon={faEgg} />),
    );
  }
}

export default new DevCaloptreyxEggChangerExtension();
