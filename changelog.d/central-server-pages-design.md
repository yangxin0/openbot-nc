### Changed

- The central server admin page uses the OpenBot design: the OpenBot palette, the OpenBot-NC logo, a
  sign-in page that shows the sign-in command, number tiles for members online, teams and open join
  codes, and grouped tables with status labels for valid, revoked and expired certificates and for
  online and hosting members. Messages show at the bottom of the page, and you can close them.
- The admin page follows the light or dark setting of your system. The theme buttons in the top bar
  and on the sign-in page set System, Light or Dark, and the browser keeps your choice.
- The sign-in page of the web client shows the OpenBot-NC logo and name, like the language step
  before it. The join code is the main action, and the identity file is behind "Use an identity
  file".
- Theme buttons next to the language button on the web client sign-in page set System, Light or Dark
  before you sign in. The choice is the same as Settings > Preferences > Theme.
- `ca init` also makes a team named "Default", so one person can make join codes at once with
  `ca code --team Default --user <user>`. `ca team add` still adds more teams.
- Join codes work with a central server that has only its own root certificate, for example a server
  with an IP address and no domain. The desktop and the Linux server read the root from the new
  `/v1/root` address of the server and trust it only when it matches the root in the code. Before,
  the join failed with "cannot connect to the server". The central server must also be on this
  version. The phone, the browser extension and the web client still need a certificate that the
  device trusts.
- A join to a server whose certificate this device does not trust now says so. Before, it said to
  check the network.
