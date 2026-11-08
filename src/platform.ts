import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { MoodeClient, Station } from './moode';

const PLUGIN_NAME = 'homebridge-moode-radio';
const PLATFORM_NAME = 'MoodeRadio';
const OFF_ID = '__radio_off__';

interface StationConfig {
  name?: string;
  label?: string;
}

interface Entry {
  accessory: PlatformAccessory;
  service: Service;
  /** moOde station name; undefined for the stop switch. */
  moodeName?: string;
}

export class MoodeRadioPlatform implements DynamicPlatformPlugin {
  private readonly client: MoodeClient;
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly entries = new Map<string, Entry>();
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
    this.cached.set(accessory.UUID, accessory);
  }

  private async start(): Promise<void> {
    const wanted = new Set<string>();

    const stations = (this.config.stations ?? []) as StationConfig[];
    for (const s of stations) {
      const moodeName = s.name?.trim();
      if (!moodeName) {
        continue;
      }
      const id = `station:${moodeName}`;
      wanted.add(this.add(id, s.label?.trim() || moodeName, moodeName));
    }
    if (this.config.offSwitch !== false) {
      const label = String(this.config.offSwitchName ?? 'Radio Off');
      wanted.add(this.add(OFF_ID, label));
    }

    for (const [uuid, accessory] of this.cached) {
      if (!wanted.has(uuid)) {
        this.log.info(`Removing "${accessory.displayName}" (no longer in the config)`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    await this.refreshStations();
    await this.sync();
    const seconds = Math.max(5, Number(this.config.pollSeconds ?? 20));
    this.timer = setInterval(() => void this.sync(), seconds * 1000);
  }

  /** Creates or restores one switch and returns its UUID. */
  private add(id: string, label: string, moodeName?: string): string {
    const { hap } = this.api;
    const uuid = hap.uuid.generate(`${PLUGIN_NAME}:${id}`);
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
      .setCharacteristic(hap.Characteristic.Model, moodeName ? 'moOde radio station' : 'moOde stop')
      .setCharacteristic(hap.Characteristic.SerialNumber, id);

    const service =
      accessory.getService(hap.Service.Switch) ?? accessory.addService(hap.Service.Switch, label);
    service.setCharacteristic(hap.Characteristic.Name, label);
    service
      .getCharacteristic(hap.Characteristic.On)
      .onGet(() => service.getCharacteristic(hap.Characteristic.On).value ?? false)
      .onSet((value) => this.handleSet(uuid, Boolean(value)));

    this.entries.set(uuid, { accessory, service, moodeName });
    return uuid;
  }

  private async handleSet(uuid: string, on: boolean): Promise<void> {
    const entry = this.entries.get(uuid);
    if (!entry) {
      return;
    }
    const { HapStatusError, HAPStatus } = this.api.hap;
    try {
      if (!entry.moodeName) {
        // Stop switch: stop playback, then fall back to off like a push button.
        if (on) {
          this.log.info('Stopping playback');
          await this.client.stop();
          this.setOnly(undefined);
        }
        return;
      }
      if (on) {
        this.log.info(`Playing "${entry.moodeName}"`);
        await this.client.play(entry.moodeName);
        this.setOnly(uuid);
      } else {
        // Turning the playing station off stops the music.
        this.log.info(`Stopping "${entry.moodeName}"`);
        await this.client.stop();
      }
    } catch (err) {
      this.log.error(`moOde request failed: ${(err as Error).message}`);
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /** Marks exactly one station switch on (or none), and the stop switch off. */
  private setOnly(activeUuid: string | undefined): void {
    const { Characteristic } = this.api.hap;
    for (const [uuid, e] of this.entries) {
      e.service.updateCharacteristic(Characteristic.On, uuid === activeUuid);
    }
  }

  private async refreshStations(): Promise<void> {
    try {
      this.known = await this.client.stations();
      const names = new Set(this.known.map((s) => s.name));
      for (const e of this.entries.values()) {
        if (e.moodeName && !names.has(e.moodeName)) {
          this.log.warn(`"${e.moodeName}" is not in moOde's radio list; check the spelling`);
        }
      }
    } catch (err) {
      this.log.warn(`Could not read moOde's station list: ${(err as Error).message}`);
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
