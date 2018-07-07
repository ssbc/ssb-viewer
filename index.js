var fs = require('fs')
var http = require('http')
var qs = require('querystring')
var path = require('path')
var crypto = require('crypto')
var pull = require('pull-stream')
var paramap = require('pull-paramap')
var sort = require('ssb-sort')
var toPull = require('stream-to-pull-stream')
var memo = require('asyncmemo')
var lru = require('lrucache')
var webresolve = require('ssb-web-resolver')
var serveEmoji = require('emoji-server')()
var {
  MdRenderer,
  renderEmoji,
  formatMsgs,
  wrapPage,
  renderThread,
  renderAbout,
  renderShowAll,
  renderRssItem,
  wrapRss,
} = require('./render');

var appHash = hash([fs.readFileSync(__filename)])

var urlIdRegex = /^(?:\/(([%&@]|%25|%26|%40)(?:[A-Za-z0-9\/+]|%2[Ff]|%2[Bb]){43}(?:=|%3[Dd])\.(?:sha256|ed25519))(?:\.([^?]*))?|(\/.*?))(?:\?(.*))?$/

function hash(arr) {
  return arr.reduce(function (hash, item) {
    return hash.update(String(item))
  }, crypto.createHash('sha256')).digest('base64')
}

exports.name = 'viewer'
exports.manifest = {}
exports.version = require('./package').version

exports.init = function (sbot, config) {
  var conf = config.viewer || {}
  var port = conf.port || 8807
  var host = conf.host || config.host || '::'

  var base = conf.base || '/'
  var defaultOpts = {
    base: base,
    msg_base: conf.msg_base || base,
    feed_base: conf.feed_base || base,
    blob_base: conf.blob_base || base,
    img_base: conf.img_base || base,
    emoji_base: conf.emoji_base || (base + 'emoji/'),
  }

  defaultOpts.marked = {
    gfm: true,
    mentions: true,
    tables: true,
    breaks: true,
    pedantic: false,
    sanitize: true,
    smartLists: true,
    smartypants: false,
    emoji: renderEmoji,
    renderer: new MdRenderer(defaultOpts)
  }

  var getMsg = memo({cache: lru(100)}, getMsgWithValue, sbot)
  var getAbout = memo({cache: lru(100)}, require('./lib/about'), sbot)
  var serveAcmeChallenge = require('ssb-acme-validator')(sbot)

  http.createServer(serve).listen(port, host, function () {
    console.log('[viewer] Listening on http://' + host + ':' + port)
  })

  function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return respond(res, 405, 'Method must be GET or HEAD')
    }

    var m = urlIdRegex.exec(req.url)

    if (req.url.startsWith('/user-feed/')) return serveUserFeed(req, res, m[4])
    else if (req.url.startsWith('/channel/')) return serveChannel(req, res, m[4])
    else if (req.url.startsWith('/.well-known/acme-challenge')) return serveAcmeChallenge(req, res)
    else if (req.url.startsWith('/web/')) return serveWeb(req, res, m[4])

    if (m[2] && m[2].length === 3) {
      m[1] = decodeURIComponent(m[1])
      m[2] = m[1][0]
    }
    switch (m[2]) {
      case '%': return serveId(req, res, m[1], m[3], m[5])
      case '@': return serveFeed(req, res, m[1], m[3], m[5])
      case '&': return serveBlob(req, res, sbot, m[1])
      default: return servePath(req, res, m[4], conf)
    }
  }

  function serveFeed(req, res, feedId, ext) {
    console.log("serving feed: " + feedId)

    var showAll = req.url.endsWith("?showAll");

    getAbout(feedId, function (err, about) {
      if (err) return respond(res, 500, err.stack || err)

      function render() {
        switch (ext) {
          case 'rss':
            return pull(
              // formatMsgs(feedId, ext, defaultOpts)
              renderRssItem(defaultOpts), wrapRss(about.name, defaultOpts)
            );
          default:
            return pull(
              renderAbout(defaultOpts, about,
                          renderShowAll(showAll, req.url)), wrapPage(about.name)
            );
        }
      }

      pull(
        sbot.createUserStream({ id: feedId, reverse: true, limit: showAll ? -1 : (ext == 'rss' ? 25 : 10) }),
        pull.filter(function (data) {
          return 'object' === typeof data.value.content
        }),
        pull.collect(function (err, logs) {
          if (err) return respond(res, 500, err.stack || err)
          res.writeHead(200, {
            'Content-Type': ctype(ext)
          })
          pull(
            pull.values(logs),
            paramap(addAuthorAbout, 8),
            paramap(addBlog, 8),
            paramap(addFollowAbout, 8),
            paramap(addVoteMessage, 8),
            paramap(addGitLinks, 8),
            paramap(addGatheringAbout, 8),
            render(),
            toPull(res, function (err) {
              if (err) console.error('[viewer]', err)
            })
          )
        })
      )
    })
  }

  function serveWeb (req, res, url) {
    var self = this
    var id = decodeURIComponent(url.substr(1))

    var components = url.split('/')
    if (components[0] === '') components.shift()
    if (components[0] === 'web') components.shift()
    components[0] = decodeURIComponent(components[0])

    webresolve(sbot, components, function (err, data) {
      if (err) {
        return respond(res, 404, 'ERROR: ' + err)
      }
      return pull(
        pull.once(data),
        toPull(res, function (err) {
          if (err) console.error('[viewer]', err)
        })
      )
    })
  }

  function serveUserFeed(req, res, url) {
    var feedId = url.substring(url.lastIndexOf('user-feed/')+10, 100)
    console.log("serving user feed: " + feedId)

    var following = []
    var channelSubscriptions = []
    
    getAbout(feedId, function (err, about) {
      pull(
	sbot.createUserStream({ id: feedId }),
	pull.filter((msg) => {
	  return !msg.value ||
	    msg.value.content.type == 'contact' ||
	    (msg.value.content.type == 'channel' &&
	     typeof msg.value.content.subscribed != 'undefined')
	}),
	pull.collect(function (err, msgs) {
	  msgs.forEach((msg) => {
	    if (msg.value.content.type == 'contact')
	    {
	      if (msg.value.content.following)
		following[msg.value.content.contact] = 1
	      else
		delete following[msg.value.content.contact]
	    }
	    else // channel subscription
	    {
	      if (msg.value.content.subscribed)
		channelSubscriptions[msg.value.content.channel] = 1
	      else
		delete channelSubscriptions[msg.value.content.channel]
	    }
	  })
	  
	  serveFeeds(req, res, following, channelSubscriptions, feedId,
                     'user feed ' + (about ? about.name : ""))
	})
      )
    })
  }

  function serveFeeds(req, res, following, channelSubscriptions, feedId, name) {
    var feedOpts = Object.assign({}, defaultOpts, {
      renderPrivate: false,
      renderSubscribe: false,
      renderVote: false,
      renderTalenet: false,
      renderChess: false,
      renderFollow: false,
      renderPub: false,
      renderAbout: false
    })

    pull(
      sbot.createLogStream({ reverse: true, limit: 5000 }),
      pull.filter((msg) => {
	return !msg.value ||
	  (msg.value.author in following ||
	   msg.value.content.channel in channelSubscriptions)
      }),
      pull.take(150),
      pull.collect(function (err, logs) {
	if (err) return respond(res, 500, err.stack || err)
	res.writeHead(200, {
	  'Content-Type': ctype("html")
	})
	pull(
	  pull.values(logs),
	  paramap(addAuthorAbout, 8),
          paramap(addBlog, 8),
	  paramap(addFollowAbout, 8),
	  paramap(addVoteMessage, 8),
	  paramap(addGitLinks, 8),
    paramap(addGatheringAbout, 8),
	  pull(renderThread(feedOpts), wrapPage(name)),
	  toPull(res, function (err) {
	    if (err) console.error('[viewer]', err)
	  })
	)
      })
    )
  }

  function serveChannel(req, res, url) {
    var channelId = url.substring(url.lastIndexOf('channel/')+8, 100)
    console.log("serving channel: " + channelId)

    var showAll = req.url.endsWith("?showAll")
    
    pull(
      sbot.query.read({ limit: showAll ? 300 : 10, reverse: true, query: [{$filter: { value: { content: { channel: channelId }}}}]}),
      pull.collect(function (err, logs) {
	if (err) return respond(res, 500, err.stack || err)
	res.writeHead(200, {
	  'Content-Type': ctype("html")
	})
	pull(
	  pull.values(logs),
	  paramap(addAuthorAbout, 8),
          paramap(addBlog, 8),
    paramap(addVoteMessage, 8),
    paramap(addGatheringAbout, 8),
	  pull(renderThread(defaultOpts, '', renderShowAll(showAll, req.url)),
	       wrapPage('#' + channelId)),
	  toPull(res, function (err) {
	    if (err) console.error('[viewer]', err)
	  })
	)
      })
    )
  }

  function serveId(req, res, id, ext, query) {
    var q = query ? qs.parse(query) : {}
    var includeRoot = !('noroot' in q)
    var base = q.base || conf.base
    var baseToken
    if (!base) {
      if (ext === 'js') base = baseToken = '__BASE_' + Math.random() + '_'
      else base = '/'
    }
    var opts = {
      base: base,
      base_token: baseToken,
      msg_base: q.msg_base || conf.msg_base || base,
      feed_base: q.feed_base || conf.feed_base || base,
      blob_base: q.blob_base || conf.blob_base || base,
      img_base: q.img_base || conf.img_base || base,
      emoji_base: q.emoji_base || conf.emoji_base || (base + 'emoji/'),
    }
    opts.marked = {
      gfm: true,
      mentions: true,
      tables: true,
      breaks: true,
      pedantic: false,
      sanitize: true,
      smartLists: true,
      smartypants: false,
      emoji: renderEmoji,
      renderer: new MdRenderer(opts)
    }

    var format = formatMsgs(id, ext, opts)
    if (format === null) return respond(res, 415, 'Invalid format')

    function render (links) {
      var etag = hash(sort.heads(links).concat(appHash, ext, qs))
      if (req.headers['if-none-match'] === etag) return respond(res, 304)
      res.writeHead(200, {
        'Content-Type': ctype(ext),
        'etag': etag
      })
      pull(
        pull.values(sort(links)),
        paramap(addAuthorAbout, 8),
        paramap(addBlog, 8),
        paramap(addGatheringAbout, 8),
        format,
        toPull(res, function (err) {
          if (err) console.error('[viewer]', err)
        })
      )
    }

    getMsgWithValue(sbot, id, function (err, root) {
      if (err) return respond(res, 500, err.stack || err)
      if('string' === typeof root.value.content)
        return render([root])

      pull(
        sbot.links({dest: id, values: true, rel: 'root' }),
        pull.unique('key'),
        pull.collect(function (err, links) {
          if (err) return respond(res, 500, err.stack || err)
          if(includeRoot)
            links.unshift(root)
          render(links)
        })
      )
    })
  }

  function addFollowAbout(msg, cb) {
    if (msg.value.content.contact)
      getAbout(msg.value.content.contact, function (err, about) {
	if (err) return cb(err)
	msg.value.content.contactAbout = about
	cb(null, msg)
      })
    else
      cb(null, msg)
  }

  function addVoteMessage(msg, cb) {
    if (msg.value.content.type == 'vote' && msg.value.content.vote && msg.value.content.vote.link[0] == '%')
      getMsg(msg.value.content.vote.link, function (err, linkedMsg) {
	if (linkedMsg)
	  msg.value.content.vote.linkedText = linkedMsg.value.content.text
	cb(null, msg)
      })
    else
      cb(null, msg)
  }

  function addBlog(msg, cb) {
    if (msg.value && msg.value.content.type == "blog") {
      pull(
        sbot.blobs.get(msg.value.content.blog),
        pull.collect(function(err, blob) {
          msg.value.content.blogContent = blob
          cb(null, msg)
        })
      )
    } else
      cb(null, msg)
  }

  function addAuthorAbout(msg, cb) {
    getAbout(msg.value.author, function (err, about) {
      if (err) return cb(err)
      msg.author = about
      cb(null, msg)
    })
  }

  function addGatheringAbout(msg, cb) {
    if (msg.value && msg.value.content.type === 'gathering') {
      getAbout(msg.key, (err, about) => {
        if (err) { cb(err) }

        msg.value.content.about = about

        pull(
          sbot.backlinks.read({
            query: [{ $filter: {
              dest: msg.key,
              value: { content: { type: 'about' }},
            }}],
            index: 'DTA'
          }),
          // Only grab messages about attendance
          pull.filter(o => o.value.content.attendee !== undefined),
          // Filter "can't attend"-messages
          pull.filter(o => !o.value.content.attendee.remove),
          pull.unique(o => o.value.content.attendee.link),
          pull.collect((err, arr) => {
            if (err) { cb(err) }

            msg.value.content.numberAttending = arr.length

            cb(null, msg)
          })
        )
      })
    } else {
      cb(null, msg)
    }
  }

  function addGitLinks(msg, cb) {
    if (msg.value.content.type == 'git-update')
      getMsg(msg.value.content.repo, function (err, gitRepo) {
	if (gitRepo)
	  msg.value.content.repoName = gitRepo.value.content.name
	cb(null, msg)
      })
    else if (msg.value.content.type == 'issue')
      getMsg(msg.value.content.project, function (err, gitRepo) {
	if (gitRepo)
	  msg.value.content.repoName = gitRepo.value.content.name
	cb(null, msg)
      })
    else
      cb(null, msg)
  }
}

function serveBlob(req, res, sbot, id) {
  if (req.headers['if-none-match'] === id) return respond(res, 304)
  sbot.blobs.has(id, function (err, has) {
    if (err) {
      if (/^invalid/.test(err.message)) return respond(res, 400, err.message)
      else return respond(res, 500, err.message || err)
    }
    if (!has) return respond(res, 404, 'Not found')
    res.writeHead(200, {
      'Cache-Control': 'public, max-age=315360000',
      'etag': id
    })
    pull(
      sbot.blobs.get(id),
      toPull(res, function (err) {
        if (err) console.error('[viewer]', err)
      })
    )
  })
}

function getMsgWithValue(sbot, id, cb) {
  sbot.get(id, function (err, value) {
    if (err) return cb(err)
    cb(null, {key: id, value: value})
  })
}

function respond(res, status, message) {
  res.writeHead(status)
  res.end(message)
}

function ctype(name) {
  switch (name && /[^.\/]*$/.exec(name)[0] || 'html') {
    case 'html': return 'text/html'
    case 'js': return 'text/javascript'
    case 'css': return 'text/css'
    case 'json': return 'application/json'
    case 'rss': return 'text/xml'
  }
}

function servePath(req, res, url, conf) {
  switch (url) {
    case '/robots.txt': return serveRobots(req, res, conf)
  }
  var m = /^(\/?[^\/]*)(\/.*)?$/.exec(url)
  switch (m[1]) {
    case '/static': return serveStatic(req, res, m[2])
    case '/emoji': return serveEmoji(req, res, m[2])
  }
  return respond(res, 404, 'Not found')
}

function ifModified(req, lastMod) {
  var ifModSince = req.headers['if-modified-since']
  if (!ifModSince) return false
  var d = new Date(ifModSince)
  return d && Math.floor(d/1000) >= Math.floor(lastMod/1000)
}

function serveStatic(req, res, file) {
  serveFile(req, res, path.join(__dirname, 'static', file))
}

function serveFile(req, res, file) {
  fs.stat(file, function (err, stat) {
    if (err && err.code === 'ENOENT') return respond(res, 404, 'Not found')
    if (err) return respond(res, 500, err.stack || err)
    if (!stat.isFile()) return respond(res, 403, 'May only load files')
    if (ifModified(req, stat.mtime)) return respond(res, 304, 'Not modified')
    res.writeHead(200, {
      'Content-Type': ctype(file),
      'Content-Length': stat.size,
      'Last-Modified': stat.mtime.toGMTString()
    })
    fs.createReadStream(file).pipe(res)
  })
}

function serveRobots(req, res, conf) {
  res.end('User-agent: *'
    + (conf.disallowRobots ? '\nDisallow: /' : ''))
}

function prepend(fn, arg) {
  return function (read) {
    return function (abort, cb) {
      if (fn && !abort) {
        var _fn = fn
        fn = null
        return _fn(arg, function (err, value) {
          if (err) return read(err, function (err) {
            cb(err || true)
          })
          cb(null, value)
        })
      }
      read(abort, cb)
    }
  }
}
