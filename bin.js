#!/usr/bin/env node

require('ssb-client')(function (err, sbot, config) {
  if (err) throw err
  require('.').init(sbot, config)
})
