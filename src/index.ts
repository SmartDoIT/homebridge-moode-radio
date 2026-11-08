import type { API } from 'homebridge';
import { MoodeRadioPlatform } from './platform';

export default (api: API): void => {
  api.registerPlatform('MoodeRadio', MoodeRadioPlatform);
};
