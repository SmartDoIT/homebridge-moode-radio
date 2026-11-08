# homebridge-moode-radio

Homebridge plugin that turns your favourite radio stations on a [moOde audio player](https://moodeaudio.org) into HomeKit switches, so Siri (for example on a HomePod) can play them:

> "Hey Siri, turn on Swiss Jazz"

- **Follows moOde's favourites.** Every station marked as a favourite in moOde's radio list becomes a switch. Add or remove a favourite in moOde and the plugin picks it up, so there is no list to maintain in Homebridge.
- Only one station is on at a time: turning one on turns the others off.
- Turning the playing station's switch off stops the music. There is no separate stop switch.
- The favourites list is read from moOde each time Homebridge starts (restart Homebridge, or the plugin's child bridge, after changing favourites in moOde). There is no timer and no refresh switch.
- Switches follow what moOde is really playing (checked every 20 seconds), so changes made in moOde itself show up in Home.
- If moOde is switched off, the existing switches stay; nothing is removed because of a failed scan.
- Nothing is installed on moOde and no login is needed: the plugin uses moOde's web command API (the same call as clicking a station in moOde's radio list, "clear and play") and MPD on port 6600.

## Install

Not on npm yet. On the Homebridge machine:

```
sudo npm install -g github:SmartDoIT/homebridge-moode-radio
```

(The repository is private for now; the machine needs read access to it.) Restart Homebridge, then add the platform in the config or through the plugin settings in Homebridge UI.

## Config

The minimum:

```json
{ "platform": "MoodeRadio", "name": "moOde Radio", "host": "moode.local" }
```

| Option | Default | Meaning |
|---|---|---|
| `host` | `moode.local` | moOde's host name or IP address |
| `mpdPort` | `6600` | MPD port |
| `includeFavorites` | `true` | a switch for every favourite in moOde's radio list |
| `pollSeconds` | `20` | how often switches are synced with moOde (minimum 5) |
| `stations` | none | extra stations that are not favourites in moOde, or a shorter name for Siri |

`stations` entries look like `{ "name": "Radio Swiss Jazz", "label": "Swiss Jazz" }`: `name` is exactly as in moOde's radio list, `label` is the name in Home.

Names in Home are cleaned for HomeKit (`FluxFM - 80s` becomes `FluxFM 80s`). Playing a station empties moOde's play queue and puts only that station in it. HomeKit allows about 150 accessories per bridge; with more favourites than that, run the plugin as a child bridge.

## Develop

```
npm install
npm run build
npm test
```

Needs Node 20, 22 or 24.
