# homebridge-moode-radio

Homebridge plugin that turns your favourite radio stations on a [moOde audio player](https://moodeaudio.org) into HomeKit switches, so Siri (for example on a HomePod) can play them. It adds **one accessory**, "moOde Radio", and the stations are switches inside it, so your Home app isn't filled with separate entries:

> "Hey Siri, turn on Swiss Jazz"

- **Follows moOde's favourites.** Every station marked as a favourite in moOde's radio list becomes a switch inside the one accessory. Add or remove a favourite in moOde and the plugin picks it up, so there is no list to maintain in Homebridge.
- Only one station is on at a time: turning one on turns the others off.
- Turning the playing station's switch off stops the music. There is no separate stop switch.
- The favourites list is read from moOde each time Homebridge starts (restart Homebridge, or the plugin's child bridge, after changing favourites in moOde). There is no timer and no refresh switch.
- Switches follow what moOde is really playing (checked every 20 seconds), so changes made in moOde itself show up in Home.
- If moOde is switched off, the existing switches stay; nothing is removed because of a failed scan.
- Nothing is installed on moOde and no login is needed: the plugin uses moOde's web command API (the same call as clicking a station in moOde's radio list, "clear and play") and MPD on port 6600.

## Install

In Homebridge UI, search for **moOde Radio** under Plugins and install it, or on the Homebridge machine:

```
sudo npm install -g homebridge-moode-radio
```

Restart Homebridge, then add the platform in the config or through the plugin settings in Homebridge UI.

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

Names in Home are cleaned for HomeKit (`FluxFM - 80s` becomes `FluxFM 80s`). In the Home app the switches sit inside the one "moOde Radio" tile; press and hold it, or open its settings and turn on "Show as Separate Tiles", to see them as individual tiles. An accessory can hold at most 90 stations. Playing a station empties moOde's play queue and puts only that station in it. HomeKit allows about 150 accessories per bridge; with more favourites than that, run the plugin as a child bridge.

## Develop

```
npm install
npm run build
npm test
```

Needs Node 20, 22 or 24.

## Releasing

1. Update `CHANGELOG.md` and bump the version: `npm version patch` (or `minor` / `major`). This commits and creates a tag `vX.Y.Z`.
2. Push: `git push && git push --tags`.
3. On GitHub, create a release from that tag. Publishing the release starts the **Publish to npm** workflow, which builds, tests and publishes the package to npm. The workflow refuses to publish if the tag and `package.json` version differ.

The workflow uses npm trusted publishing, so no npm token is stored in the repository. Setup (once, on npmjs.com): the package's Settings, Trusted Publisher, GitHub Actions, organisation `SmartDoIT`, repository `homebridge-moode-radio`, workflow `release.yml`. The very first version has to be published by hand, because the setting only exists once the package does.

## License

MIT
