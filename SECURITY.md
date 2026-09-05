# Security

## What there is to attack

Typeforge is a static site. There is no server, no account, and no database:
a font is read, edited and written entirely in the browser, and nothing it is
loaded into leaves the machine. So most of what a security policy usually
covers does not apply here.

What does apply is that **this application parses untrusted binary files**. It
reads TrueType, OpenType, WOFF, WOFF2 and UFO, and the whole point of it is that
you point it at a font somebody else made. `src/font/` is a parser written from
the specifications, and a parser is where the interesting bugs live: a length
field that is trusted, an offset that runs off the end of a table, a loop whose
bound comes from the file.

The realistic damage is to the person who opened the file — a hung tab, a
crash, or a font written back out with something in it that was not in the
original. Take those seriously.

It also fetches from `api.fontsource.org`, `www.googleapis.com`,
`fonts.googleapis.com` and `cdn.jsdelivr.net` for the font library, so a
response from those is untrusted input as well.

## Reporting something

Please **do not open a public issue** for a vulnerability.

Use GitHub's private vulnerability reporting on this repository — the *Report a
vulnerability* button under **Security** — which opens a private thread with the
maintainer. If that button is not there, the feature has not been switched on
for the repository yet; open an ordinary issue saying only that you have
something to report and asking for a private channel, with no details in it.

It helps to include the file that triggers it. A font that crashes the parser is
worth more than a description of the crash, and it can go straight into the
tests.

## What to expect

This is a small project and there is no rota. An acknowledgement within a week
is the honest promise rather than a service level, and a fix will land on `main`
and be described in the pull request that carries it. There is no release
schedule and no supported-versions table: the deployed site is whatever `main`
is, so a fix reaches everybody as soon as it merges.

Credit in the pull request if you would like it, and none if you would rather
not — say which.

## Out of scope

A licensed font can be opened, edited and exported, because that is what the
application is for. Whether you are permitted to do that to a particular
typeface is between you and its licence, and is not something this project can
or does enforce.

The session kept between visits lives in IndexedDB in your own browser and
includes the font you opened. On a shared machine it stays for whoever uses that
browser profile. Clearing the site's data removes it. That is a property of
where it is kept rather than a fault, and the README says so.
