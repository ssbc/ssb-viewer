# ssb-viewer

HTTP server for read-only views of SSB content. Serves content as web pages or as scripts for embedding in other web pages.

## Install & Run

As a sbot plugin:
```sh
mkdir -p ~/.ssb/node_modules
cd ~/.ssb/node_modules
git clone ssb://%MeCTQrz9uszf9EZoTnKCeFeIedhnKWuB3JHW2l1g9NA=.sha256 ssb-viewer && cd ssb-viewer
npm install
sbot plugins.enable ssb-viewer
# restart sbot
```

Or standalone:
```sh
git clone ssb://%MeCTQrz9uszf9EZoTnKCeFeIedhnKWuB3JHW2l1g9NA=.sha256 ssb-viewer && cd ssb-viewer
npm install
./bin.js
```

## Usage

To view a thread as a web page, navigate to a url like `http://localhost:8807/%MSGID`.

To embed a thread into another web page, load it as follows:

```html
<script src="http://localhost:8807/%MSGID.js"></script>
```

To add more than the base styles, you can also load `http://localhost:8807/static/nicer.css`.

## Routes

- `/%msgid`: web page showing a message thread
- `/%msgid.js`: script to embed a message thread
- `/%msgid.json`: message thread as JSON
- `/&feedid`: web page showing a complete feed
- `/user-feed/&feedid`: web page showing messages from followed users and channels of a feed
- `/channel/#channel`: web page showing messages in a specific channel

### Query options

- `noroot`: don't include the root message in the thread
- `base=...`: base url for links that ssb-viewer can handle
- `msg_base=...`: base url for links to messages
- `feed_base=...`: base url for links to feeds
- `blob_base=...`: base url for links to blobs
- `img_base=...`: base url for embedded blobs (images)
- `emoji_base=...`: base url for emoji images

The `*_base` query options overwrite the defaults set in the config.
The `base` option is a fallback instead of specifying the URLs separately.
The base options are mostly useful for embedding, where the script is embedded
on a different origin than where ssb-viewer is running. However, you may not
need them, as the ssb-viewer embed script will detect the base where it is
included from.

## Config

To change `ssb-viewer`'s default options, edit your `~/.ssb/config`, to have
properties like the following:
```json
{
  "viewer": {
    "port": 8807,
    "host": "::"
  }
}
```
You can also pass these as command-line options to `./bin.js` or `sbot` as,
e.g. `--viewer.port 8807`.

- `viewer.port`: port for the server to listen on. default: `8807`
- `viewer.host`: host address for the server to listen on. default: `::`
- `viewer.base`: default base url for links that ssb-viewer can handle
- `viewer.msg_base`: base url for links to ssb messages
- `viewer.feed_base`: base url for links to ssb feeds
- `viewer.blob_base`: base url for links to ssb blobs
- `viewer.img_base`: base url for embedded blobs (images)
- `viewer.emoji_base`: base url for emoji images

## References

- Concept: [ssb-porthole][]
- UI ideas: [sdash][], [patchbay][]
- Server techniques: [ssb-web-server][], [ssb-ws][], [git-ssb-web][]


[ssb-porthole]: %cgkDJXsh6pO5m458B3ngEro+U0qUMGTY1TRGTZOP6lQ=.sha256
[patchbay]: %s9mSFATE4RGyJx9wgH22lBrvD4CgUQW4yeguSWWjtqc=.sha256
[sdash]: %qrU04j9vfUJKfq1rGZrQ5ihtSfA4ilfY3wLy7xFv0xk=.sha256
[git-ssb-web]: %q5d5Du+9WkaSdjc8aJPZm+jMrqgo0tmfR+RcX5ZZ6H4=.sha256
[ssb-web-server]: %gYctTCrA06BhAGGvQ6PJ0H2eCCQLj1iEsmfn8SD5+nk=.sha256
[ssb-ws]: %tFjo5SoD+Y0SaB5vqZYppmoPmv9LKB5wMPl96qtu4qk=.sha256

## License

Copyright (c) 2016-2017 Secure Scuttlebutt Consortium

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
