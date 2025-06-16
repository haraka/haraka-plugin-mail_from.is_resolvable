[![CI Test Status][ci-img]][ci-url]
[![Code Climate][clim-img]][clim-url]

# haraka-plugin-mail_from.is_resolvable

This plugin checks that the domain used in MAIL FROM is resolvable to an MX
record.

## Configuration

This plugin uses the INI-style file format and accepts the following options:

- allow_mx_ip=[true | false]

  Allow MX records that return IP addresses instead of hostnames.
  This is not allowed as per the RFC, but some MTAs allow it.

- [reject]no_mx=[true|false]

  Return DENY and reject the command if no MX record is found. Otherwise a
  DENYSOFT (TEMPFAIL) is returned and the client will retry later.

  DNS errors always return DENYSOFT, so this should be safe to enable.

<!-- leave these buried at the bottom of the document -->

[ci-img]: https://github.com/haraka/haraka-plugin-mail_from.is_resolvable/actions/workflows/ci.yml/badge.svg
[ci-url]: https://github.com/haraka/haraka-plugin-mail_from.is_resolvable/actions/workflows/ci.yml
[clim-img]: https://codeclimate.com/github/haraka/haraka-plugin-mail_from.is_resolvable/badges/gpa.svg
[clim-url]: https://codeclimate.com/github/haraka/haraka-plugin-mail_from.is_resolvable
