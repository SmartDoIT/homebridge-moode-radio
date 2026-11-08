import * as net from 'node:net';

export interface Station {
  name: string;
  station: string;
}

export interface NowPlaying {
  state: string;
  file?: string;
}

/** Talks to a moOde player: its web command API for stations, MPD for status and stop. */
export class MoodeClient {
  constructor(
    private readonly host: string,
    private readonly mpdPort = 6600,
  ) {}

  async stations(): Promise<Station[]> {
    const res = await fetch(`http://${this.host}/command/radio.php?cmd=get_stations`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`moOde returned HTTP ${res.status} for the station list`);
    }
    const rows = (await res.json()) as Array<{ name: string; station: string }>;
    return rows.map((r) => ({ name: r.name, station: r.station }));
  }

  /** moOde's own "clear and play" for a radio station: empties the queue, adds the station, plays. */
  async play(stationName: string): Promise<void> {
    const res = await fetch(`http://${this.host}/command/queue.php?cmd=clear_play_item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ path: `RADIO/${stationName}.pls` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`moOde returned HTTP ${res.status} when playing "${stationName}"`);
    }
  }

  async stop(): Promise<void> {
    await this.mpd('stop');
  }

  async nowPlaying(): Promise<NowPlaying> {
    const status = parseMpd(await this.mpd('status'));
    const state = status.state ?? 'stop';
    if (state !== 'play') {
      return { state };
    }
    const song = parseMpd(await this.mpd('currentsong'));
    return { state, file: song.file };
  }

  /** Sends one MPD command and returns the raw response. */
  mpd(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.mpdPort });
      let data = '';
      socket.setTimeout(5_000, () => socket.destroy(new Error('MPD timed out')));
      socket.on('connect', () => socket.write(`${command}\nclose\n`));
      socket.on('data', (chunk) => (data += chunk.toString('utf8')));
      socket.on('error', reject);
      socket.on('close', () => {
        const err = /^ACK .*$/m.exec(data);
        if (err) {
          reject(new Error(`MPD: ${err[0]}`));
        } else {
          resolve(data);
        }
      });
    });
  }
}

/** Turns MPD "key: value" lines into an object. */
export function parseMpd(response: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of response.split('\n')) {
    const i = line.indexOf(': ');
    if (i > 0) {
      out[line.slice(0, i).toLowerCase()] = line.slice(i + 2);
    }
  }
  return out;
}
