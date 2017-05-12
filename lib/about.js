var pull = require('pull-stream')
var sort = require('ssb-sort')

function asString(val) {
  return typeof val === 'string' && val
}

function linkDest(val) {
  return val ? asString(val) || asString(val.link) : null
}

module.exports = function (sbot, id, cb) {
  var aboutByFeed = {}
  pull(
    sbot.links({
      rel: 'about',
      dest: id,
      values: true,
    }), 
    pull.drain(function (msg) {
      var author = msg.value.author
      var c = msg.value.content
      if (!c) return
      var feedAbout = aboutByFeed[author] || (aboutByFeed[author] = {})
      if (c.name) feedAbout.name = c.name.replace(/^@?/, '@')
      if (c.image) feedAbout.image = linkDest(c.image)
    }, function (err) {
      if (err) return cb(err)
      // Use whatever properties have the most counts.
      // Usually we would want to handle renames for dead feeds and such,
      // but for ssb-viewer it is mostly public/archival content anyway,
      // so we'll let the popular name stand.
      var propValueCounts = {/* prop: {value: count} */}
      var topValues = {/* prop: value */}
      var topValueCounts = {/* prop: count */}
      var about = {}
      for (var feed in aboutByFeed) {
        var feedAbout = aboutByFeed[feed]
        for (var prop in feedAbout) {
          var value = feedAbout[prop]
          var valueCounts = propValueCounts[prop] || (propValueCounts[prop] = {})
          var count = (valueCounts[value] || 0) + 1
          valueCounts[value] = count
          if (count > (topValueCounts[prop] || 0)) {
            topValueCounts[prop] = count
            topValues[prop] = value
          }
        }
      }
      if (!topValues.name) topValues.name = String(id).substr(0, 10) + '…'
      cb(null, topValues)
    })
  )
}
