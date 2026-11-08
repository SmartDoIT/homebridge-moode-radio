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

interface StationConfig {
  name?: string;
  label?: string;
}

interface Entry {
  accessory: PlatformAccessory;
  service: Service;
  moodeName: string;
  label: string;
}

export class MoodeRadioPlatform implements DynamicPlatformPlugin {
  private readonly client: MoodeClient;
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly entries = new Map<string, Entry>();
  private known: Station[] = [];
  private timers: NodeJS.Timeout[] = [];

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
    api.on('shutdown', () => this.timers.forEach((t) => clearInterval(t)));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  private async start(): Promise<void> {
    await this.reconcile();
    await this.sync();

    const pollSeconds = Math.max(5, Number(this.config.pollSeconds ?? 20));
    this.timers.push(setInterval(() => void this.sync(), pollSeconds * 1000));
  }

  /**
   * Rescans moOde's radio list and makes the station switches match it: one per favourite
   * (plus any extra stations from the config). Runs once, when Homebridge starts. If moOde
   * can't be reached, the switches Homebridge already knows are kept.
   */
  private async reconcile(): Promise<void> {
    let stations: Station[];
    try {
      stations = await this.client.stations();
    } catch (err) {
      this.log.warn(`Could not read moOde's station list, keeping the current switches: ${(err as Error).message}`);
      // First start with moOde down: keep restoring the switches HomeKit already knows.
      if (this.known.length === 0) {
        this.restoreCachedStations();
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

    let added = 0;
    for (const [name, label] of wanted) {
      if (!this.entries.has(this.uuidFor(`station:${name}`))) {
        added++;
      }
      this.add(`station:${name}`, label, name);
    }

    let removed = 0;
    for (const [uuid, e] of [...this.entries]) {
      if (!wanted.has(e.moodeName)) {
        this.log.info(`Removing "${e.label}" (no longer a favourite in moOde)`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [e.accessory]);
        this.entries.delete(uuid);
        this.cached.delete(uuid);
        removed++;
      }
    }
    // Cached switches that were never restored this run (e.g. config changed while Homebridge was off).
    for (const [uuid, accessory] of [...this.cached]) {
      if (!this.entries.has(uuid)) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cached.delete(uuid);
      }
    }

    this.log.info(`moOde radio: ${wanted.size} station switches (${added} added, ${removed} removed)`);
  }

  private restoreCachedStations(): void {
    for (const accessory of this.cached.values()) {
      const id = accessory.getService(this.api.hap.Service.AccessoryInformation)
        ?.getCharacteristic(this.api.hap.Characteristic.SerialNumber).value;
      if (typeof id === 'string' && id.startsWith('station:')) {
        this.add(id, accessory.displayName, id.slice('station:'.length));
      }
    }
  }

  private uuidFor(id: string): string {
    return this.api.hap.uuid.generate(`${PLUGIN_NAME}:${id}`);
  }

  /** Creates or restores one switch and returns its UUID. */
  private add(id: string, label: string, moodeName: string): string {
    const { hap } = this.api;
    const uuid = this.uuidFor(id);
    const existing = this.entries.get(uuid);
    if (existing) {
      return uuid;
    }
    let accessory = this.cached.get(uuid);
    if (accessory) {
      accessory.displayName = label;
    } else {
      accessory = new this.api.platformAccessory(label, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
        accessory
      .getService(hap.Service.AccessoryInformation)!
      .setCharacteristic(hap.Characteristic.Manufacturer, 'SmartDoIT')
      .setCharacteristic(hap.Characteristic.Model, 'moOde radio station')
      .setCharacteristic(hap.Characteristic.SerialNumber, id);

    const service =
      accessory.getService(hap.Service.Switch) ?? accessory.addService(hap.Service.Switch, label);
    service.setCharacteristic(hap.Characteristic.Name, label);
    service
      .getCharacteristic(hap.Characteristic.On)
      .onGet(() => service.getCharacteristic(hap.Characteristic.On).value ?? false)
      .onSet((value) => this.handleSet(uuid, Boolean(value)));

    this.entries.set(uuid, { accessory, service, moodeName, label });
    this.cached.set(uuid, accessory);
    return uuid;
  }

  private async handleSet(uuid: string, on: boolean): Promise<void> {
    const entry = this.entries.get(uuid);
    if (!entry) {
      return;
    }
    const { HapStatusError, HAPStatus } = this.api.hap;
    try {
      if (on) {
        this.log.info(`Playing "${entry.moodeName}"`);
        await this.client.play(entry.moodeName);
        this.setOnly(uuid);
      } else {
        // Turning the playing station off stops the music, unless moOde is
        // already playing a different known station.
        const now = await this.client.nowPlaying();
        const playing = this.known.find((st) => st.station === now.file);
        if (now.state === 'play' && playing && playing.name !== entry.moodeName) {
          return;
        }
        this.log.info(`Stopping "${entry.moodeName}"`);
        await this.client.stop();
      }
    } catch (err) {
      this.log.error(`moOde request failed: ${(err as Error).message}`);
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /** Marks exactly one station switch on (or none). */
  private setOnly(activeUuid: string | undefined): void {
    const { Characteristic } = this.api.hap;
    for (const [uuid, e] of this.entries) {
      e.service.updateCharacteristic(Characteristic.On, uuid === activeUuid);
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
      const active = [...this.entries].find(([, e]) => e.moodeName === match.name)?.[0];
      this.setOnly(active);
    } catch (err) {
      this.log.debug(`Status check failed: ${(err as Error).message}`);
    }
  }
}
