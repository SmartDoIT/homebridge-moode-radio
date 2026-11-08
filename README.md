# homebridge-moode-radio

Homebridge plugin that turns your favourite radio stations on a [moOde audio player](https://moodeaudio.org) into HomeKit switches, so Siri (for example on a HomePod) can play them:

> "Hey Siri, turn on Swiss Jazz"

- One switch per favourite station, listed in the plugin config.
- Only one station is on at a time: turning one on turns the others off.
- Optional **Radio Off** switch that stops playback.
- Switches follow what moOde is really playing (checked every 20 seconds), so changes made in moOde itself show up in Home.
- Nothing is installed on moOde and no login is needed: the plugin uses moOde's web command API (the same call as clicking a station in moOde's radio list, "clear and play") and MPD on port 6600.

## Install

Not on npm yet. On the Homebridge machine:

```
sudo npm install -g github:SmartDoIT/homebridge-moode-radio
```

(The repository is private for now; the machine needs read access to it.) Restart Homebridge, then add the platform in the config or through the plugin settings in Homebridge UI.

## Config

```json
{
  "platform": "MoodeRadio",
  "name": "moOde Radio",
  "host": "moode.local",
  "stations": [
    { "name": "Radio Swiss Jazz", "label": "Swiss Jazz" },
    { "name": "Naxi Ex-YU Rock" },
    { "name": "Dasko i Mladja", "label": "Dasko i Mladja" }
  ]
}
```

| Option | Default | Meaning |
|---|---|---|
| `host` | `moode.local` | moOde's host name or IP address |
| `mpdPort` | `6600` | MPD port |
| `pollSeconds` | `20` | how often switches are synced with moOde (minimum 5) |
| `offSwitch` | `true` | add a stop switch |
| `offSwitchName` | `Radio Off` | its name in Home |
| `stations[].name` | | station name exactly as in moOde's radio list |
| `stations[].label` | same as `name` | name in Home and for Siri; keep it short |

Playing a station empties moOde's play queue and puts only that station in it.

## Develop

```
npm install
npm run build
npm test
```

Needs Node 20, 22 or 24.
