import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { MoodeClient, Station } from './moode';
import { homeName } from './names';

const PLUGIN_NAME = 'homebridge-moode-radio';
const PLATFORM_NAME = 'MoodeRadio';
const ACCESSORY_ID = 'moode-radio-accessory';
const SUBTYPE_PREFIX = 'station:';
/** HomeKit allows 100 services per accessory; two are taken by the accessory itself. */
const MAX_STATIONS = 90;

interface StationConfig {
  name?: string;
  label?: string;
}

/**
 * One HomeKit accessory ("moOde Radio") that holds one Switch service per radio station.
 * Turning a switch on plays that station on moOde; turning it off stops the music.
 */
export class MoodeRadioPlatform implements DynamicPlatformPlugin {
  private readonly client: MoodeClient;
  private accessory?: PlatformAccessory;
  /** Accessories from older versions (one accessory per station), removed at startup. */
  private readonly legacy: PlatformAccessory[] = [];
  /** moOde station name -> its switch. */
  private readonly switches = new Map<string, Service>();
  private known: Station[] = [];
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly log: Logging,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    this.client = new MoodeClient(
      String(config.host ?? 'moode.local'),
      Number(config.mpdPort ?? 6600),
    );
    api.on('didFinishLaunching', () => void this.start());
    api.on('shutdown', () => this.timer && clearInterval(this.timer));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    if (accessory.UUID === this.api.hap.uuid.generate(`${PLUGIN_NAME}:${ACCESSORY_ID}`)) {
      this.accessory = accessory;
    } else {
      this.legacy.push(accessory);
    }
  }

  private async start(): Promise<void> {
    const { hap } = this.api;

    if (this.legacy.length > 0) {
      this.log.info(`Removing ${this.legacy.length} accessories from an older version`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.legacy);
    }

    const label = homeName(String(this.config.name ?? 'moOde Radio'));
    if (!this.accessory) {
      this.accessory = new this.api.platformAccessory(
        label,
        hap.uuid.generate(`${PLUGIN_NAME}:${ACCESSORY_ID}`),
      );
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessory]);
    }
    this.accessory.displayName = label;
    this.accessory
      .getService(hap.Service.AccessoryInformation)!
      .setCharacteristic(hap.Characteristic.Manufacturer, 'SmartDoIT')
      .setCharacteristic(hap.Characteristic.Model, 'moOde radio')
      .setCharacteristic(hap.Characteristic.SerialNumber, ACCESSORY_ID);

    await this.reconcile();
    await this.sync();
    const pollSeconds = Math.max(5, Number(this.config.pollSeconds ?? 20));
    this.timer = setInterval(() => void this.sync(), pollSeconds * 1000);
  }

  /**
   * Reads moOde's radio list and makes the switches match it: one per favourite (plus any
   * extra stations from the config). Runs once, when Homebridge starts. If moOde can't be
   * reached, the switches Homebridge already knows are kept.
   */
  private async reconcile(): Promise<void> {
    const accessory = this.accessory!;
    let stations: Station[];
    try {
      stations = await this.client.stations();
    } catch (err) {
      this.log.warn(`Could not read moOde's station list, keeping the current switches: ${(err as Error).message}`);
      for (const service of accessory.services) {
        if (service.subtype?.startsWith(SUBTYPE_PREFIX)) {
          this.bind(service, service.subtype.slice(SUBTYPE_PREFIX.length));
        }
      }
      return;
    }
    this.known = stations;

    const wanted = new Map<string, string>(); // moOde name -> label in Home
    if (this.config.includeFavorites !== false) {
      for (const s of stations.filter((s) => s.favorite)) {
        wanted.set(s.name, homeName(s.name));
      }
    }
    for (const extra of (this.config.stations ?? []) as StationConfig[]) {
      const name = extra.name?.trim();
      if (!name) {
        continue;
      }
      if (!stations.some((s) => s.name === name)) {
        this.log.warn(`"${name}" is not in moOde's radio list; check the spelling`);
      }
      wanted.set(name, homeName(extra.label?.trim() || name));
    }
    if (wanted.size > MAX_STATIONS) {
      this.log.warn(`${wanted.size} stations is more than HomeKit allows in one accessory; using the first ${MAX_STATIONS}`);
      for (const name of [...wanted.keys()].slice(MAX_STATIONS)) {
        wanted.delete(name);
      }
    }

    const { hap } = this.api;
    let added = 0;
    let removed = 0;
    for (const service of [...accessory.services]) {
      if (service.subtype?.startsWith(SUBTYPE_PREFIX)) {
        const name = service.subtype.slice(SUBTYPE_PREFIX.length);
        if (!wanted.has(name)) {
          this.log.info(`Removing "${name}" (no longer a favourite in moOde)`);
          accessory.removeService(service);
          removed++;
        }
      }
    }
    for (const [name, label] of wanted) {
      const subtype = SUBTYPE_PREFIX + name;
      let service = accessory.getServiceById(hap.Service.Switch, subtype);
      if (!service) {
        service = accessory.addService(hap.Service.Switch, label, subtype);
        added++;
      }
      service.setCharacteristic(hap.Characteristic.Name, label);
      service.addOptionalCharacteristic(hap.Characteristic.ConfiguredName);
      service.setCharacteristic(hap.Characteristic.ConfiguredName, label);
      this.bind(service, name);
    }
    this.api.updatePlatformAccessories([accessory]);
    this.log.info(`moOde radio: ${wanted.size} station switches (${added} added, ${removed} removed)`);
  }

  private bind(service: Service, moodeName: string): void {
    const { Characteristic } = this.api.hap;
    this.switches.set(moodeName, service);
    service
      .getCharacteristic(Characteristic.On)
      .onGet(() => service.getCharacteristic(Characteristic.On).value ?? false)
      .onSet((value) => this.handleSet(moodeName, Boolean(value)));
  }

  private async handleSet(moodeName: string, on: boolean): Promise<void> {
    const { HapStatusError, HAPStatus } = this.api.hap;
    try {
      if (on) {
        this.log.info(`Playing "${moodeName}"`);
        await this.client.play(moodeName);
        this.setOnly(moodeName);
      } else {
        // Turning the playing station off stops the music, unless moOde is
        // already playing a different known station.
        const now = await this.client.nowPlaying();
        const playing = this.known.find((st) => st.station === now.file);
        if (now.state === 'play' && playing && playing.name !== moodeName) {
          return;
        }
        this.log.info(`Stopping "${moodeName}"`);
        await this.client.stop();
      }
    } catch (err) {
      this.log.error(`moOde request failed: ${(err as Error).message}`);
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /** Marks exactly one station switch on (or none). */
  private setOnly(active: string | undefined): void {
    const { Characteristic } = this.api.hap;
    for (const [name, service] of this.switches) {
      service.updateCharacteristic(Characteristic.On, name === active);
    }
  }

  /** Brings the switches in line with what moOde is really playing. */
  private async sync(): Promise<void> {
    try {
      const now = await this.client.nowPlaying();
      if (now.state !== 'play') {
        this.setOnly(undefined);
        return;
      }
      const match = this.known.find((s) => s.station === now.file);
      if (!match) {
        return; // playing something we can't identify: leave the switches as they are
      }
      this.setOnly(match.name);
    } catch (err) {
      this.log.debug(`Status check failed: ${(err as Error).message}`);
    }
  }
}
