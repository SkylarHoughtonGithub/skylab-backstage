import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import kubernetesPlugin from '@backstage/plugin-kubernetes/alpha';
import argoCdPlugin from '@roadiehq/backstage-plugin-argo-cd/alpha';
import grafanaPlugin from '@backstage-community/plugin-grafana/alpha';
import authPlugin from '@backstage/plugin-auth';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';

export default createApp({
  features: [
    catalogPlugin,
    kubernetesPlugin,
    argoCdPlugin,
    grafanaPlugin,
    authPlugin,
    navModule,
    homeModule,
  ],
});
