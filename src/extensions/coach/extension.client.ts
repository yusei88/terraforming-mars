// Strategy coach in the browser: a menu entry that opens the coach panel, and the panel itself.
import {ClientExtension} from '@/client/extensions/ClientExtension';
import CoachPanel from './client/CoachPanel.vue';
import CoachIcon from './client/CoachIcon.vue';
import {coachPanelState} from './client/coachPanelState';

export const extension: ClientExtension = {
  name: 'coach',
  component: CoachPanel,
  menuItems: [
    {label: 'Strategy coach', icon: CoachIcon, select: () => coachPanelState.open = true},
  ],
};
