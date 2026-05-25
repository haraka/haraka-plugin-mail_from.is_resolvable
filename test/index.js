'use strict'
const assert = require('node:assert/strict')
const {
  describe,
  it,
  before,
  after,
  beforeEach,
  afterEach,
} = require('node:test')

const fixtures = require('haraka-test-fixtures')
const { Address } = require('@haraka/email-address')

// These tests exercise the plugin against real DNS rather than mocking
// net_utils / the DNS resolver. Stable, well-known domains are used:
//
//   gmail.com         - has MX records whose hostnames resolve (A + AAAA)
//   www.google.com    - no MX, but A/AAAA records (implicit MX is an IP)
//   nonexistent.invalid - reserved TLD (RFC 6761), never resolves: no MX

function makeNext() {
  const next = (...args) => {
    next.calls.push(args)
  }
  next.calls = []
  return next
}

describe('mail_from.is_resolvable', () => {
  let plugin, connection, txt, next

  beforeEach(() => {
    plugin = new fixtures.plugin('mail_from.is_resolvable')
    plugin.register()

    connection = fixtures.connection.createConnection()
    connection.init_transaction()

    txt = connection.transaction

    next = makeNext()
  })

  describe('hook_mail', () => {
    it('Allow - mail_from without host', async () => {
      await plugin.hook_mail(next, connection, [{}])

      assert.equal(txt.results.get(plugin).skip[0], 'null host')
      assert.equal(next.calls.length, 1)
      assert.equal(next.calls[0].length, 0)
    })

    it('DENY - No MX for your FROM address', async () => {
      await plugin.hook_mail(next, connection, [
        new Address('<test@nonexistent.invalid>'),
      ])

      assert.ok(txt.results.has(plugin, 'fail', 'has_fwd_dns'))
      assert.equal(next.calls.length, 1)
      assert.deepEqual(next.calls[0], [DENY, 'No MX for your FROM address'])
    })

    it('DENYSOFT - No MX for your FROM address', async () => {
      plugin.reject_no_mx = 'defer'

      await plugin.hook_mail(next, connection, [
        new Address('<test@nonexistent.invalid>'),
      ])

      assert.ok(txt.results.has(plugin, 'fail', 'has_fwd_dns'))
      assert.equal(next.calls.length, 1)
      assert.deepEqual(next.calls[0], [DENYSOFT, 'No MX for your FROM address'])
    })

    it('Allow - No MX for your FROM address (reject_no_mx=no)', async () => {
      plugin.reject_no_mx = 'no'

      await plugin.hook_mail(next, connection, [
        new Address('<test@nonexistent.invalid>'),
      ])

      assert.ok(txt.results.has(plugin, 'fail', 'has_fwd_dns'))
      assert.equal(next.calls.length, 1)
      assert.equal(next.calls[0].length, 0)
    })

    it('Allow - MX is an IP address (implicit MX, allow_mx_ip)', async () => {
      plugin.cfg.main.allow_mx_ip = true

      // www.google.com has no MX, so get_mx falls back to A/AAAA records,
      // yielding implicit MX records whose exchange is an IP address.
      await plugin.hook_mail(next, connection, [
        new Address('<test@www.google.com>'),
      ])

      assert.ok(txt.results.has(plugin, 'pass', 'implicit_mx'))
      assert.equal(next.calls.length, 1)
      assert.equal(next.calls[0].length, 0)
    })

    it('DENY - implicit MX IP rejected without allow_mx_ip', async () => {
      // allow_mx_ip defaults to false: an IP-only (implicit) MX is not
      // an acceptable MX hostname, so this is rejected.
      await plugin.hook_mail(next, connection, [
        new Address('<test@www.google.com>'),
      ])

      assert.ok(txt.results.has(plugin, 'fail', 'has_fwd_dns'))
      assert.equal(next.calls.length, 1)
      assert.deepEqual(next.calls[0], [
        DENY,
        'No valid MX for your FROM address',
      ])
    })

    it('Allow - valid MX hostname that resolves', async () => {
      await plugin.hook_mail(next, connection, [
        new Address('<test@gmail.com>'),
      ])

      assert.ok(txt.results.has(plugin, 'pass', 'has_fwd_dns'))
      assert.equal(next.calls.length, 1)
      assert.equal(next.calls[0].length, 0)
    })
  })

  // Fatal-DNS error path (index.js get_mx catch). A local fake DNS server
  // returns a real SERVFAIL/REFUSED RCODE, so node:dns -> haraka-net-utils
  // produces a real Error whose .code drives the plugin's catch -- no mocks.
  // (The resolve_mx_hosts catch is unreachable without mocking — it's
  // covered separately in the "resolve_mx_hosts catch" block below.)
  describe('hook_mail - resolver failure', () => {
    let dns, restore

    before(async () => {
      dns = await fixtures.dns.start({
        'servfail.example': { rcode: 'SERVFAIL' },
        'refused.example': { rcode: 'REFUSED' },
      })
      restore = dns.patch(require('haraka-net-utils/lib/dns_config'))
    })

    after(async () => {
      restore()
      await dns.close()
    })

    it('DENYSOFT - SERVFAIL resolving MX', async () => {
      await plugin.hook_mail(next, connection, [
        new Address('<test@servfail.example>'),
      ])

      assert.deepEqual(next.calls[0], [
        DENYSOFT,
        'Temp. resolver error (ESERVFAIL)',
      ])
      assert.match(txt.results.get(plugin).err.join(), /ESERVFAIL/)
    })

    it('DENYSOFT - REFUSED resolving MX', async () => {
      await plugin.hook_mail(next, connection, [
        new Address('<test@refused.example>'),
      ])

      assert.deepEqual(next.calls[0], [
        DENYSOFT,
        'Temp. resolver error (EREFUSED)',
      ])
      assert.match(txt.results.get(plugin).err.join(), /EREFUSED/)
    })
  })

  // Cap each DNS call so a stalled resolver can't tie up the SMTP
  // transaction. Audit S1.
  describe('hook_mail - DNS timeout', () => {
    const net_utils = require('haraka-net-utils')
    let original_get_mx

    beforeEach(() => {
      original_get_mx = net_utils.get_mx
      // Never-resolving promise simulates a hung resolver.
      net_utils.get_mx = () => new Promise(() => {})
    })

    afterEach(() => {
      net_utils.get_mx = original_get_mx
    })

    it('DENYSOFT - hung MX lookup is bounded by timeout_ms', async () => {
      plugin.dns_timeout_ms = 25
      const start = Date.now()
      await plugin.hook_mail(next, connection, [
        new Address('<test@example.com>'),
      ])
      const elapsed = Date.now() - start

      assert.equal(next.calls[0][0], DENYSOFT)
      assert.match(next.calls[0][1], /Temp. resolver error/)
      assert.match(txt.results.get(plugin).err.join(), /timed out after 25ms/)
      assert.ok(elapsed < 500, `should give up promptly; took ${elapsed}ms`)
    })
  })

  // Custom DNS zones to drive specific code paths (Null MX, bogus-IP MX
  // targets, resolve_mx_hosts catch) without hitting the live internet.
  describe('hook_mail - custom DNS zones', () => {
    let dns, restore
    before(async () => {
      dns = await fixtures.dns.start({
        'null-mx.example': { mx: [{ preference: 0, exchange: '' }] },
        // MX target whose A record matches the default re_bogus_ip (127.x)
        'bogus.example': {
          mx: [{ preference: 10, exchange: 'mx.bogus.example' }],
        },
        'mx.bogus.example': { a: ['127.0.0.1'] },
        // MX target is a literal bogus IP (exercises allow_mx_ip path)
        'ipmx.example': { mx: [{ preference: 10, exchange: '127.0.0.2' }] },
      })
      restore = dns.patch(require('haraka-net-utils/lib/dns_config'))
    })
    after(async () => {
      restore()
      await dns.close()
    })

    it('DENY - Null MX (RFC 7505) is denied with sec_null_mx_sender DSN', async () => {
      await plugin.hook_mail(next, connection, [
        new Address('<test@null-mx.example>'),
      ])
      assert.ok(txt.results.has(plugin, 'fail', 'null_mx'))
      assert.equal(next.calls[0][0], DENY)
      // sec_null_mx_sender returns a DSN whose .reply contains the domain
      assert.match(next.calls[0][1].reply, /null-mx\.example/)
    })

    it('Allow - Null MX with reject_no_mx=no falls through', async () => {
      plugin.reject_no_mx = 'no'
      await plugin.hook_mail(next, connection, [
        new Address('<test@null-mx.example>'),
      ])
      assert.ok(txt.results.has(plugin, 'fail', 'null_mx'))
      assert.equal(next.calls[0].length, 0)
    })

    it('DENY - MX target resolves only to bogus IPs', async () => {
      await plugin.hook_mail(next, connection, [
        new Address('<test@bogus.example>'),
      ])
      assert.ok(txt.results.has(plugin, 'fail', 'has_fwd_dns'))
      assert.deepEqual(next.calls[0], [
        DENY,
        'No valid MX for your FROM address',
      ])
    })

    it('DENY - allow_mx_ip rejects when every MX is a bogus IP', async () => {
      // allow_mx_ip true, but the only MX exchange is 127.0.0.2 (bogus).
      // The allow_mx_ip loop falls through; nothing left to resolve;
      // reject with "No valid MX".
      plugin.cfg.main.allow_mx_ip = true
      await plugin.hook_mail(next, connection, [
        new Address('<test@ipmx.example>'),
      ])
      assert.ok(txt.results.has(plugin, 'fail', 'has_fwd_dns'))
      assert.deepEqual(next.calls[0], [
        DENY,
        'No valid MX for your FROM address',
      ])
    })
  })

  describe('hook_mail - resolve_mx_hosts catch', () => {
    // The catch on resolve_mx_hosts is intentionally hard to trigger
    // because net_utils.resolve_mx_hosts swallows per-host errors via
    // Promise.allSettled. We monkey-patch it here to confirm the catch
    // returns DENYSOFT with the expected error code.
    const net_utils = require('haraka-net-utils')
    let original_resolve

    beforeEach(() => {
      original_resolve = net_utils.resolve_mx_hosts
      const err = new Error('boom')
      err.code = 'EFAIL'
      net_utils.resolve_mx_hosts = () => Promise.reject(err)
    })

    afterEach(() => {
      net_utils.resolve_mx_hosts = original_resolve
    })

    it('DENYSOFT when resolve_mx_hosts rejects', async () => {
      await plugin.hook_mail(next, connection, [
        new Address('<test@gmail.com>'),
      ])
      assert.equal(next.calls[0][0], DENYSOFT)
      assert.equal(next.calls[0][1], 'Temp. resolver error (EFAIL)')
      assert.match(txt.results.get(plugin).err.join(), /boom/)
    })
  })

  describe('load_ini watchCb', () => {
    it('reloads cfg when the watchCb fires', () => {
      // Capture the watchCb registered by load_ini, then invoke it to
      // exercise the arrow function that's otherwise only fired by
      // haraka-config when the ini file changes.
      let savedCb
      const original_get = plugin.config.get
      plugin.config.get = (name, opts, cb) => {
        savedCb = cb
        return original_get.call(plugin.config, name, opts, () => {})
      }
      try {
        plugin.load_ini()
        assert.equal(typeof savedCb, 'function')
        // calling the watchCb should re-run load_ini without throwing
        assert.doesNotThrow(() => savedCb())
      } finally {
        plugin.config.get = original_get
      }
    })
  })
})
