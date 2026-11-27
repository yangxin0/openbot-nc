### Changed

- On iPhone, the app joins with a code and connects to a central server that has only its own root
  certificate, for example a server with an IP address and no domain. The app reads the root from
  the server and trusts it only when it matches the root in the code. Before, the join failed with
  "cannot connect to the server". The central server must also be on this version. Android needs a
  later version.
