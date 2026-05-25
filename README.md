[![CI Test Status][ci-img]][ci-url]
[![Code Climate][clim-img]][clim-url]

# haraka-plugin-mail_from.is_resolvable

This plugin checks that the domain used in MAIL FROM is reachable via DNS. A domain passes when:

1. It publishes an MX record that resolves to at least one non-bogus IP (IPv4 or IPv6), **or**
2. It has no MX record but has an A/AAAA record (RFC 5321 §5.1 implicit MX fallback), and that address is non-bogus.

"Non-bogus" means the address does not match the configured `re_bogus_ip` (IPv4) or `net_utils.ipv6_bogus` (IPv6). A domain whose MX targets resolve only to bogus addresses is treated the same as a domain with no MX (controlled by `[reject].no_mx`).

The Null MX record (RFC 7505: priority 0, exchange `""`) is recognized and always denied — those domains explicitly do not send mail.

## Configuration

This plugin uses the INI-style file format and accepts the following options:

- `[main] allow_mx_ip=[true | false]`

  Allow MX records that return IP addresses instead of hostnames. This is not allowed as per the RFC, but some MTAs allow it.

- `[main] re_bogus_ip=<regex>`

  IPv4 regex matching addresses considered unusable. Default: `^(?:0\.0\.0\.0|255\.255\.255\.255|127\.)`. An MX target whose A record matches is treated as unreachable.

- `[main] timeout_ms=<integer>`

  Maximum time (ms) to wait on each DNS call (MX lookup and MX-host resolution). A timeout returns DENYSOFT so the sender retries. Default `5000`. Node's resolver has its own per-query timeouts; this is a soft cap on cumulative retries that would otherwise stall an SMTP transaction.

- `[reject] no_mx=[deny|defer|no]`

  Applies when the domain has no MX, no usable A/AAAA fallback, or all of its MX targets resolve only to bogus IPs. "deny" returns DENY and rejects the command. "defer" returns a DENYSOFT (TEMPFAIL) and the client will retry later. "no" allows the transaction to continue to the next plugin.

<!-- leave these buried at the bottom of the document -->

[ci-img]: https://github.com/haraka/haraka-plugin-mail_from.is_resolvable/actions/workflows/ci.yml/badge.svg
[ci-url]: https://github.com/haraka/haraka-plugin-mail_from.is_resolvable/actions/workflows/ci.yml
[clim-img]: https://codeclimate.com/github/haraka/haraka-plugin-mail_from.is_resolvable/badges/gpa.svg
[clim-url]: https://codeclimate.com/github/haraka/haraka-plugin-mail_from.is_resolvable
