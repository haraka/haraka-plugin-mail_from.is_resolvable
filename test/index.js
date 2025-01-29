
const assert = require('node:assert/strict')
const { beforeEach, describe, it } = require('node:test')
const dns = require('node:dns');

// npm modules
const fixtures = require('haraka-test-fixtures')
const Address = require('address-rfc2821').Address


beforeEach(() => {
  this.plugin = new fixtures.plugin('mail_from.is_resolvable')
  this.plugin.register();

  this.connection = fixtures.connection.createConnection();
  this.connection.init_transaction()
})

describe('mail_from.is_resolvable', () => {
  it('loads', () => {
    assert.ok(this.plugin)
  })

  describe('load_ini', () => {
    it('loads config/mail_from.is_resolvable.ini', () => {
      this.plugin.load_ini()
      assert.ok(this.plugin.cfg)
    })

    it('initializes enabled boolean', () => {
      this.plugin.load_ini()
      assert.equal(this.plugin.cfg.main.allow_mx_ip, false, this.plugin.cfg)
    })
  })

  describe('uses text fixtures', () => {
    it('sets up a connection', () => {
      this.connection = fixtures.connection.createConnection({})
      assert.ok(this.connection.server)
    })

    it('sets up a transaction', () => {
      this.connection = fixtures.connection.createConnection({})
      this.connection.init_transaction()
      assert.ok(this.connection.transaction.header)
    })
  })

  describe('hook_mail', () => {
    it('any.com, no err code', (done) => {
      const txn = this.connection.transaction;
      this.plugin.hook_mail((code, msg) => {
          // console.log()
          assert.deepEqual(txn.results.get('mail_from.is_resolvable').pass, ['has_fwd_dns']);
          done();
      },
      this.connection, 
      [new Address('<test@any.com>')]
      )
    })
  })
})
