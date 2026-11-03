# LoL Utils

A Windows companion for League of Legends.

## Features

- Import rune pages, summoner spells, and item builds into the League client.
- Get item suggestions that consider your champion and both teams.
- See skill-upgrade guidance and purchase suggestions (using `P`) during a match.
- Browse champions, items, runes, and skills with icons and hover details.

## Installation

Download the Windows `.exe` from the [latest release](https://github.com/Zenoo/lol-utils/releases/latest) and run it. No installer or Node.js is needed. If no release is available yet, use the local setup below.

## Local setup

Install [Node.js 24](https://nodejs.org/), download or clone this project, and open a terminal in its folder:

```sh
npm ci
npm start
```

## Development commands

```sh
npm start                # Build and launch the app
npm run check            # Run all code, data, test, and performance checks
npm test                 # Run regression tests
npm run smoke            # Check the desktop UI
npm run format           # Format the project
npm run lint             # Check code style
npm run typecheck        # Check TypeScript
npm run data:update      # Download updated game data
npm run build            # Compile the app
npm run pack             # Build an unpacked Windows app
npm run dist             # Build a portable Windows executable
npm run smoke:package    # Test the built executable
```

Releases are managed by Release Please through version and changelog pull requests.

See the docs for [usage and limitations](docs/usage.md), [development](docs/development.md), [releasing](docs/releases.md), [recommendations](docs/recommendations.md), and [testing](docs/testing.md).
